import {HtmlArtifacts} from './html-artifacts.js';
import {inspectHtmlDependencyHints} from './html-dependency-hints.js';
import {tailwindFreezeStatus} from './html-tailwind-freeze.js';
import {attachHtmlProjectFont,htmlProjectFontStatus} from './html-project-font.js';
import {listProjectFonts} from './project-fonts.js';
import {createHash} from 'node:crypto';
import {importExternalHtml,externalHtmlStatus} from './external-html-import.js';
import {assertSafeJson, SafetyError} from './safety.js';
import {loadSavedOpenDesignPackage} from './open-design-package.js';
import {resourceHtmlId,selectResourceHtmlFiles,resourceHtmlSelection,resourceHtmlOmissions,resourceHtmlStatus,saveResourceHtmlIndex,loadResourceHtmlIndex} from './opendesign-html-import.js';
import {listHtmlProjectAssets,applyHtmlProjectAsset,inspectHtmlAssetOp,listHtmlAssetOps,recoverHtmlAssetOp} from './html-project-asset.js';

const actions = ['list', 'read', 'dependencies', 'create', 'save', 'from_resource', 'resource_status', 'from_external', 'external_status', 'project_assets', 'apply_asset', 'asset_status', 'asset_ops', 'asset_recover', 'project_fonts', 'attach_font', 'font_status', 'convert', 'freeze_tailwind', 'freeze_tailwind_status'];
const stringFile = (path, text) => ({path, data:Buffer.from(text, 'utf8').toString('base64')});

export async function materializeHtmlResource({library,store,resourceId,entry,title,signal,operationId,assertCurrent}){
 if(!library)throw new SafetyError('OpenDesign 资源库尚未接入',503);
 if(operationId){const status=await resourceHtmlStatus({library,store,operationId,resourceId,entry});if(status.found){signal?.throwIfAborted();assertCurrent?.();return {...status,reused:true};}}
 const index=library.index(),pack=index.packages.get(resourceId);
 if(!pack||typeof entry!=='string'||!pack.fileMap.has(entry))throw new SafetyError('请选择固定资源包中实际存在的 HTML 文件',422);
 const selection=selectResourceHtmlFiles(pack,entry);
 const saved=store.root?await loadSavedOpenDesignPackage(library,store.root,pack.id):null;signal?.throwIfAborted();
 const files=[];for(let i=0;i<selection.selected.length;i+=4){signal?.throwIfAborted();assertCurrent?.();const batch=await Promise.all(selection.selected.slice(i,i+4).map(async item=>({path:item.path,data:(saved?library.verify(saved.files.get(item.path),item):await library.fetchFile(pack.id+'/'+item.path,item,signal)).toString('base64')})));files.push(...batch);}
 const verified=resourceHtmlSelection(library,pack,entry,files),omitted=resourceHtmlOmissions(verified.omitted);signal?.throwIfAborted();assertCurrent?.();const indexSnapshot=saveResourceHtmlIndex(library,store.root),snapshotLibrary=loadResourceHtmlIndex(store.root,indexSnapshot).library,snapshotSelection=resourceHtmlSelection(snapshotLibrary,snapshotLibrary.index().packages.get(pack.id),entry,files);if(snapshotSelection.selectionSha256!==verified.selectionSha256)throw new SafetyError('保存的 OpenDesign 索引与导入文件不一致，未发布网页',409);const provenance={source:'opendesign',repository:index.repository,revision:index.revision,packageId:pack.id,entry,license:index.license,selectionVersion:3,indexSnapshot,selectionSha256:verified.selectionSha256,includedCount:verified.included.length,omittedCount:verified.omitted.length,omitted,omittedFiles:omitted.map(item=>item.path)};
 signal?.throwIfAborted();assertCurrent?.();let created;try{created=operationId?await store.save({id:resourceHtmlId(operationId),baseRevision:null,title:title||pack.name,entry,files,provenance}):await store.create({title:title||pack.name,entry,files,provenance});}catch(error){if(operationId&&error.status===409&&!signal?.aborted){const status=await resourceHtmlStatus({library,store,operationId,resourceId,entry});if(status.found){assertCurrent?.();return {...status,reused:true};}}throw error;}
 try{assertCurrent?.();}catch(error){error.retained={id:created.id,revision:created.revision};throw error;}
 return {id:created.id,revision:created.revision,originalRevision:created.revision,title:created.document.title,omittedFiles:omitted.map(item=>item.path),omittedCount:verified.omitted.length,omitted,warning:'原包文件按安全预算保存；主机不会执行源码，外部网络资源不会自动加载。被排除文件已列出。'};
}

