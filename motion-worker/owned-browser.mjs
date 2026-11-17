/** Close only the browser profile created by this render; never a user's browser. */
import path from 'node:path';import fs from 'node:fs';import {execFileSync} from 'node:child_process';
import {motionWorkerEnvironment} from '../host/motion/runtime-env.js';
export function stopOwnedBrowser(browser,profile){
 const absolute=path.resolve(profile);if(!/^\.browser-\d+$/.test(path.basename(absolute))||fs.existsSync(absolute)&&fs.lstatSync(absolute).isSymbolicLink())throw new Error('专用浏览器配置目录身份无效');
 if(process.platform==='win32'){
  const shell=path.join(process.env.SYSTEMROOT||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const script=String.raw`$ErrorActionPreference='Stop'; $profilePath=$env:URANIA_OWNED_BROWSER_PROFILE; if([string]::IsNullOrWhiteSpace($profilePath)){throw 'Missing owned profile'}; $targets=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(chrome|msedge|headless_shell)\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($profilePath)}); foreach($owned in $targets){if(Get-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue){$tool=Join-Path $env:SystemRoot 'System32/taskkill.exe'; Start-Process -FilePath $tool -ArgumentList @('/pid',[string]$owned.ProcessId,'/T','/F') -WindowStyle Hidden -Wait | Out-Null}}; $remaining=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(chrome|msedge|headless_shell)\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($profilePath)}); if($remaining.Count){throw 'Owned browser processes still running'}`;
  execFileSync(shell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:20000,maxBuffer:64*1024,env:{...motionWorkerEnvironment({}),URANIA_OWNED_BROWSER_PROFILE:absolute}});
 }else if(browser&&browser.exitCode===null){try{browser.kill('SIGKILL');}catch{}}
}
