/** A real dedicated DSH Session, independent of the ordinary main conversation. */
const pathKey=value=>String(value||'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
export function selectedDesignProject(services){
 const catalog=services?.sessions?.list?.getSnapshot?.(),workspaces=services?.uiWorkspace?.workspaces?.list?.getSnapshot?.();
 if(catalog?.phase!=='ready'||workspaces?.phase!=='ready')return null;
 const id=services.uiSession?.adapter?.current?.getSnapshot?.()?.key,row=catalog.byId?.[id];
 const workspace=row&&workspaces.items.find(item=>item.sessionIds.includes(id)&&pathKey(item.path)===pathKey(row.cwd));
 return workspace?{workspaceId:workspace.workspaceId,root:workspace.path,title:workspace.title||workspace.path.split(/[\\/]/).filter(Boolean).at(-1),key:workspace.workspaceId+'\0'+pathKey(workspace.path)}:null;
}
export function currentDesignScope(services){return services?.designAssistant?.scope?.()||null;}
export function isActiveDesignSession(services,sessionId){return !!sessionId&&currentDesignScope(services)?.sessionId===sessionId;}

export class DesignAssistantSession {
 constructor({getServices,onChange=()=>{},reserve}){
  this.getServices=getServices;this.onChange=onChange;this.reserve=reserve||this.reserveRemote;
  this.state={phase:'idle',sessionId:null,root:null,reference:null,error:null};this.listeners=new Set();this.mounts=0;
 }
 getSnapshot=()=>this.state;
 subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 change(patch){this.state={...this.state,...patch};this.onChange(this.state);for(const listener of this.listeners)listener();}
 async reserveRemote(project,signal){
  const response=await fetch('/designcraft/api/v1/assistant/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({root:project.root,workspaceId:project.workspaceId}),signal});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'项目设计对话身份读取失败');return result.session;
 }
 start(){
  if(this.disposed)throw new Error('设计对话已关闭');this.mounts++;
  if(this.mounts===1){
   const s=this.getServices(),update=()=>this.update();
   this.unsubscribers=[s.uiSession?.adapter?.current,s.sessions?.list,s.uiWorkspace?.workspaces?.list].map(source=>source?.subscribe?.(update)).filter(Boolean);this.update();
  }
  let stopped=false;return()=>{if(stopped)return;stopped=true;if(--this.mounts===0){for(const off of this.unsubscribers||[])off();this.unsubscribers=[];if(this.state.phase==='loading'){this.cancel();this.change({phase:'idle',sessionId:null,reference:null});}}};
 }
 cancel(){this.attempt?.abort();this.attempt=null;const reference=this.reference;this.reference=null;reference?.release();}
 update(){
  if(this.disposed||!this.mounts)return;
  const project=selectedDesignProject(this.getServices());
  if(!project){if(this.state.phase!=='idle'||this.project){this.cancel();this.project=null;this.change({phase:'idle',sessionId:null,root:null,reference:null,error:null});}return;}
  if(this.project?.key===project.key&&['loading','ready','error'].includes(this.state.phase))return;
  this.cancel();this.project=project;const attempt=new AbortController();this.attempt=attempt;
  this.change({phase:'loading',sessionId:null,root:project.root,reference:null,error:null});
  void this.open(project,attempt);
 }
 current(project,attempt){return !this.disposed&&!attempt.signal.aborted&&this.attempt===attempt&&selectedDesignProject(this.getServices())?.key===project.key;}
 async open(project,attempt){
  let reference;
  try{
   const s=this.getServices(),record=await this.reserve(project,attempt.signal);
   if(!this.current(project,attempt))return;
   if(record.workspaceId!==project.workspaceId||pathKey(record.root)!==pathKey(project.root)||!/^session-dcdesign-[a-f0-9-]{36}$/.test(record.sessionId||''))throw new Error('设计对话身份不匹配，未绑定普通对话');
   const id=record.sessionId,row=s.sessions.list.getSnapshot().byId[id];let created=false;
   if(row&&pathKey(row.cwd)!==pathKey(project.root))throw new Error('设计对话目录已变化，未打开其他对话');
   if(!row){
    // Supplying the reserved identity prevents DSH's reusable-ordinary-blank
    // policy from selecting a draft belonging to another conversation.
    const actual=await s.sessions.create({workspaceId:project.workspaceId,sessionId:id});
    if(actual!==id)throw new Error('DSH 未恢复指定设计对话，未采用替代对话');created=true;
   }
   if(!this.current(project,attempt))return;
   reference=s.sessions.retain(id,{source:'designcraftAssistant',signal:attempt.signal});this.reference=reference;
   await reference.ready;
   if(!this.current(project,attempt)){reference.release();return;}
   const binding=s.uiSession.adapter.bindingSource(reference);
   if(binding.getSnapshot().key!==id)throw new Error('DSH 设计对话绑定尚未就绪');
   if(created)await reference.binding.session.rename('设计助手 · '+project.title);
   if(!this.current(project,attempt)){reference.release();return;}
   this.change({phase:'ready',sessionId:id,root:project.root,workspaceId:project.workspaceId,reference,binding,error:null});
  }catch(error){
   if(reference&&this.reference===reference){reference.release();this.reference=null;}
   if(this.current(project,attempt))this.change({phase:'error',sessionId:null,reference:null,error:error.message});
  }
 }
 scope(){
  const project=selectedDesignProject(this.getServices());
  if(this.disposed||this.state.phase!=='ready'||!project||project.key!==this.project?.key||!this.reference||this.reference!==this.state.reference)return null;
  let binding;try{binding=this.reference.binding;}catch{return null;}
  const owner=this.getServices().sessions.binding(this.state.sessionId);
  if(!owner||owner!==binding)return null;
  return {sessionId:this.state.sessionId,root:this.state.root};
 }
 retry(){this.cancel();this.project=null;this.change({phase:'idle',sessionId:null,reference:null,error:null});this.update();}
 dispose(){if(this.disposed)return;this.disposed=true;this.cancel();for(const off of this.unsubscribers||[])off();this.listeners.clear();}
}
