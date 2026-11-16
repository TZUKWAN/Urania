/** Public Commons image acquisition; metadata is a source declaration, not a rights guarantee. */
import {createHash} from 'node:crypto';
import {readFile,readdir,mkdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {saveAsset,readAsset,validateRoot} from './docstore.js';
import {SafetyError,assertSafeJson,assertPortableName,workspacePath} from './safety.js';
import {previewImageSize} from './image-header.js';
import {atomicCreate} from './persistence.js';

const API='https://commons.wikimedia.org/w/api.php';
const PROVIDER='wikimedia-commons';
const HASH=/^[a-f0-9]{64}$/,SEARCH=/^stocksearch-[a-f0-9]{64}$/,IMAGE=/^stockimage-[a-f0-9]{64}$/;
const MAX_RESPONSE=2*1024*1024,MAX_IMAGE=16*1024*1024;
const KEYS=['Artist','Credit','Attribution','AttributionRequired','LicenseShortName','LicenseUrl','UsageTerms','Copyrighted','NonFree','Restrictions','ImageDescription'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const identity=value=>sha(encode(value));
const directory=root=>workspacePath(root,'design/.designcraft/stock-images');
const validDate=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const jsonText=bytes=>{try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));assertSafeJson(value);return value;}catch{throw new SafetyError('图库记录或响应不是有效 JSON',409);}};
function filePath(root,id){if(!SEARCH.test(id||'')&&!IMAGE.test(id||''))throw new SafetyError('图库记录身份无效',422);return workspacePath(root,join(directory(root),id+'.json'));}
function checkedUrl(value,kind){
 if(typeof value!=='string'||value.length>4096||/[\x00-\x20\x7f]/.test(value))throw new SafetyError('图库来源地址无效',422);
 let url;try{url=new URL(value);}catch{throw new SafetyError('图库来源地址无效',422);}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw new SafetyError('图库来源地址不受支持',422);
 if(kind==='image'){
  const original=url.hostname==='upload.wikimedia.org'&&url.pathname.startsWith('/wikipedia/commons/'),thumbnail=url.hostname==='thumb.wikimedia.org'&&url.pathname.startsWith('/wikipedia/commons/thumb/');
  if(!original&&!thumbnail)throw new SafetyError('图片必须来自 Commons 官方图片域名',422);
  // MediaWiki imageinfo appends these provenance tags to official file URLs.
  // Strip only the known tags; retain the complete API response as provenance.
  const allowed={utm_source:['commons.wikimedia.org'],utm_campaign:['imageinfo'],utm_content:['original','thumbnail','thumbnail_unscaled']},seen=new Set();
  for(const [key,value]of url.searchParams){if(!Object.hasOwn(allowed,key)||!allowed[key].includes(value)||seen.has(key))throw new SafetyError('图库图片含未知地址参数',422);seen.add(key);}
  url.search='';
 }
 if(kind==='page'&&(url.hostname!=='commons.wikimedia.org'||!url.pathname.startsWith('/wiki/')&&!url.pathname.startsWith('/w/index.php')))throw new SafetyError('图片说明页不在 Commons 官方站点',422);
 if(kind==='api'&&(url.origin!=='https://commons.wikimedia.org'||url.pathname!=='/w/api.php'))throw new SafetyError('图库接口地址无效',422);
 return url.href;
}
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:#(?:x([0-9a-f]{1,6})|([0-9]{1,7}))|(amp|lt|gt|quot|apos|nbsp));/gi,(all,hex,dec,name)=>{if(name)return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[name.toLowerCase()];const n=parseInt(hex||dec,hex?16:10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' ';}).replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
function requestInput(query,offset=0){
 if(typeof query!=='string'||!query.trim()||query.trim().length>200||/[\x00-\x1f\x7f]/.test(query)||/(?:Bearer\s+|sk-[A-Za-z0-9_-]{20,})/i.test(query)||!Number.isSafeInteger(offset)||offset<0||offset>1000)throw new SafetyError('请输入最多 200 字的图片搜索词，分页范围 0–1000',422);
 return {query:query.trim(),offset,limit:8,maxEdge:1600};
}
function normalizeCandidate(page){
 const info=Array.isArray(page?.imageinfo)&&page.imageinfo.length===1?page.imageinfo[0]:null;
 if(page?.ns!==6||!Number.isSafeInteger(page.pageid)||page.pageid<=0||typeof page.title!=='string'||!page.title.startsWith('File:')||page.title.length>500||!object(info)||!['image/png','image/jpeg'].includes(info.mime)||info.filehidden!==undefined)return null;
 const metadata={};for(const key of KEYS){const field=info.extmetadata?.[key];if(field!==undefined){if(!object(field)||typeof field.value!=='string'||field.value.length>16000)throw new SafetyError('图片许可或说明元数据超过预算',413);metadata[key]=field.value;}}
 const url=checkedUrl(info.url,'image'),downloadUrl=checkedUrl(info.thumburl||info.url,'image'),thumb=downloadUrl!==url;
 const width=thumb?info.thumbwidth:info.width,height=thumb?info.thumbheight:info.height,mime=thumb?(info.thumbmime||info.mime):info.mime;
 if(!['image/png','image/jpeg'].includes(mime)||![info.width,info.height,info.size,width,height].every(n=>Number.isSafeInteger(n)&&n>0)||width>4096||height>4096||width*height>24*1024*1024||!thumb&&info.size>MAX_IMAGE)return null;
 if(!validDate(info.timestamp)||typeof info.sha1!=='string'||!/^(?:[a-f0-9]{40}|[a-z0-9]{31})$/i.test(info.sha1))throw new SafetyError('图片缺少可核对的服务版本身份',502);
 const candidate={id:'commons-'+page.pageid,pageId:page.pageid,title:page.title,sourceUrl:checkedUrl(info.descriptionurl,'page'),originalUrl:url,downloadUrl,downloadKind:thumb?'scaled':'original',sourceSha1:info.sha1,sourceTimestamp:info.timestamp,originalWidth:info.width,originalHeight:info.height,originalBytes:info.size,originalMime:info.mime,width,height,mime,metadata,
  author:plain(metadata.Artist),credit:plain(metadata.Credit),attribution:plain(metadata.Attribution),license:plain(metadata.LicenseShortName),usageTerms:plain(metadata.UsageTerms),restrictions:plain(metadata.Restrictions),description:plain(metadata.ImageDescription),attributionRequired:plain(metadata.AttributionRequired)||'unknown',licenseUrl:null};
 const licenseUrl=plain(metadata.LicenseUrl);if(licenseUrl){try{const parsed=new URL(licenseUrl);if(['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&licenseUrl.length<=2048&&!/[\x00-\x20\x7f]/.test(licenseUrl))candidate.licenseUrl=parsed.href;}catch{}}
 return candidate;
}
function parseResponse(bytes,input){
 const value=jsonText(bytes);if(!object(value))throw new SafetyError('图库响应结构无效',502);if(value.error)throw new SafetyError('图库服务拒绝查询或暂时不可用，请稍后手动重试',502);
 if(value.warnings)throw new SafetyError('图库服务没有完整接受查询参数，未采用不确定结果',502);
 if(!object(value)||value.batchcomplete!==true&&value.batchcomplete!==''||value.continue&&(!object(value.continue)||Object.keys(value.continue).some(key=>!['continue','gsroffset'].includes(key))))throw new SafetyError('图库缺少完整查询结果，未采用尚需补充属性的数据',502);const pages=value.query?.pages||[];if(!Array.isArray(pages)||pages.length>input.limit)throw new SafetyError('图库搜索响应结构或数量无效',502);
 const items=[],skipped=[];for(const page of pages.slice().sort((a,b)=>(a.index||0)-(b.index||0))){try{const row=normalizeCandidate(page);if(row&&!items.some(item=>item.id===row.id))items.push(row);else skipped.push({pageId:page?.pageid||null,reason:'unsupported_or_over_budget'});}catch{skipped.push({pageId:Number.isSafeInteger(page?.pageid)?page.pageid:null,reason:'unconfirmed_source_metadata'});}}
 const next=value.continue?.gsroffset;const nextOffset=Number.isSafeInteger(next)&&next>input.offset&&next<=1000?next:null;
 return {items,skipped,nextOffset};
}
export async function retainStockRecord(root,row){const encoded=encode(row);if(encoded.length>(SEARCH.test(row.id||'')?3*1024*1024:16384))throw new SafetyError('图库记录超过保存预算',413);await mkdir(directory(root),{recursive:true});if(!atomicCreate(filePath(root,row.id),encoded)){const prior=await readPublished(root,row.id,SEARCH.test(row.id)?3*1024*1024:16384);if(JSON.stringify(prior)!==JSON.stringify(row))throw new SafetyError('图库来源记录冲突，原内容保留',409);}}
export function validateStockSearch(row){
 assertSafeJson(row);if(!object(row)||row.schema!==1||row.kind!=='stock-search'||row.provider!==PROVIDER||!SEARCH.test(row.id||'')||!validDate(row.at)||!HASH.test(row.responseSha256||'')||!Number.isSafeInteger(row.responseBytes)||row.responseBytes<1||row.responseBytes>MAX_RESPONSE||typeof row.responseAsset!=='string'||!object(row.request)||Object.keys(row).some(key=>!['schema','kind','id','provider','at','request','responseAsset','responseSha256','responseBytes','items','skipped','nextOffset'].includes(key)))throw new SafetyError('图库搜索记录无效',409);
 const {id,...body}=row;const expected=requestInput(row.request.query,row.request.offset);if(JSON.stringify(expected)!==JSON.stringify(row.request)||id!=='stocksearch-'+identity(body))throw new SafetyError('图库搜索记录身份不一致',409);assertPortableName(row.responseAsset);return true;
}
export async function readStockSearch(root,id){
 root=validateRoot(root);if(!SEARCH.test(id||''))throw new SafetyError('图库搜索身份无效',422);const row=await readPublished(root,id,3*1024*1024);validateStockSearch(row);const bytes=readAsset(root,row.responseAsset);if(!bytes||bytes.length!==row.responseBytes||sha(bytes)!==row.responseSha256)throw new SafetyError('图库搜索原始响应缺失或改变',409);
 const normalized=parseResponse(bytes,row.request);if(JSON.stringify(normalized.items)!==JSON.stringify(row.items)||JSON.stringify(normalized.skipped)!==JSON.stringify(row.skipped)||normalized.nextOffset!==row.nextOffset)throw new SafetyError('图库搜索来源与原始响应不一致',409);return {row,bytes};
}
function verifyOriginal(bytes,candidate){if(candidate.downloadKind!=='original')return;const hex=createHash('sha1').update(bytes).digest('hex'),base36=BigInt('0x'+hex).toString(36).padStart(31,'0');if(bytes.length!==candidate.originalBytes||![hex,base36].includes(candidate.sourceSha1.toLowerCase()))throw new SafetyError('图库原尺寸图片与服务版本摘要不一致，请重新搜索',409);}
function imageMime(bytes){if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216)return 'image/jpeg';throw new SafetyError('图库图片实际格式不受支持',415);}
async function readPublished(root,id,max){const path=filePath(root,id),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>max)throw new SafetyError('图库记录文件无效或过大',409);const row=jsonText(await readFile(path));if(row.id!==id)throw new SafetyError('图库记录身份不一致',409);return row;}
export function validateStockImage(row){
 assertSafeJson(row);if(!object(row)||row.schema!==1||row.kind!=='stock-image'||row.provider!==PROVIDER||!IMAGE.test(row.id||'')||!SEARCH.test(row.searchId||'')||typeof row.candidateId!=='string'||!/^commons-[1-9][0-9]{0,15}$/.test(row.candidateId)||!HASH.test(row.sha256||'')||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>MAX_IMAGE||!['png','jpg'].includes(row.format)||!Number.isSafeInteger(row.width)||!Number.isSafeInteger(row.height)||row.width<1||row.height<1||row.width>4096||row.height>4096||row.width*row.height>24*1024*1024||typeof row.assetName!=='string'||!row.assetName.endsWith('.'+row.format)||Object.keys(row).some(key=>!['schema','kind','id','provider','searchId','candidateId','assetName','sha256','bytes','format','width','height'].includes(key)))throw new SafetyError('图库图片记录无效',409);
 assertPortableName(row.assetName);const {id,...body}=row;if(id!=='stockimage-'+identity(body))throw new SafetyError('图库图片来源身份不一致',409);return true;
}
export async function readStockImage(root,id){
 root=validateRoot(root);if(!IMAGE.test(id||''))throw new SafetyError('图库图片身份无效',422);const row=await readPublished(root,id,16384);validateStockImage(row);const {row:search}=await readStockSearch(root,row.searchId),candidate=search.items.find(item=>item.id===row.candidateId);if(!candidate)throw new SafetyError('图库图片缺少实际搜索来源',409);
 const bytes=readAsset(root,row.assetName);if(!bytes||bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw new SafetyError('图库图片原件缺失或改变',409);const size=previewImageSize(bytes),mime=row.format==='png'?'image/png':'image/jpeg';
 if(imageMime(bytes)!==mime||size.width!==row.width||size.height!==row.height||size.width!==candidate.width||size.height!==candidate.height||mime!==candidate.mime)throw new SafetyError('图库图片尺寸或格式与来源不一致',409);
 verifyOriginal(bytes,candidate);return {row,bytes,search,candidate};
}
export async function listStockImages(root){
 root=validateRoot(root);let entries;try{entries=await readdir(directory(root),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return {images:[],searches:[],errors:[]};throw error;}
 if(entries.length>2500)throw new SafetyError('图库记录超过预算',413);const images=[],searches=[],errors=[];
 for(const item of entries){if(!/^stock(?:image|search|open|link)-[a-f0-9]{64}\.json$/.test(item.name)){errors.push({id:item.name,error:'图库目录含无法识别或未完成记录'});continue;}if(!/^(?:stockimage|stocksearch)-/.test(item.name))continue;try{const id=item.name.slice(0,-5),row=await readPublished(root,id,id.startsWith('stocksearch-')?3*1024*1024:16384);if(id.startsWith('stockimage-')){validateStockImage(row);images.push(row);}else{validateStockSearch(row);searches.push({id:row.id,at:row.at,query:row.request.query});}}catch(error){errors.push({id:item.name.slice(0,-5),error:error instanceof SafetyError?error.message:'图库记录无法读取'});}}
 return {images,searches:searches.sort((a,b)=>b.at.localeCompare(a.at)),errors,note:'列表仅核对记录结构；预览和打开前核对实际字节与来源。'};
}
export async function stockCredits(root,id){const {row,candidate}=await readStockImage(root,id);return {imageId:row.id,assetName:row.assetName,sha256:row.sha256,provider:PROVIDER,title:candidate.title,sourceUrl:candidate.sourceUrl,sourceSha1:candidate.sourceSha1,sourceTimestamp:candidate.sourceTimestamp,width:row.width,height:row.height,metadata:candidate.metadata,author:candidate.author,credit:candidate.credit,attribution:candidate.attribution,license:candidate.license,licenseUrl:candidate.licenseUrl,usageTerms:candidate.usageTerms,restrictions:candidate.restrictions,attributionRequired:candidate.attributionRequired,downloadKind:candidate.downloadKind,note:'以上是来源站点提供的许可和署名元数据；分享时保留并核对原始说明页，多许可和其他权利可能需要进一步确认。'};}
async function readLimited(response,maximum){
 const length=response.headers.get('content-length');if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>maximum)){await response.body?.cancel();throw new SafetyError('图库下载超过大小预算',413);}
 const chunks=[];let count=0;for await(const chunk of response.body||[]){count+=chunk.length;if(count>maximum){throw new SafetyError('图库下载超过大小预算',413);}chunks.push(chunk);}if(!count)throw new SafetyError('图库返回了空响应',502);return Buffer.concat(chunks);
}
export class StockImages{
 constructor({version='1.3',contact=''}={}){this.version=String(version).replace(/[^0-9A-Za-z.+-]/g,'').slice(0,40)||'1.3';this.contact=typeof contact==='string'&&/^(?:https:\/\/|mailto:)[^\s\x00-\x1f]{1,180}$/.test(contact)?contact:'';this.active=0;this.closed=false;this.lastRequests=new Map();this.controllers=new Set();this.captures=new Set();}
 dispose(){this.closed=true;for(const controller of this.controllers)controller.abort();this.controllers.clear();}
 async request(url,kind,signal){
  const target=checkedUrl(url,kind);if(this.closed)throw new SafetyError('图库服务已停止',503);if(this.active>=2)throw new SafetyError('已有图库请求进行中，请稍后再试',429);if(Date.now()-(this.lastRequests.get(kind)||0)<500)throw new SafetyError('图库请求过于频繁，请稍后手动重试',429);
  this.lastRequests.set(kind,Date.now());this.active++;const controller=new AbortController(),abort=()=>controller.abort();this.controllers.add(controller);const timer=setTimeout(abort,20000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{const response=await fetch(target,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:kind==='api'?'application/json':'image/png,image/jpeg','User-Agent':'DesignCraft/'+this.version+' (DSH desktop image search'+(this.contact?'; '+this.contact:'')+')'},signal:controller.signal});if(!response.ok){await response.body?.cancel();throw new SafetyError('图库请求失败（HTTP '+response.status+'）；未自动重试',response.status===429?429:502);}const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();if(kind==='api'?type!=='application/json':!['image/png','image/jpeg'].includes(type)){await response.body?.cancel();throw new SafetyError('图库返回的内容类型不受支持',415);}return {bytes:await readLimited(response,kind==='api'?MAX_RESPONSE:MAX_IMAGE),type};}
  catch(error){if(signal?.aborted)throw new SafetyError('图库请求已停止；已有项目原件保留',499);if(controller.signal.aborted)throw new SafetyError('图库请求超时；未自动重试',504);if(error instanceof SafetyError)throw error;throw new SafetyError('图库网络请求失败；未自动重试',502);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.controllers.delete(controller);this.active--;}
 }
 async search(root,query,offset,signal,current){
  root=validateRoot(root);const input=requestInput(query,offset??0);signal?.throwIfAborted();current?.();const url=new URL(API);url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrnamespace:'6',gsrsearch:input.query,gsrlimit:String(input.limit),gsroffset:String(input.offset),gsrsort:'relevance',prop:'imageinfo',iiprop:'url|size|mime|thumbmime|extmetadata|sha1|timestamp',iilimit:'1',iiurlwidth:String(input.maxEdge),iiurlheight:String(input.maxEdge),iiextmetadatafilter:KEYS.join('|'),iiextmetadatalanguage:'en',maxlag:'5'}).toString();
  const {bytes}=await this.request(url.href,'api',signal),parsed=parseResponse(bytes,input);signal?.throwIfAborted();current?.();const digest=sha(bytes),asset=saveAsset(root,'stock-api-'+digest.slice(0,24)+'.json',bytes),body={schema:1,kind:'stock-search',provider:PROVIDER,at:new Date().toISOString(),request:input,responseAsset:asset.name,responseSha256:digest,responseBytes:bytes.length,...parsed},row={...body,id:'stocksearch-'+identity(body)};validateStockSearch(row);signal?.throwIfAborted();current?.();await retainStockRecord(root,row);
  return {search:row,note:'实际结果仅展示受支持 PNG/JPEG。部分记录可能因格式、尺寸或来源信息不足被跳过；许可来自站点元数据，不是独立权利审查。'};
 }
 async acquire(root,searchId,candidateId,signal,current){
  root=validateRoot(root);const {row:search}=await readStockSearch(root,searchId),candidate=search.items.find(item=>item.id===candidateId);if(!candidate)throw new SafetyError('请选择真实搜索结果中的图片',422);signal?.throwIfAborted();current?.();
  const url=new URL(API);url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',pageids:String(candidate.pageId),prop:'imageinfo',iiprop:'url|size|mime|thumbmime|extmetadata|sha1|timestamp',iilimit:'1',iiurlwidth:'1600',iiurlheight:'1600',iiextmetadatafilter:KEYS.join('|'),iiextmetadatalanguage:'en',maxlag:'5'}).toString();
  const fresh=await this.request(url.href,'api',signal),data=parseResponse(fresh.bytes,search.request);
  if(data.items.length!==1||JSON.stringify(data.items[0])!==JSON.stringify(candidate))throw new SafetyError('图片版本或许可说明在搜索后改变，请重新搜索核对',409);
  signal?.throwIfAborted();current?.();const {bytes,type}=await this.request(candidate.downloadUrl,'image',signal),size=previewImageSize(bytes);
  if(imageMime(bytes)!==type||type!==candidate.mime||size.width!==candidate.width||size.height!==candidate.height)throw new SafetyError('图片格式或尺寸与搜索结果不一致，请重新搜索核对',409);verifyOriginal(bytes,candidate);return {bytes,candidate,search,size};
 }
 async capture(root,searchId,candidateId,signal,current){
  root=validateRoot(root);const key=root+'\0'+searchId+'\0'+candidateId;if(this.captures.has(key))throw new SafetyError('此图片正在保存，请先查看已保存结果',423);this.captures.add(key);
  try{return await this.captureOnce(root,searchId,candidateId,signal,current);}finally{this.captures.delete(key);}
 }
 async captureOnce(root,searchId,candidateId,signal,current){
  root=validateRoot(root);const listing=await listStockImages(root);if(listing.errors.length)throw new SafetyError('存在损坏或未完成的图库记录，请先核对',409);const existing=listing.images.filter(item=>item.searchId===searchId&&item.candidateId===candidateId);if(existing.length>1)throw new SafetyError('同一图库结果有多个保存版本，请先核对',409);if(existing.length===1){const saved=await readStockImage(root,existing[0].id);signal?.throwIfAborted();current?.();return {record:saved.row,reused:true,credits:await stockCredits(root,saved.row.id)};}
  const {bytes,candidate,size}=await this.acquire(root,searchId,candidateId,signal,current);signal?.throwIfAborted();current?.();const digest=sha(bytes),format=candidate.mime==='image/png'?'png':'jpg',asset=saveAsset(root,'stock-'+digest.slice(0,24)+'.'+format,bytes),body={schema:1,kind:'stock-image',provider:PROVIDER,searchId,candidateId,assetName:asset.name,sha256:digest,bytes:bytes.length,format,width:size.width,height:size.height},row={...body,id:'stockimage-'+identity(body)};validateStockImage(row);
  try{signal?.throwIfAborted();current?.();await retainStockRecord(root,row);}catch(error){error.retained={imageId:row.id,assetName:asset.name,materialized:true,sourceRecorded:false};throw error;}
  return {record:row,credits:await stockCredits(root,row.id),note:'已保存实际图片与来源。'+(candidate.downloadKind==='scaled'?'这是服务返回的缩放图，非全尺寸原件。':'')};
 }
}