/** Uses the same DSH session and model; no second agent or external process. */
export function htmlToolDefinition(library,manager) {
 return {
  name:'designcraft_html',
  description:'Manage actual versioned HTML/CSS design sources in this DSH workspace. Read a saved revision before editing. dependencies gives bounded, heuristic external-origin hints from saved HTML/CSS without network access; it is not a complete dependency or security audit. create/save preserve files and use compare-and-swap; local interactive edits may be in a separate draft. from_resource copies a pinned OpenDesign HTML source and its admitted resources with a stable operationKey or tool call identity. resource_status checks the same operation without creating a duplicate; selected files are verified against pinned Git blobs and Git LFS pointers are rejected. from_external imports an already saved and verified external bundle HTML with an explicit bundle or entry-directory scope and stable operationKey; actual omitted files and LFS pointers are reported; includeLfs=true explicitly fetches supported LFS contents and may use network. external_status checks that same local operation without creating a duplicate. project_assets lists current project derivatives; apply_asset explicitly adds an actual saved PNG/SVG to an exact HTML revision without editing its entry, and asset_status/asset_ops/asset_recover inspect or recover stable local records. project_fonts lists registered project fonts; attach_font adds one verified TTF/OTF and an explicit user-selected family, weight and style CSS mapping to a new HTML revision, but does not modify the entry. The returned link must be inserted where wanted. font_status checks the same operationKey, id and base revision after an uncertain result; existing local drafts remain separate. Font rights, glyph coverage, display and PPT embedding require independent confirmation. convert executes the actual isolated preview and PPTX conversion in the active DesignCraft workspace and opens a separate editable Deck source; it requires id and revision. Explicit tailwindCompat=true downloads a fixed-hash official Tailwind Play CDN script for an isolated temporary preview, supports only a narrow original script tag, and does not prove styling, font availability or offline export. A timeout or uncertain result requires inspecting saved conversion records before retrying. Conversion does not synchronise later edits back to HTML. freeze_tailwind explicitly uses the same fixed-hash CDN script in an isolated preview and saves client-reported CSS and its license to a new HTML revision, preserving the original; requires id, revision and a stable operationKey (or call identity). It cannot prove dynamic classes, font availability or visual fidelity. After timeout or an uncertain result use freeze_tailwind_status with the same id, base revision and operationKey before retrying; cssSha256 is optional for status.',
  parameters:{type:'object', additionalProperties:false, required:['action'], properties:{
   action:{type:'string', enum:actions}, id:{type:'string'}, revision:{type:'string'}, title:{type:'string'}, entry:{type:'string'}, resourceId:{type:'string'}, bundleId:{type:'string'}, assetId:{type:'string'}, fontId:{type:'string'}, family:{type:'string'}, weight:{type:'integer',minimum:1,maximum:1000}, fontStyle:{type:'string',enum:['normal','italic','oblique']}, query:{type:'string'}, candidate:{type:'string'}, scope:{type:'string',enum:['bundle','entry-directory']}, includeLfs:{type:'boolean'}, tailwindCompat:{type:'boolean'}, operationKey:{type:'string'}, cssSha256:{type:'string'},
   text:{type:'string', description:'UTF-8 content for the selected HTML or text resource.'}, file:{type:'string'},
   resources:{type:'array', maxItems:256, items:{type:'object', additionalProperties:false, required:['path','data'], properties:{path:{type:'string'}, data:{type:'string', description:'Exact file bytes in Base64.'}}}},
   removePaths:{type:'array', maxItems:256, items:{type:'string'}}, offset:{type:'integer', minimum:0}, limit:{type:'integer', minimum:1, maximum:40000}
  }},
  output:{schema:{type:'object', additionalProperties:false, required:['json'], properties:{json:{type:'string'}}}, render:(_args, value)=>[{type:'text', text:value.json}]},
  timeoutMs:240000,
  isConcurrencySafe:args => ['list','read','dependencies','resource_status','external_status','project_assets','asset_status','asset_ops','project_fonts','font_status','freeze_tailwind_status'].includes(args.action),
  async execute(args, execution) {
   let externalContext;try {
    assertSafeJson(args);
    execution.signal?.throwIfAborted();
    const root = execution.agent?.session?.header?.cwd;
    if (!root) throw new SafetyError('当前 DSH 会话没有项目目录', 422);
    const store = new HtmlArtifacts(root);
    let result;
    if (args.action === 'list') result = {items:await store.list()};
    else if (args.action === 'read') {
     const saved = await store.read(args.id, args.revision);
     const path = args.file || saved.document.entry;
     const file = saved.document.files.find(item => item.path === path);
     if (!file) throw new SafetyError('网页文件不存在', 404);
     const offset = args.offset ?? 0, limit = args.limit ?? 20000;
     if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 40000) throw new SafetyError('网页读取范围无效', 422);
     const text = /^(?:text\/|application\/json|image\/svg\+xml)/.test(file.mime) ? new TextDecoder('utf-8', {fatal:true}).decode(Buffer.from(file.data, 'base64')) : null;
     result = {id:args.id, revision:saved.revision, title:saved.document.title, entry:saved.document.entry, historical:saved.historical,
      files:saved.document.files.map(({path,mime,bytes,sha256})=>({path,mime,bytes,sha256})), file:path,
      ...(text === null ? {binary:true, bytes:file.bytes, sha256:file.sha256} : {content:text.slice(offset, offset + limit), offset, totalCharacters:text.length, nextOffset:offset + limit < text.length ? offset + limit : null})};
    } else if (args.action === 'dependencies') {
     const saved=await store.read(args.id,args.revision);result={id:args.id,revision:saved.revision,...inspectHtmlDependencyHints(saved.document.files)};
    } else if (['project_fonts','attach_font','font_status'].includes(args.action)) {
     const session=execution.agent?.session;if(!manager||!session?.id)throw new SafetyError('网页字体需要当前 DSH 项目',422);
     const actualRoot=manager.scope(session.id),current=()=>{if(manager.scope(session.id)!==actualRoot)throw new SafetyError('工作区已切换，请回原项目核对网页字体',409);};
     if(args.action==='project_fonts'){result={items:(await listProjectFonts(actualRoot)).map(item=>item.record),note:'只列出当前启用的项目字体；使用和分发许可需按实际条款确认。'};current();}
     else{
      const key=args.operationKey||(args.action==='attach_font'?execution.callId:null);
      if(!/^html-[a-f0-9-]{36}$/.test(args.id||'')||!/^[a-f0-9]{64}$/.test(args.revision||'')||typeof key!=='string'||!key||key.length>250||/[\x00-\x1f]/.test(key))throw new SafetyError('网页字体需要网页 ID、基础版本和稳定操作身份',422);
      const operationId=createHash('sha256').update(JSON.stringify([session.id,key,args.id,args.revision])).digest('hex'),expected={baseRevision:args.revision,fontId:args.fontId,family:args.family,weight:args.weight,style:args.fontStyle};externalContext={sessionId:session.id,root:actualRoot,operationKey:key};
      result=args.action==='font_status'?await htmlProjectFontStatus(new HtmlArtifacts(actualRoot),args.id,operationId,expected):await attachHtmlProjectFont(library,actualRoot,{id:args.id,operationId,...expected},execution.signal,current);current();if(args.action==='attach_font'&&result.found)manager.onChange(actualRoot,{kind:'html-source',id:args.id,revision:result.revision});result={...result,operationKey:key};
     }
    } else if (args.action === 'freeze_tailwind' || args.action === 'freeze_tailwind_status') {
     const session=execution.agent?.session,key=args.operationKey||(args.action==='freeze_tailwind'?execution.callId:null);
     if(!manager||!session?.id||!/^html-[a-f0-9-]{36}$/.test(args.id||'')||!/^[a-f0-9]{64}$/.test(args.revision||'')||typeof key!=='string'||!key||key.length>250||/[\x00-\x1f]/.test(key)||args.cssSha256!==undefined&&!/^[a-f0-9]{64}$/.test(args.cssSha256))throw new SafetyError('静态样式保存需要当前项目、网页 ID、基础版本和稳定身份',422);
     if(args.action==='freeze_tailwind'&&args.cssSha256!==undefined)throw new SafetyError('CSS 摘要仅用于核对已保存状态，开始保存时由实际预览计算',422);
     const actualRoot=manager.scope(session.id),scopedStore=new HtmlArtifacts(actualRoot),operationId=createHash('sha256').update(JSON.stringify([session.id,key,args.id,args.revision])).digest('hex');
     const current=()=>{if(manager.scope(session.id)!==actualRoot)throw new SafetyError('工作区已切换，请回原项目核对样式保存',409);};externalContext={sessionId:session.id,root:actualRoot,operationKey:key};
     const status=await tailwindFreezeStatus(scopedStore,args.id,operationId,{baseRevision:args.revision,cssSha256:args.cssSha256});current();
     if(args.action==='freeze_tailwind_status'||status.found)result={...status,operationKey:key,...(status.found&&args.action==='freeze_tailwind'?{reused:true}:{})};
     else{const saved=await scopedStore.read(args.id);if(saved.revision!==args.revision)throw new SafetyError('网页已有新版本，请先读取最新版本',409);result={...await manager.request(session.id,{action:'html_freeze_tailwind',payload:{id:args.id,revision:args.revision,operationKey:key},operationId:execution.callId},execution.signal),operationKey:key};current();}
    } else if (args.action === 'convert') {
     if(!manager||!execution.agent?.session?.id||!args.id||!args.revision)throw new SafetyError('网页转换需要当前工作区、网页 ID 和保存版本',422);
     if(args.tailwindCompat!==undefined&&typeof args.tailwindCompat!=='boolean')throw new SafetyError('Tailwind 预览选项无效',422);
     const saved=await store.read(args.id);if(saved.revision!==args.revision)throw new SafetyError('网页已有新版本，请先读取最新版本',409);
     result=await manager.request(execution.agent.session.id,{action:'html_convert',payload:{id:args.id,revision:args.revision,...(args.tailwindCompat?{tailwindCompat:true}:{})},operationId:execution.callId},execution.signal);
    } else if (args.action === 'from_resource' || args.action === 'resource_status') {
     const session=execution.agent?.session;if(!manager||!session?.id)throw new SafetyError('固定网页需要当前 DSH 项目',422);const actualRoot=manager.scope(session.id),scopedStore=new HtmlArtifacts(actualRoot),key=args.operationKey||(args.action==='from_resource'?execution.callId:null);if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('固定网页导入需要稳定操作身份',422);externalContext={sessionId:session.id,root:actualRoot,operationKey:key};const operationId=createHash('sha256').update(session.id+'\0'+key).digest('hex'),current=()=>{if(manager.scope(session.id)!==actualRoot)throw new SafetyError('工作区已切换，请回原项目核对固定网页',409);};
     result=args.action==='from_resource'?await materializeHtmlResource({library,store:scopedStore,resourceId:args.resourceId,entry:args.entry,title:args.title,operationId,signal:execution.signal,assertCurrent:current}):await resourceHtmlStatus({library,store:scopedStore,operationId,resourceId:args.resourceId,entry:args.entry});current();result={...result,operationKey:key};
    } else if (['project_assets','apply_asset','asset_status','asset_ops','asset_recover'].includes(args.action)) {
     const session=execution.agent?.session;if(!manager||!session?.id)throw new SafetyError('网页素材需要当前 DSH 项目',422);const actualRoot=manager.scope(session.id),current=()=>{if(manager.scope(session.id)!==actualRoot)throw new SafetyError('工作区已切换，请回原项目核对网页素材',409);};
     if(args.action==='project_assets')result=await listHtmlProjectAssets(actualRoot,{query:args.query||'',offset:args.offset??0,limit:Math.min(args.limit??30,100)});
     else if(args.action==='asset_status')result=await inspectHtmlAssetOp(actualRoot,args.id);
     else if(args.action==='asset_ops')result=await listHtmlAssetOps(actualRoot,{offset:args.offset??0,limit:Math.min(args.limit??30,100)});
     else if(args.action==='asset_recover')result=await recoverHtmlAssetOp(actualRoot,args.candidate,execution.signal,current);
     else{const key=args.operationKey||execution.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('网页素材加入需要稳定操作身份',422);externalContext={sessionId:session.id,root:actualRoot,operationKey:key};const operationId=createHash('sha256').update(session.id+'\0'+key).digest('hex');result={...await applyHtmlProjectAsset(actualRoot,{htmlId:args.id,baseRevision:args.revision,assetId:args.assetId,operationId},execution.signal,current),operationKey:key};}current();
    } else if (args.action === 'from_external' || args.action === 'external_status') {
     const session=execution.agent?.session;if(!manager||!session?.id)throw new SafetyError('外部网页需要当前 DSH 项目',422);const actualRoot=manager.scope(session.id),key=args.operationKey||(args.action==='from_external'?execution.callId:null);if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('外部网页导入需要稳定操作身份',422);externalContext={sessionId:session.id,root:actualRoot,operationKey:key};const operationId=createHash('sha256').update(session.id+'\0'+key).digest('hex'),current=()=>{if(manager.scope(session.id)!==actualRoot)throw new SafetyError('工作区已切换，请回原项目核对外部网页',409);};
     result=args.action==='from_external'?await importExternalHtml({library,root:actualRoot,bundleId:args.bundleId,entry:args.entry,scope:args.scope||'bundle',includeLfs:args.includeLfs===true,title:args.title,operationId,signal:execution.signal,assertCurrent:current}):await externalHtmlStatus(actualRoot,operationId,{bundleId:args.bundleId,entry:args.entry,scope:args.scope||'bundle',includeLfs:args.includeLfs===true});current();result={...result,operationKey:key};
    } else if (args.action === 'create') {
     if (typeof args.text !== 'string') throw new SafetyError('新网页需要 HTML 源码', 422);
     const entry = args.entry || 'index.html';
     result = await store.create({title:args.title || '未命名网页', entry, files:[stringFile(entry, args.text), ...(args.resources || [])], provenance:{source:'dsh-conversation'}});
     result = {id:result.id, revision:result.revision, title:result.document.title};
    } else if (args.action === 'save') {
     const saved = await store.read(args.id);
     if (!args.revision || args.revision !== saved.revision) throw new SafetyError('网页已有新版本，请先读取最新版本', 409);
     const changed = new Map((args.resources || []).map(item => [item.path, item]));
     if (typeof args.text === 'string') changed.set(args.file || saved.document.entry, stringFile(args.file || saved.document.entry, args.text));
     const removed = new Set(args.removePaths || []);
     const files = saved.document.files.filter(item => !removed.has(item.path) && !changed.has(item.path)).map(({path,data})=>({path,data}));
     files.push(...changed.values());
     const next = await store.save({id:args.id, baseRevision:args.revision, title:args.title || saved.document.title, entry:args.entry || saved.document.entry, files});
     result = {id:next.id, revision:next.revision, title:next.document.title};
    } else throw new SafetyError('未知网页操作', 422);
    // Once an immutable version is committed, report it even if cancellation
    // arrived during the save; otherwise a retry could create a duplicate.
    if (execution.signal?.aborted && ['create','save','from_resource','from_external','apply_asset','asset_recover','attach_font','freeze_tailwind'].includes(args.action)) {
     return {json:JSON.stringify({ok:true,...result,completedAfterCancel:true,cancelNote:'保存已完成，请检查此版本，不要重复创建。'})};
    }
    execution.signal?.throwIfAborted();
    return {json:JSON.stringify({ok:true, ...result})};
   } catch (error) {
    let retained,operationKey;try{if(externalContext&&manager.scope(externalContext.sessionId)===externalContext.root){retained=error.retained;operationKey=externalContext.operationKey;}}catch{}return {json:JSON.stringify({ok:false, status:error.status || 500, error:String(error.message || error),...(retained?{retained}:{}),...(operationKey?{operationKey}:{}),readStateBeforeRetry:true})};
   }
  }
 };
}

export function registerHtmlTool(ctx,library,manager) {
 ctx.inject(['tools'], scope => {
  const dispose = scope.tools.register(htmlToolDefinition(library,manager));
  scope.effect(() => () => dispose?.(), 'designcraft: HTML source tool');
 });
}
