$ErrorActionPreference='Stop'
$runtimeDir=[IO.Path]::GetFullPath($PSScriptRoot)
$compilerExe=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source=Join-Path $runtimeDir 'PrivateLinkProtector.cs'
$target=Join-Path $runtimeDir 'private-link-protector.exe'
$lock=Join-Path $runtimeDir 'private-link-protector.lock.json'
$candidate=Join-Path $runtimeDir ('private-link-protector-build-'+[guid]::NewGuid().ToString('N')+'.exe')
foreach($path in @($source,$target,$lock,$candidate)){
 if(-not [IO.Path]::GetFullPath($path).StartsWith($runtimeDir+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Protector path escaped the runtime directory'}
}
if(!(Test-Path -LiteralPath $compilerExe)){throw 'C# compiler unavailable'}
if((Test-Path -LiteralPath $target) -or (Test-Path -LiteralPath $lock)){throw 'Protector or lock already exists; refusing to overwrite'}
try{
 & $compilerExe /nologo /optimize+ /platform:x64 /target:exe /r:System.Security.dll "/out:$candidate" $source
 if($LASTEXITCODE -ne 0){throw 'Private link protector compilation failed'}
 $record=@{schema=1;file='private-link-protector.exe';sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant();source='PrivateLinkProtector.cs';sourceSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLowerInvariant();scope='CurrentUser';algorithm='Windows DPAPI'}
 Move-Item -LiteralPath $candidate -Destination $target
 [IO.File]::WriteAllText($lock,($record|ConvertTo-Json -Depth 4)+"`n",[Text.UTF8Encoding]::new($false))
 Write-Output ($record|ConvertTo-Json -Compress)
}finally{
 if(Test-Path -LiteralPath $candidate){Remove-Item -LiteralPath $candidate -Force}
}
