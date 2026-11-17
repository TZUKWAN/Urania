import {readFileSync} from 'node:fs';
/** Allowlist: no chats, provider configuration, credentials or user paths. */
export function redactDiagnosticError(value){
 return String(value||'')
  .replace(/https?:\/\/[^\s"'<>]+/gi,'[URL]')
  .replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]')
  .replace(/\b(?:sk[-_]|ghp_|github_pat_)[a-z0-9_-]{8,}/gi,'[redacted]')
  .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g,'[redacted]')
  .replace(/(?:api[-_ ]?key|authorization|access[_-]?token|password|secret|cookie|session[_-]?token)\s*[:=]\s*["']?[^\s,;"']+["']?/gi,'[credential redacted]')
  .replace(/[A-Za-z]:[\\/][^\n\r"'<>]*/g,'[local path]')
  .replace(/\\\\[^\s"'<>]+/g,'[local path]')
  .replace(/\/(?:Users|home|tmp|var)\/[^\s"'<>]+/g,'[local path]')
  .replace(/\b[a-f0-9]{48,}\b/gi,'[opaque value]').slice(0,500);
}
export function designDiagnostics(manager,view){
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const jobs=[...manager.jobs.values()].filter(j=>j.sessionId===view.sessionId&&j.root===view.root).slice(-8).map(j=>({action:j.action,status:j.status,command:j.payload?.command?(/^[a-z0-9_.:-]{1,100}$/i.test(j.payload.command)?j.payload.command:'[invalid command]'):null,error:redactDiagnosticError(j.error)}));
 return {schema:1,at:new Date().toISOString(),plugin:{version:pkg.version,uiBuild:pkg.designcraftUiBuild},design:{engine:view.engine||null,connected:manager.active.get(view.sessionId)===view.id,ready:view.ready===true,nativeResponsive:view.nativeResponsive!==false,sourceSaved:!!view.sourceRevision,engineRevision:view.document?.revision??null,editorProtocol:view.editorProtocol??null},recentActions:jobs,privacy:{conversationIncluded:false,credentialsIncluded:false,localPathsIncluded:false,automaticallySent:false}};
}
