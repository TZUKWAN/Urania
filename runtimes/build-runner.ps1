$ErrorActionPreference = 'Stop'
$runtimeDirectory = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$packageDirectory = Split-Path -Parent $runtimeDirectory
$compilerExe = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerExe)) { throw 'Windows .NET Framework x64 C# compiler is unavailable. The verified prebuilt runner can still be used.' }
$runnerSource = Join-Path $runtimeDirectory 'NativeRunner.cs'
$runnerTarget = Join-Path $runtimeDirectory 'native-runner.exe'
$runnerCandidate = Join-Path $runtimeDirectory ('native-runner-build-' + [guid]::NewGuid().ToString('N') + '.exe')
foreach ($checkedPath in @($runnerSource, $runnerTarget, $runnerCandidate)) {
    if (-not ([IO.Path]::GetFullPath($checkedPath).StartsWith($runtimeDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))) { throw 'Runner target escaped the intended runtime directory.' }
}
try {
    & $compilerExe /nologo /optimize+ /platform:x64 /target:exe "/out:$runnerCandidate" $runnerSource
    if ($LASTEXITCODE -ne 0) { throw 'Runner compilation failed; the existing runner was not replaced.' }
    Move-Item -LiteralPath $runnerCandidate -Destination $runnerTarget -Force
    $runtimeLockPath = Join-Path $packageDirectory 'runtime-lock.json'
    $runtimeLockData = Get-Content -LiteralPath $runtimeLockPath -Raw | ConvertFrom-Json -AsHashtable
    $runtimeLockData.runner.sha256 = (Get-FileHash -LiteralPath $runnerTarget -Algorithm SHA256).Hash.ToLowerInvariant()
    $runtimeLockData.runner.sourceSha256 = (Get-FileHash -LiteralPath $runnerSource -Algorithm SHA256).Hash.ToLowerInvariant()
    $runtimeLockCandidate = $runtimeLockPath + '.new-' + [guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($runtimeLockCandidate, ($runtimeLockData | ConvertTo-Json -Depth 12) + "`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($runtimeLockCandidate, $runtimeLockPath, $true)
    Write-Output ('Runner built and SHA-256 lock updated: ' + $runtimeLockData.runner.sha256)
} finally {
    if (Test-Path -LiteralPath $runnerCandidate) { Remove-Item -LiteralPath $runnerCandidate -Force }
}
