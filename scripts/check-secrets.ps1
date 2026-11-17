#requires -Version 7.2
[CmdletBinding()]
param([string]$RepositoryRoot=(Split-Path -Parent $PSScriptRoot),[string]$GitleaksPath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$repo=(Resolve-Path -LiteralPath $RepositoryRoot).Path
$toolRoot=Join-Path ([IO.Path]::GetTempPath()) ('urania-secret-scan-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $toolRoot | Out-Null
if (-not $GitleaksPath) {
 $archive=Join-Path $toolRoot 'gitleaks.zip'
 Invoke-WebRequest -Uri 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip' -OutFile $archive
 if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e') { throw 'Pinned gitleaks archive checksum differs; nothing executed' }
 Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolRoot 'tool')
 $GitleaksPath=Join-Path $toolRoot 'tool/gitleaks.exe'
}
$empty=Join-Path $toolRoot 'empty-ignore'
[IO.File]::WriteAllText($empty,'')
& $GitleaksPath dir $repo --no-banner --redact=100 --ignore-gitleaks-allow --max-archive-depth=6 --max-decode-depth=2 --config (Join-Path $repo '.gitleaks.toml') --gitleaks-ignore-path $empty --report-format json --report-path (Join-Path $toolRoot 'report.redacted.json')
$scanExit=$LASTEXITCODE
if ($scanExit -ne 0) { throw ('Credential scan failed, exit '+$scanExit+'; redacted report retained at '+$toolRoot) }
Write-Output ('Credential scan passed; redacted report: '+$toolRoot)
