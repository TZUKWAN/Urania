import {mkdir,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import * as legacy from './docstore.js';
import {revisionOf} from './persistence.js';
import {workspacePath,SafetyError,assertPortableName,assertSafeJson} from './safety.js';
import {createZip} from './zip.js';
import {buildDeckPackage} from './deck-native.js';
import {nativeDeckPackage,combineDeckSource} from './deck-source.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const ext={vectorcraft:'vectorcraft',photocraft:'pcraft',deckcraft:'deckcraft'};
const idPattern=/^migration-[a-f0-9-]{36}$/;
const itemPattern=/^(?:source|page|deck)-[a-zA-Z0-9_-]{1,80}$/;
function remapAssets(value,map,key=''){
 if(typeof value==='string')return ['asset','src','source','svg','renderedAsset','original','maskAsset','guideAsset'].includes(key)&&map[value]?map[value]:value;
 if(Array.isArray(value))return value.map(item=>remapAssets(item,map,key));
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,remapAssets(item,map,name)]));
}

/** A migration snapshot owns copies; it never changes the compatibility work. */
export class LegacyMigration {
 constructor(root){this.root=legacy.validateRoot(root);}
 directory(id){if(!idPattern.test(id||''))throw new SafetyError('迁移记录 ID 无效',422);return workspacePath(this.root,join('design','.designcraft','v2','migrations',id));}
 file(id,...parts){return workspacePath(this.root,join(this.directory(id),...parts));}
 list(){return legacy.listDocs(this.root);}
 async snapshot(docId,revision){
  const old=legacy.readDoc(this.root,docId);if(old.revision!==revision)throw new SafetyError('旧作品已改变，请刷新后迁移',409);
  const raw=await readFile(workspacePath(this.root,join('design',docId+'.dc.json'),{mustExist:true}));
  if(revisionOf(raw.toString('utf8'))!==revision)throw new SafetyError('旧作品在读取期间改变，未创建迁移快照',409);
  const available=new Set(legacy.listAssets(this.root).map(item=>item.name)),names=new Set(),missing=new Set(),native=[],seen=new Set();
  function source(engine,name,label){
   if(!ext[engine]||typeof name!=='string')return;
   assertPortableName(name);const key=engine+'\0'+name;if(seen.has(key))return;seen.add(key);
   if(!available.has(name)){missing.add(name);return;}
   names.add(name);native.push({engine,name,label:label||name});
  }
  let count=0;
  function walk(value,key='',depth=0){
   if(++count>100000||depth>64)throw new SafetyError('旧作品结构超过迁移预算',413);
   if(typeof value==='string'){
    if(available.has(value))names.add(value);
    else if(['asset','src','source','svg','renderedAsset','original','maskAsset'].includes(key)&&/\.(?:png|jpe?g|webp|svg|pcraft|vectorcraft|deckcraft|pptx)$/i.test(value)&&!/[\\/:]/.test(value))missing.add(value);
    return;
   }
   if(!value||typeof value!=='object')return;
   if(Array.isArray(value)){for(const child of value)walk(child,key,depth+1);return;}
   if(value.native?.engine&&value.native?.source)source(value.native.engine,value.native.source,value.name);
   for(const [name,child] of Object.entries(value))walk(child,name,depth+1);
  }
  walk(old.doc);source(old.doc.native?.deck?.engine,old.doc.native?.deck?.source,old.doc.title);
  const id='migration-'+randomUUID(),dir=this.directory(id),entries=[{name:'original/'+docId+'.dc.json',data:raw}],copied=new Map();
  let total=raw.length;
  for(const name of names){
   assertPortableName(name);const bytes=legacy.readAsset(this.root,name);
   if(!bytes){missing.add(name);continue;}total+=bytes.length;if(total>128*1024*1024)throw new SafetyError('旧作品及所引用素材超过128MiB迁移预算',413);
   copied.set(name,bytes);entries.push({name:'original/assets/'+name,data:bytes,store:true});
  }
  if(legacy.readDoc(this.root,docId).revision!==revision)throw new SafetyError('旧作品在快照期间改变，未创建迁移记录',409);
  const warnings=[];if(missing.size)warnings.push('旧作品有缺失素材：'+[...missing].join('、'));
  const assetMap={};for(const [name,bytes] of copied){const extension=extname(name);assetMap[name]=legacy.saveAsset(this.root,'migration-'+digest(bytes).slice(0,24)+extension,bytes).name;}
  const renderDoc=remapAssets(old.doc,assetMap);
  const items=native.filter(item=>copied.has(item.name)).map((item,index)=>({id:'source-'+index,kind:'native-source',engine:item.engine,title:item.label,sourceName:item.name,sha256:digest(copied.get(item.name)),bytes:copied.get(item.name).length,extension:ext[item.engine]}));
  if(old.doc.type==='deck'){
   try{
    let built;
    if(old.doc.native?.deck?.mode==='source'){
     const source=copied.get(old.doc.native.deck.source);if(!source)throw new SafetyError('旧演示底稿缺失',422);
     const original=nativeDeckPackage(source),overlays={...renderDoc,__root:this.root,pages:renderDoc.pages.map(page=>({...page,layers:(page.layers||[]).filter(layer=>!(layer.type==='native'&&layer.native?.engine==='deckcraft'&&layer.native.role==='page'))}))};
     built=combineDeckSource(old.doc,original,buildDeckPackage(overlays,{}, {idStart:original.model.presentation.nextId})).buffer;
     if(old.doc.pages.some(page=>page.native?.engine==='deckcraft'&&page.notes!==page.native.originalNotes))warnings.push('修改过的旧演示备注保留在备份中，需要在新演示中核对。');
    }else built=buildDeckPackage({...renderDoc,__root:this.root}).buffer;
    if(built.length>64*1024*1024)throw new SafetyError('演示迁移文件超过64MiB预算',413);
    items.unshift({id:'deck-composition',kind:'deck-composition',engine:'deckcraft',title:old.doc.title+' · 原生演示',sha256:digest(built),bytes:built.length,extension:'deckcraft'});copied.set('@deck-composition',built);
   }catch(error){warnings.push('旧演示完整合成未能自动转换：'+error.message+'；旧作品及可恢复的专业源均保留。');}
  }else{
   warnings.push('每个画板可转换为新的 SVG 设计；位图、部分效果和字体以导入器支持范围为准。原生图片与矢量源另列供独立恢复。');
  }
  const snapshot={schema:1,id,docId,revision,title:old.doc.title||docId,type:old.doc.type||'canvas',at:new Date().toISOString(),items,warnings,missing:[...missing],pages:old.doc.pages.map((page,index)=>({id:page.id,index,title:page.name||'画板 '+(index+1)})),assetNames:[...names],assetMap};
  entries.push({name:'migration.json',data:json(snapshot)});const archive=createZip(entries);if(archive.length>160*1024*1024)throw new SafetyError('旧作品备份超过预算',413);
  snapshot.backupSha256=digest(archive);snapshot.backupBytes=archive.length;
  await mkdir(this.file(id,'items'),{recursive:true});await mkdir(this.file(id,'receipts'),{recursive:true});
  await writeFile(this.file(id,'original.zip'),archive,{flag:'wx'});await writeFile(this.file(id,'document.json'),raw,{flag:'wx'});
  for(const item of items){const bytes=item.kind==='deck-composition'?copied.get('@deck-composition'):copied.get(item.sourceName);await writeFile(this.file(id,'items',item.sha256+'.'+item.extension),bytes,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});}
  const metadata=json(snapshot);await writeFile(this.file(id,'snapshot.json'),metadata,{flag:'wx'});await writeFile(this.file(id,'snapshot.sha256'),digest(metadata)+'\n',{flag:'wx'});
  return snapshot;
 }
 async read(id){
  const data=await readFile(this.file(id,'snapshot.json'));if(data.length>1024*1024)throw new SafetyError('迁移记录超过预算',413);
  const expected=(await readFile(this.file(id,'snapshot.sha256'),'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(expected)||digest(data)!==expected)throw new SafetyError('迁移快照记录完整性失败，原始文件未改变',409);
  const value=JSON.parse(data);assertSafeJson(value);if(value.id!==id||value.schema!==1)throw new SafetyError('迁移记录身份不一致',409);
  const receipts=[];for(const name of await readdir(this.file(id,'receipts'))){if(!/\.json$/.test(name))continue;const receipt=JSON.parse(await readFile(this.file(id,'receipts',name),'utf8'));receipts.push(receipt);}
  return {...value,receipts};
 }
 async plans(){
  let dirs;try{dirs=await readdir(workspacePath(this.root,join('design','.designcraft','v2','migrations')),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const result=[];for(const dir of dirs){if(!dir.isDirectory()||!idPattern.test(dir.name))continue;try{result.push(await this.read(dir.name));}catch(error){result.push({id:dir.name,error:error.message});}}
  return result.sort((a,b)=>(b.at||'').localeCompare(a.at||''));
 }
 async document(id){const plan=await this.read(id),data=await readFile(this.file(id,'document.json'));if(data.length>16*1024*1024)throw new SafetyError('旧作品快照超过预算',413);if(revisionOf(data.toString('utf8'))!==plan.revision)throw new SafetyError('旧作品快照与原始版本不一致',409);return remapAssets(JSON.parse(data),plan.assetMap||{});}
 async stagePage(id,pageId,svg){
  const snapshot=await this.read(id),index=snapshot.pages.findIndex(page=>page.id===pageId);
  if(index<0||typeof svg!=='string'||!svg.trim()||Buffer.byteLength(svg)>8*1024*1024)throw new SafetyError('画板 SVG 无效或超过8MiB预算',422);
  const bytes=Buffer.from(svg),item={id:'page-'+index,kind:'page-svg',engine:'vectorcraft',title:snapshot.title+' · '+snapshot.pages[index].title,sha256:digest(bytes),bytes:bytes.length,extension:'svg',pageId};
  const path=this.file(id,'items',item.sha256+'.svg');await writeFile(path,bytes,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await writeFile(this.file(id,'items',item.id+'-'+item.sha256+'.json'),json(item),{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});return item;
 }
 async item(id,itemId,sha){
  if(!itemPattern.test(itemId||'')||!/^[a-f0-9]{64}$/.test(sha||''))throw new SafetyError('迁移项目身份无效',422);
  const plan=await this.read(id);let item=plan.items.find(row=>row.id===itemId&&row.sha256===sha);
  if(!item&&itemId.startsWith('page-')){try{item=JSON.parse(await readFile(this.file(id,'items',itemId+'-'+sha+'.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}
  if(!item||item.id!==itemId||item.sha256!==sha)throw new SafetyError('迁移项目不存在',404);
  const bytes=await readFile(this.file(id,'items',sha+'.'+item.extension));if(bytes.length!==item.bytes||digest(bytes)!==sha)throw new SafetyError('迁移文件完整性失败',409);return {item,bytes};
 }
 async candidates(id,itemId,sha){
  const {item}=await this.item(id,itemId,sha),store=new (await import('./native-source-store.js')).NativeSourceStore(this.root),results=[];
  for(const source of await store.list()){
   if(source.error||source.engine!==item.engine)continue;
   const file=workspacePath(this.root,join(store.directory(source.id),'originals',sha+'.'+item.extension));
   try{if((await stat(file)).size===item.bytes&&digest(await readFile(file))===sha)results.push({sourceId:source.id,sourceRevision:source.revision,title:source.title});}catch(error){if(error.code!=='ENOENT')throw error;}
  }return results;
 }
 async receipt(id,itemId,sha,sourceId){
  const matches=await this.candidates(id,itemId,sha),match=matches.find(source=>source.sourceId===sourceId);
  if(!match)throw new SafetyError('导入源与迁移原件不一致，未写入回执',409);
  const value={schema:1,id,itemId,sha256:sha,...match,at:new Date().toISOString()};
  const path=this.file(id,'receipts','receipt-'+digest(Buffer.from(JSON.stringify([itemId,sha,sourceId])))+'.json');
  await writeFile(path,json(value),{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});return value;
 }
 async note(id,pageId,message){
  const plan=await this.read(id);if(!plan.pages.some(page=>page.id===pageId)||typeof message!=='string'||!message.trim()||message.length>1000)throw new SafetyError('迁移说明无效',422);
  const value={schema:1,id,pageId,kind:'page-error',message:message.trim(),at:new Date().toISOString()};
  await writeFile(this.file(id,'receipts','note-'+randomUUID()+'.json'),json(value),{flag:'wx'});return value;
 }
 async backup(id){const plan=await this.read(id),bytes=await readFile(this.file(id,'original.zip'));if(bytes.length!==plan.backupBytes||digest(bytes)!==plan.backupSha256)throw new SafetyError('旧作品备份完整性失败，原件未改变',409);return bytes;}
}

export function legacyMigrationRoutes(manager,{guard,readJsonBody,sendJson}){
 const base='/designcraft/api/v2/studio/legacy',viewFor=req=>manager.getView(req.headers['x-designcraft-view'],req.headers['x-designcraft-capability']);
 return [
  {kind:'exact',path:base,handler:guard(async(req,res)=>{
   if(req.method!=='POST')throw new SafetyError('POST required',405);
   const body=await readJsonBody(req,12*1024*1024),view=viewFor(req);if(body.epoch!==view.epoch)throw new SafetyError('工作区已经切换',409);
   const migration=new LegacyMigration(manager.scope(view.sessionId,view.root));let result;
   if(body.action==='list')result={docs:migration.list(),plans:await migration.plans()};
   else if(body.action==='snapshot'){manager.fileActionIdle(view,body.epoch);result={plan:await migration.snapshot(body.docId,body.revision)};}
   else if(body.action==='read')result={plan:await migration.read(body.id),document:await migration.document(body.id)};
   else if(body.action==='stage-page')result={item:await migration.stagePage(body.id,body.pageId,body.svg)};
   else if(body.action==='candidates')result={sources:await migration.candidates(body.id,body.itemId,body.sha256)};
   else if(body.action==='receipt'){manager.fileActionIdle(view,body.epoch);result={receipt:await migration.receipt(body.id,body.itemId,body.sha256,body.sourceId)};}
   else if(body.action==='note')result={note:await migration.note(body.id,body.pageId,body.message)};
   else throw new SafetyError('未知迁移操作',422);
   sendJson(res,200,{ok:true,...result});
  })},
  {kind:'exact',path:base+'-file',handler:guard(async(req,res)=>{
   if(req.method!=='GET')throw new SafetyError('GET required',405);
   const view=viewFor(req),q=new URL(req.url,'http://localhost').searchParams;if(q.get('epoch')!==view.epoch)throw new SafetyError('工作区已经切换',409);
   const migration=new LegacyMigration(manager.scope(view.sessionId,view.root));let bytes,type;
   if(q.get('backup')==='1'){bytes=await migration.backup(q.get('id'));type='application/zip';}
   else{const result=await migration.item(q.get('id'),q.get('itemId'),q.get('sha256'));bytes=result.bytes;type=result.item.extension==='svg'?'image/svg+xml':'application/octet-stream';}
   res.writeHead(200,{'content-type':type,'content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-content-sha256':digest(bytes)});res.end(bytes);
  })}
 ];
}
