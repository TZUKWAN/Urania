/** Fixed native revision + actual exported bytes; visual review is a separate fact. */
import fs from 'node:fs';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {workspacePath,SafetyError,assertSafeJson} from './safety.js';import {nativeDeckDocument} from './native-deck-header.js';import {readZip} from './zip.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(message,status=422)=>{throw new SafetyError(message,status);};
const id=value=>{if(!/^export-[a-f0-9-]{36}$/.test(value||''))fail('导出身份无效');return value;};
const options={maxEntries:20000,maxEntryBytes:64*1024*1024,maxTotalBytes:256*1024*1024,maxSelectedBytes:128*1024*1024};
export function inspectPptx(bytes){
 const entries=readZip(bytes,options),byName=new Map(entries.map(e=>[e.name,e.data]));
 if(!byName.has('[Content_Types].xml')||!byName.has('ppt/presentation.xml')||!byName.has('ppt/_rels/presentation.xml.rels'))fail('实际导出文件不是完整 PPTX');
 const attrs=text=>Object.fromEntries([...text.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
 const relations=new Map([...byName.get('ppt/_rels/presentation.xml.rels').toString('utf8').matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map(m=>{const a=attrs(m[1]);return [a.Id,a];}));
 const order=[...byName.get('ppt/presentation.xml').toString('utf8').matchAll(/<p:sldId\b([^>]*)\/?\s*>/g)].map(m=>{const ref=attrs(m[1])['r:id'],r=relations.get(ref);if(!r||!r.Type?.endsWith('/slide')||!/^slides\/[^/]+\.xml$/.test(r.Target||''))fail('PPTX 页序关系无效');return 'ppt/'+r.Target;});
 if(!order.length||new Set(order).size!==order.length)fail('PPTX 页序为空或重复');
 const slides=order.map((file,index)=>{const data=byName.get(file);if(!data)fail('PPTX 缺少指定页面 '+file);const xml=data.toString('utf8');if(!xml.includes('<p:spTree'))fail('PPTX 缺少页面对象树');return {index,file,sha256:sha(data),editableTextRuns:[...xml.matchAll(/<a:t\b[^>]*>/g)].length,nativeShapeElements:[...xml.matchAll(/<p:sp\b/g)].length,pictureElements:[...xml.matchAll(/<p:pic\b/g)].length};});
 return {slides,slideCount:slides.length,editableTextRuns:slides.reduce((n,s)=>n+s.editableTextRuns,0),assets:entries.filter(e=>/^ppt\/(media|fonts)\//.test(e.name)).map(e=>({file:e.name,sha256:sha(e.data),bytes:e.data.length}))};
}
function immutable(file,bytes){const temp=file+'.tmp-'+randomUUID();let fd;try{fd=fs.openSync(temp,'wx');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;if(fs.existsSync(file)){if(sha(fs.readFileSync(file))!==sha(bytes))fail('同一导出身份已有不同文件',409);}else fs.renameSync(temp,file);}finally{if(fd!=null)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}}
export async function recordPptxExport(manager,view,{operationId,sourceId,revision,epoch,bytes,warnings=[]}){
 id(operationId);if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>128*1024*1024)fail('导出文件为空或超过128MiB预算',413);
 if(view.epoch!==epoch||view.sourceId!==sourceId||view.sourceRevision!==revision||manager.active.get(view.sessionId)!==view.id)fail('作品已切换，未把旧导出登记到新版本',409);
 const saved=await manager.store(view.root).read(sourceId,revision);if(saved.meta.engine!=='deckcraft')fail('PPTX 回执需要真实演示源');
 const document=nativeDeckDocument(saved.bytes),pptx=inspectPptx(bytes);if(pptx.slideCount!==document.slides.length)fail('导出 PPTX 页数与固定源版本不一致');
 const directory=workspacePath(view.root,join('design/.designcraft/exports',operationId));fs.mkdirSync(directory,{recursive:true});
 const file=workspacePath(view.root,join(directory,'receipt.json')),artifact=workspacePath(view.root,join(directory,'design.pptx'));
 if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.source.revision!==revision||old.source.id!==sourceId||old.artifact.sha256!==sha(bytes))fail('同一导出身份对应不同源或文件',409);return old;}
 const sourceEntries=readZip(saved.bytes,options);
 const receipt={schema:1,id:operationId,createdAt:new Date().toISOString(),source:{id:sourceId,revision,sha256:saved.meta.sourceHash,engine:saved.meta.engine,engineState:saved.meta.engineState,pageOrder:document.slides.map((slide,index)=>({id:String(slide.id),index})),assets:sourceEntries.filter(e=>e.name!=='presentation.json').map(e=>({file:e.name,sha256:sha(e.data),bytes:e.data.length}))},artifact:{format:'pptx',file:join('design/.designcraft/exports',operationId,'design.pptx').split('\\').join('/'),sha256:sha(bytes),bytes:bytes.length},inspection:pptx,warnings:Array.isArray(warnings)?warnings.filter(x=>typeof x==='string').slice(0,40).map(s=>s.slice(0,400)):[],renderReview:{performed:false,status:'not-performed'}};
 if(view.epoch!==epoch||view.sourceRevision!==revision||(await manager.store(view.root).head(sourceId))?.revision!==revision)fail('登记导出期间设计已改变，未登记错配版本',409);
 immutable(artifact,bytes);immutable(file,Buffer.from(JSON.stringify(receipt,null,2)));return receipt;
}
export function readPptxReceipt(root,operationId){
 const directory=workspacePath(root,join('design/.designcraft/exports',id(operationId))),file=workspacePath(root,join(directory,'receipt.json'),{mustExist:true});if(fs.statSync(file).size>2*1024*1024)fail('导出回执超过预算',413);const receipt=JSON.parse(fs.readFileSync(file,'utf8'));assertSafeJson(receipt);
 const artifact=workspacePath(root,join(directory,'design.pptx'),{mustExist:true});if(fs.statSync(artifact).size!==receipt.artifact.bytes||sha(fs.readFileSync(artifact))!==receipt.artifact.sha256)fail('导出文件摘要不一致，不能作为此回执的结果');return receipt;
}
