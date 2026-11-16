/** Deterministic, source-verified imports of pinned OpenDesign HTML packages. */
import {createHash} from 'node:crypto';
import {SafetyError} from './safety.js';
import {parseLfsPointer} from './external-github-source.js';
import {saveAsset,readAsset} from './docstore.js';
import {parseOpenDesignIndex,verifyOpenDesignBlob} from './open-design-library.js';

const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=hex=>hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20,32);
const portable=path=>typeof path==='string'&&path.length>0&&path.length<=300&&!path.startsWith('/')&&!/[\\:*?"<>|\x00-\x1f]/.test(path)&&path.split('/').length<=20&&!path.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
export function saveResourceHtmlIndex(library,root){
 const snapshot=library.indexSnapshot(),result={};for(const [key,bytes,ext] of [['index',snapshot.indexBytes,'json'],['lock',snapshot.lockBytes,'json'],['license',snapshot.licenseBytes,'txt']]){const digest=sha(bytes),saved=saveAsset(root,'od-html-'+key+'-'+digest.slice(0,24)+'.'+ext,bytes);result[key]={asset:saved.name,sha256:digest,bytes:bytes.length};}return result;
}
export function loadResourceHtmlIndex(root,snapshot){
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||Object.keys(snapshot).sort().join(',')!=='index,license,lock')throw new SafetyError('固定网页索引快照记录无效',409);
 const bytes={};for(const [key,ext,limit] of [['index','json',8*1024*1024],['lock','json',8192],['license','txt',1024*1024]]){const row=snapshot[key],pattern=new RegExp('^od-html-'+key+'-[a-f0-9]{24}(?:-[a-f0-9]{24})?\\.'+ext+'$');if(!row||Object.keys(row).some(name=>!['asset','sha256','bytes'].includes(name))||!pattern.test(row.asset||'')||!HASH.test(row.sha256||'')||!row.asset.startsWith('od-html-'+key+'-'+row.sha256.slice(0,24))||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>limit)throw new SafetyError('固定网页索引快照身份无效',409);const data=readAsset(root,row.asset);if(!data||data.length!==row.bytes||sha(data)!==row.sha256)throw new SafetyError('固定网页索引快照缺失或改变',409);bytes[key]=data;}
 const index=parseOpenDesignIndex(bytes.index,bytes.lock);if(index.licenseFile?.path!=='LICENSE')throw new SafetyError('固定网页根许可身份无效',409);verifyOpenDesignBlob(bytes.license,index.licenseFile);return {library:{index:()=>index,verify:verifyOpenDesignBlob},bytes};
}
export function resourceHtmlId(operationId){if(!HASH.test(operationId||''))throw new SafetyError('固定网页导入身份无效',422);return 'html-'+uuid(sha(Buffer.from('DesignCraft/opendesign-html/v2\0'+operationId)));}
export function selectResourceHtmlFiles(pack,entry){
 if(!pack||!Array.isArray(pack.files)||pack.files.length>2000||!portable(entry)||!/\.html?$/i.test(entry))throw new SafetyError('请选择固定资源包中实际存在的 HTML 文件',422);
 const selected=[],omitted=[],seen=new Set();for(const file of pack.files){
  if(!file||typeof file.path!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{40}$/.test(file.gitSha1||'')||!['100644','100755','120000'].includes(file.mode))throw new SafetyError('固定资源包索引无效',409);
  const key=file.path.toLowerCase();let reason;if(file.mode==='120000')reason='symlink';else if(!portable(file.path))reason='nonportable';else if(file.bytes>8*1024*1024)reason='file_budget';else if(seen.has(key))reason='duplicate_path';
  if(reason)omitted.push({path:file.path,reason});else{seen.add(key);selected.push(file);}
 }
 if(!selected.some(item=>item.path===entry))throw new SafetyError('HTML 入口不存在或未被安全选择',422);if(selected.length>256||selected.reduce((sum,file)=>sum+file.bytes,0)>24*1024*1024)throw new SafetyError('固定资源包超过网页作品预算，请选择较小的资源包',413);return {selected,omitted};
}
export function resourceHtmlOmissions(items,limit=50){const result=[];for(const item of items.slice(0,limit)){const row={path:item.path.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"<>]+/gi,'[链接已隐藏]').replace(/(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,}|r8_[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}/gi,'[已隐藏]').slice(0,120),reason:item.reason};if(Buffer.byteLength(JSON.stringify([...result,row]))>3000)break;result.push(row);}return result;}
export function resourceHtmlSelection(library,pack,entry,files){
 const index=library.index(),selection=selectResourceHtmlFiles(pack,entry);if(!Array.isArray(files)||files.length!==selection.selected.length)throw new SafetyError('固定网页初始文件数量不一致',409);
 const byPath=new Map();for(const file of files){if(!file||typeof file.path!=='string'||byPath.has(file.path)||typeof file.data!=='string')throw new SafetyError('固定网页初始文件无效',409);byPath.set(file.path,file);}
 const included=selection.selected.map(expected=>{const saved=byPath.get(expected.path);if(!saved)throw new SafetyError('固定网页缺少源文件',409);const bytes=Buffer.from(saved.data,'base64');library.verify(bytes,expected);if(parseLfsPointer(bytes))throw new SafetyError('固定网页包含 Git LFS 指针，未将其当作实际素材导入',422);const digest=sha(bytes);if(saved.sha256!==undefined&&saved.sha256!==digest||saved.bytes!==undefined&&saved.bytes!==bytes.length)throw new SafetyError('固定网页文件摘要不一致',409);return {path:expected.path,gitSha1:expected.gitSha1,sha256:digest,bytes:bytes.length};});
 const selectionSha256=sha(Buffer.from(JSON.stringify({repository:index.repository,revision:index.revision,packageId:pack.id,entry,included,omitted:selection.omitted})));return {...selection,included,selectionSha256};
}
export function verifyResourceHtml(library,document,root){
 const p=document?.provenance;if(!p||p.source!=='opendesign'||![2,3].includes(p.selectionVersion))throw new SafetyError('固定网页来源身份无效',409);const source=p.selectionVersion===3?loadResourceHtmlIndex(root,p.indexSnapshot).library:library,index=source.index(),pack=index.packages.get(p.packageId);if(p.selectionVersion===2&&p.indexSnapshot!==undefined||p.repository!==index.repository||p.revision!==index.revision||p.license!==index.license||typeof p.entry!=='string'||!HASH.test(p.selectionSha256||'')||document.entry!==p.entry||!pack)throw new SafetyError('固定网页来源身份无效',409);
 const selected=resourceHtmlSelection(source,pack,p.entry,document.files),omitted=resourceHtmlOmissions(selected.omitted);if(p.selectionSha256!==selected.selectionSha256||p.includedCount!==selected.included.length||p.omittedCount!==selected.omitted.length||JSON.stringify(p.omitted)!==JSON.stringify(omitted)||JSON.stringify(p.omittedFiles)!==JSON.stringify(omitted.map(item=>item.path)))throw new SafetyError('固定网页来源选择或遗漏不一致',409);return selected;
}
export async function resourceHtmlStatus({library,store,operationId,resourceId,entry}){
 const id=resourceHtmlId(operationId),lineage=await store.lineage(id);if(!lineage.length){selectResourceHtmlFiles(library.index().packages.get(resourceId),entry);return {id,found:false,note:'尚无已发布的固定网页版本；不会自动重复导入。'};}const first=lineage[0].value,selected=verifyResourceHtml(library,first,store.root);if(first.provenance.packageId!==resourceId||first.provenance.entry!==entry)throw new SafetyError('该操作身份已用于其他固定网页来源',409);if(lineage.some(item=>JSON.stringify(item.value.provenance)!==JSON.stringify(first.provenance)))throw new SafetyError('固定网页版本的原始来源已改变，未自动覆盖',409);
 return {id,found:true,revision:lineage.at(-1).revision,originalRevision:lineage[0].revision,title:lineage.at(-1).value.title,omittedFiles:resourceHtmlOmissions(selected.omitted).map(item=>item.path),omittedCount:selected.omitted.length,omitted:resourceHtmlOmissions(selected.omitted),warning:'已找到同一固定资源的网页；后续人工编辑予以保留。'};
}
