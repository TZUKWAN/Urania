#requires -Version 7.2
[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$ArchivePath,
    [switch]$Download,
    [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $RepositoryRoot).Path).TrimEnd([IO.Path]::DirectorySeparatorChar)

function Bound-Path([string]$Base, [string]$Relative) {
    if (-not $Relative -or $Relative.Contains('\') -or [IO.Path]::IsPathRooted($Relative)) { throw 'Invalid relative runtime path' }
    foreach ($part in $Relative.Split('/')) {
        if ($part -in @('', '.', '..') -or $part -match '[\x00-\x1f:*?"<>|]' -or $part -match '[. ]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw 'Non-portable runtime path' }
    }
    $full = [IO.Path]::GetFullPath([IO.Path]::Combine($Base, $Relative))
    if (-not $full.StartsWith($Base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime path escapes its intended directory' }
    $cursor = $Base
    $components = @('') + $Relative.Split('/')
    foreach ($component in $components) {
        if ($component) { $cursor = [IO.Path]::Combine($cursor, $component) }
        try {
            $attributes = [IO.File]::GetAttributes($cursor)
            if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime destination contains a symbolic link or junction' }
        } catch [IO.FileNotFoundException] { break } catch [IO.DirectoryNotFoundException] { break }
    }
    return $full
}
function Hash-File([string]$File) {
    $stream=[IO.File]::OpenRead($File);$hasher=[Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant() }
    finally { $hasher.Dispose();$stream.Dispose() }
}
function Write-AtomicJson([string]$File, $Value) {
    $temp = $File + '.tmp-' + [guid]::NewGuid().ToString()
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 30))
    $stream = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    for ($retry=0; $retry -lt 5; $retry++) {
        try { [IO.File]::Move($temp, $File, $true); break }
        catch [IO.IOException] { if ($retry -eq 4) { throw }; Start-Sleep -Milliseconds 30 }
    }
}
function Remove-OwnedStage([string]$Stage, [string]$Id) {
    $expected = Bound-Path $repo ('.urania/runtime-stage-' + $Id)
    if ($Stage -ne $expected -or $Id -notmatch '^[a-f0-9-]{36}$') { throw 'Unrecognized runtime staging directory' }
    if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
}
function Undo-Transaction($Transaction) {
    if ($Transaction.schemaVersion -ne 1 -or $Transaction.id -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid runtime recovery journal' }
    $backup = Bound-Path $repo ('.urania/runtime-backup-' + $Transaction.id)
    $stage = Bound-Path $repo ('.urania/runtime-stage-' + $Transaction.id)
    for ($i = $Transaction.files.Count - 1; $i -ge 0; $i--) {
        $row = $Transaction.files[$i]
        if ($row.path -notmatch '^runtimes/' -or $row.newSha256 -notmatch '^[a-f0-9]{64}$' -or ($row.hadOriginal -and $row.oldSha256 -notmatch '^[a-f0-9]{64}$')) { throw 'Invalid runtime recovery file identity' }
        $target = Bound-Path $repo $row.path
        $old = Bound-Path $backup $row.path
        $actual = if (Test-Path -LiteralPath $target) { Hash-File $target } else { $null }
        if ($actual -and $actual -ne $row.newSha256 -and $actual -ne $row.oldSha256) { throw ('A runtime changed after interruption; retained both versions: ' + $row.path) }
        if ($row.hadOriginal) {
            if (Test-Path -LiteralPath $old) {
                if ((Hash-File $old) -ne $row.oldSha256) { throw 'Runtime backup hash mismatch; original backup retained' }
                if ($actual -ne $row.oldSha256) {
                    if ($actual) { Remove-Item -LiteralPath $target -Force }
                    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                    Move-Item -LiteralPath $old -Destination $target
                }
            } elseif ($actual -ne $row.oldSha256) { throw 'Original runtime backup is missing; recovery stopped without overwriting another version' }
        } elseif ($actual -eq $row.newSha256) { Remove-Item -LiteralPath $target -Force }
    }
    $Transaction.status = 'rolled-back'
    Write-AtomicJson $journalFile $Transaction
    Remove-OwnedStage $stage $Transaction.id
}

$package = Get-Content -LiteralPath (Bound-Path $repo 'package.json') -Raw | ConvertFrom-Json
$assets = Get-Content -LiteralPath (Bound-Path $repo 'release/runtime-assets.json') -Raw | ConvertFrom-Json
$manifestFile = Bound-Path $repo 'release/runtime-manifest.json'
if ((Hash-File $manifestFile) -ne $assets.runtimeManifest.sha256) { throw 'Runtime manifest hash differs from release metadata' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$payloadVersion = $assets.runtimeManifest.sourcePackageVersion ?? $assets.packageVersion
$payloadBuild = $assets.runtimeManifest.sourceUiBuild ?? $assets.uiBuild
if ($package.version -ne $assets.packageVersion -or $package.designcraftUiBuild -ne $assets.uiBuild -or $manifest.sourcePackageVersion -ne $payloadVersion -or $manifest.uiBuild -ne $payloadBuild) { throw 'Source/package/runtime manifest identities do not match' }
if ($assets.platform -ne 'win32-x64' -or $manifest.platform -ne 'win32-x64' -or -not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') { throw 'This runtime release requires Windows x64' }
$files = @($manifest.files)
# The fixed HyperFrames SDK/transitive runtime is restored offline as well.
# Its 7,447 files plus retained native compatibility builds fit this bounded budget.
if ($files.Count -lt 1 -or $files.Count -gt 16384 -or $files.Count -ne $assets.runtimeManifest.files) { throw 'Runtime file count is invalid' }
$expected = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
$total = [long]0
foreach ($row in $files) {
    if ($row.path -notmatch '^runtimes/' -or $row.sha256 -notmatch '^[a-f0-9]{64}$' -or $row.bytes -lt 0 -or $row.bytes -gt 1GB -or $expected.ContainsKey($row.path)) { throw 'Invalid or duplicate runtime manifest entry' }
    $null = Bound-Path $repo $row.path
    $expected.Add($row.path, $row); $total += [long]$row.bytes
}
if ($total -gt 8GB) { throw 'Expanded runtime exceeds the installation budget' }
$stateDir = Bound-Path $repo '.urania'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$journalFile = Bound-Path $repo '.urania/runtime-transaction.json'
if (Test-Path -LiteralPath $journalFile) {
    $prior = Get-Content -LiteralPath $journalFile -Raw | ConvertFrom-Json
    if ($prior.status -in @('staging','installing')) {
        if ($VerifyOnly) { throw 'An interrupted installation needs recovery; rerun restore-runtime.ps1 with the matching archive' }
        Undo-Transaction $prior
    } elseif ($prior.status -eq 'complete') { Remove-OwnedStage (Bound-Path $repo ('.urania/runtime-stage-' + $prior.id)) $prior.id }
}
function Verify-Installed {
    $bad = [Collections.Generic.List[string]]::new()
    foreach ($row in $files) {
        $file = Bound-Path $repo $row.path
        if (-not [IO.File]::Exists($file) -or [IO.FileInfo]::new($file).Length -ne $row.bytes -or (Hash-File $file) -ne $row.sha256) { $bad.Add($row.path) }
    }
    return $bad
}
$missing = @(Verify-Installed)
if (-not $missing.Count) { @{status='verified';version=$package.version;uiBuild=$package.designcraftUiBuild;files=$files.Count;archiveNeeded=$false} | ConvertTo-Json -Compress; exit 0 }
if ($VerifyOnly) { throw ('Runtime verification failed for ' + $missing.Count + ' files. Run restore-runtime.ps1 -Download, or provide the matching -ArchivePath.') }
if (-not $ArchivePath) {
    if (-not $Download) { throw 'Provide a verified release ZIP with -ArchivePath, or use -Download' }
    if ($assets.archive.url -notmatch '^https://github\.com/TZUKWAN/Urania/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\.zip$' -or [IO.Path]::GetFileName($assets.archive.name) -ne $assets.archive.name) { throw 'Runtime download is not the pinned Urania GitHub Release' }
    $downloads = Bound-Path $repo '.urania/downloads'; New-Item -ItemType Directory -Path $downloads -Force | Out-Null
    $ArchivePath = Bound-Path $downloads $assets.archive.name
    $partial = $ArchivePath + '.part'
    if (-not (Test-Path -LiteralPath $ArchivePath)) {
        Invoke-WebRequest -Uri $assets.archive.url -OutFile $partial -Resume -MaximumRedirection 5 -ErrorAction Stop
        if ((Get-Item -LiteralPath $partial).Length -ne $assets.archive.bytes -or (Hash-File $partial) -ne $assets.archive.sha256) { throw 'Downloaded runtime ZIP hash/size mismatch; partial retained for inspection' }
        Move-Item -LiteralPath $partial -Destination $ArchivePath
    }
}
$ArchivePath = (Resolve-Path -LiteralPath $ArchivePath).Path
if ((Get-Item -LiteralPath $ArchivePath).Length -ne $assets.archive.bytes -or (Hash-File $ArchivePath) -ne $assets.archive.sha256) { throw 'Runtime ZIP hash/size mismatch; installed files have not been touched' }
$id = [guid]::NewGuid().ToString(); $stage = Bound-Path $repo ('.urania/runtime-stage-' + $id); $backup = Bound-Path $repo ('.urania/runtime-backup-' + $id)
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$transaction = [ordered]@{schemaVersion=1;id=$id;status='staging';manifestSha256=$assets.runtimeManifest.sha256;archiveSha256=$assets.archive.sha256;version=$package.version;uiBuild=$package.designcraftUiBuild;files=@()}
Write-AtomicJson $journalFile $transaction
try {
    $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName
            if (-not $seen.Add($name) -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Duplicate or symbolic-link ZIP entry refused' }
            if ($name -eq 'runtime-manifest.json') {
                $stream = $entry.Open(); $hasher=[Security.Cryptography.SHA256]::Create(); try { $digest = [Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant() } finally { $hasher.Dispose(); $stream.Dispose() }
                if ($digest -ne $assets.runtimeManifest.sha256) { throw 'ZIP manifest differs from the verified release manifest' }; continue
            }
            if (-not $expected.ContainsKey($name) -or $entry.Length -ne $expected[$name].bytes) { throw ('Unexpected ZIP entry or length: ' + $name) }
            $target = Bound-Path $stage $name
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            $inputStream = $entry.Open(); $outputStream = [IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try { $inputStream.CopyTo($outputStream,1MB); $outputStream.Flush($true) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
            if ((Hash-File $target) -ne $expected[$name].sha256) { throw ('Staged runtime hash mismatch: ' + $name) }
        }
        if ($seen.Count -ne $files.Count + 1 -or -not $seen.Contains('runtime-manifest.json')) { throw 'Runtime ZIP is missing declared files' }
    } finally { $zip.Dispose() }
    # Persist the complete undo plan once before the first installed-file change.
    # Rewriting an ever-growing journal for every SDK file caused quadratic I/O.
    $planned = [Collections.Generic.List[object]]::new()
    foreach ($row in $files) {
        $target = Bound-Path $repo $row.path
        if ((Test-Path -LiteralPath $target) -and (Hash-File $target) -eq $row.sha256) { continue }
        $had = Test-Path -LiteralPath $target; $oldHash = if ($had) { Hash-File $target } else { $null }
        $planned.Add([ordered]@{path=$row.path;hadOriginal=[bool]$had;oldSha256=$oldHash;newSha256=$row.sha256})
    }
    $transaction.files = $planned.ToArray()
    $transaction.status = 'installing'; Write-AtomicJson $journalFile $transaction
    foreach ($row in $transaction.files) {
        $target = Bound-Path $repo $row.path
        $had = Test-Path -LiteralPath $target
        $actual = if ($had) { Hash-File $target } else { $null }
        if ($had -ne $row.hadOriginal -or $actual -ne $row.oldSha256) { throw ('Runtime changed during install planning; retained: ' + $row.path) }
        if ($had) { $old = Bound-Path $backup $row.path; New-Item -ItemType Directory -Path (Split-Path -Parent $old) -Force | Out-Null; Move-Item -LiteralPath $target -Destination $old }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Move-Item -LiteralPath (Bound-Path $stage $row.path) -Destination $target
    }
    if (@(Verify-Installed).Count) { throw 'Installed runtime failed full file/hash verification' }
    $transaction.status = 'complete'; Write-AtomicJson $journalFile $transaction
    $receipt = @{status='restored-and-verified';version=$package.version;uiBuild=$package.designcraftUiBuild;files=$files.Count;expandedBytes=$total;manifestSha256=$assets.runtimeManifest.sha256;archiveSha256=$assets.archive.sha256;transactionId=$id}
    Write-AtomicJson (Bound-Path $repo '.urania/runtime-install.json') $receipt
    Remove-OwnedStage $stage $id
    $receipt | ConvertTo-Json -Compress
} catch {
    $reason = $_
    try { Undo-Transaction ($transaction | ConvertTo-Json -Depth 30 | ConvertFrom-Json) } catch { Write-Warning ('Automatic runtime recovery needs inspection: ' + $_.Exception.Message) }
    throw $reason
}
