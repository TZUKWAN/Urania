$ErrorActionPreference='Stop'
$runtimeDir=[IO.Path]::GetFullPath($PSScriptRoot)
$compilerExe=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source=Join-Path $runtimeDir 'GitSourceRunner.cs'
$target=Join-Path $runtimeDir 'git-source-runner.exe'
$lock=Join-Path $runtimeDir 'git-source-runner.lock.json'
$candidate=Join-Path $runtimeDir ('git-source-runner-build-'+[guid]::NewGuid().ToString('N')+'.exe')
foreach($path in @($source,$target,$lock,$candidate)){
 if(-not [IO.Path]::GetFullPath($path).StartsWith($runtimeDir+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Runner path escaped the runtime directory'}
}
if(!(Test-Path -LiteralPath $compilerExe)){throw 'C# compiler unavailable'}
if((Test-Path -LiteralPath $target) -or (Test-Path -LiteralPath $lock)){throw 'Runner or lock already exists; refusing to overwrite'}
try{
 & $compilerExe /nologo /optimize+ /platform:x64 /target:exe "/out:$candidate" $source
 if($LASTEXITCODE -ne 0){throw 'Git source runner compilation failed'}
 $record=@{schema=1;file='git-source-runner.exe';sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant();source='GitSourceRunner.cs';sourceSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLowerInvariant();processLimit=8;memoryMiB=384}
 Move-Item -LiteralPath $candidate -Destination $target
 [IO.File]::WriteAllText($lock,($record|ConvertTo-Json -Depth 4)+"`n",[Text.UTF8Encoding]::new($false))
 Write-Output ($record|ConvertTo-Json -Compress)
}finally{
 if(Test-Path -LiteralPath $candidate){Remove-Item -LiteralPath $candidate -Force}
}
