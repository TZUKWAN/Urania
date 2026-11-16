/** fal queue and catalogue adapter. No credentials, source images or signed URLs are persisted here. */
import {setTimeout as delay} from 'node:timers/promises';
import {SafetyError} from './safety.js';

const ENDPOINT=/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*){1,7}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const BASE='https://api.fal.ai/v1',QUEUE='https://queue.fal.run';

function endpoint(value){if(typeof value!=='string'||value.length>250||!ENDPOINT.test(value)||value.split('/').some(p=>p==='.'||p==='..'))throw new SafetyError('fal 模型端点无效',422);return value;}
function requestPath(model,id){endpoint(model);if(!UUID.test(id||''))throw new SafetyError('fal 任务身份无效',422);return '/'+model.split('/').slice(0,2).join('/')+'/requests/'+id.toLowerCase();}
function schema(spec,value,seen=new Set()){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 if(value.$ref!==undefined){const match=typeof value.$ref==='string'&&/^#\/components\/schemas\/([A-Za-z0-9_.-]+)$/.exec(value.$ref);if(!match||seen.has(match[1])||seen.size>12||!Object.hasOwn(spec.components?.schemas||{},match[1]))return null;const copy=new Set(seen);copy.add(match[1]);return schema(spec,spec.components.schemas[match[1]],copy);}
 if(value.allOf||value.oneOf||value.not)return null;
 return value;
}
function acceptsType(spec,value,type,depth=0){
 if(depth>12)return false;const v=schema(spec,value);if(!v)return false;
 if(v.type===type||Array.isArray(v.type)&&v.type.includes(type))return true;
 return Array.isArray(v.anyOf)&&v.anyOf.some(item=>acceptsType(spec,item,type,depth+1));
}
function imageOutput(spec,value){
 const output=schema(spec,value),properties=output?.properties;if(!properties||typeof properties!=='object')return null;
 for(const key of ['images','image']){
  const v=schema(spec,properties[key]);if(!v)continue;
  const object=key==='images'&&v.type==='array'?schema(spec,v.items):key==='image'?v:null;
  if(object&&acceptsType(spec,object.properties?.url,'string'))return {field:key,single:key==='image'||v.maxItems===1};
 }
 return null;
}
function modelFromSchema(model){
 const id=model?.endpoint_id,spec=model?.openapi;if(!ENDPOINT.test(id||'')||id.length>250||!spec||typeof spec!=='object'||spec.info?.['x-fal-metadata']?.endpointId&&spec.info['x-fal-metadata'].endpointId!==id)return null;
 const operation=spec.paths?.['/'+id],input=schema(spec,operation?.post?.requestBody?.content?.['application/json']?.schema),output=imageOutput(spec,spec.paths?.['/'+id+'/requests/{request_id}']?.get?.responses?.['200']?.content?.['application/json']?.schema);
 if(!input||!output||!input.properties||!acceptsType(spec,input.properties.prompt,'string'))return null;
 const required=Array.isArray(input.required)?input.required:[];if(required.some(key=>typeof key!=='string'))return null;
 const fields=['image_urls','image_url','reference_image_url'].filter(key=>{
  const prop=schema(spec,input.properties[key]);return key==='image_urls'?prop?.type==='array'&&acceptsType(spec,prop.items,'string'):acceptsType(spec,prop,'string');
 });
 const requiredImages=fields.filter(key=>required.includes(key));if(requiredImages.length>1)return null;
 const imageField=requiredImages[0]||fields[0]||null,hasNumber=acceptsType(spec,input.properties.num_images,'integer'),number=schema(spec,input.properties.num_images);
 const canSetOne=hasNumber&&number?.type==='integer'&&(!Number.isFinite(number.minimum)||number.minimum<=1)&&(!Number.isFinite(number.maximum)||number.maximum>=1)&&(!Number.isFinite(number.exclusiveMinimum)||number.exclusiveMinimum<1)&&(!Number.isFinite(number.exclusiveMaximum)||number.exclusiveMaximum>1)&&(!Array.isArray(number.enum)||number.enum.includes(1))&&(number.const===undefined||number.const===1)&&(!Number.isFinite(number.multipleOf)||1%number.multipleOf===0);
 if(required.some(key=>key!=='prompt'&&key!==imageField&&!(key==='num_images'&&canSetOne)))return null;
 const image=schema(spec,input.properties[imageField]),max=imageField==='image_urls'?Math.min(Number.isSafeInteger(image.maxItems)?image.maxItems:4,4):imageField?1:0;
 const minReference=imageField==='image_urls'?Math.max(Number.isSafeInteger(image.minItems)?image.minItems:1,1):imageField?1:0;
 const min=imageField&&required.includes(imageField)?minReference:0;
 if(min>max||minReference>max||max<0||!output.single&&!canSetOne)return null;
 const prompt=schema(spec,input.properties.prompt),promptMax=Number.isSafeInteger(prompt?.maxLength)?prompt.maxLength:null;
 return {id,name:typeof model.metadata?.display_name==='string'?model.metadata.display_name.slice(0,200):id,inputImage:!!imageField,requiresInputImage:min>0,minInputImages:min,minReferenceImages:minReference,maxInputImages:max,capabilitySource:'provider_declared',parameters:{},_fal:{imageField,output:output.field,canSetOne,promptMax,min,minReference,max}};
}

async function readBody(response,limit){
 if(Number(response.headers.get('content-length'))>limit||!response.body)throw new SafetyError('fal 响应为空或超过预算',502);
 const reader=response.body.getReader(),chunks=[];let size=0;
 while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>limit){await reader.cancel();throw new SafetyError('fal 响应超过预算',413);}chunks.push(Buffer.from(item.value));}
 return Buffer.concat(chunks,size);
}
async function call(url,{key,method='GET',body,signal,limit=4*1024*1024,timeout=30000,onDispatch,allowStatuses=[]}={}){
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeout);
 try{
  const text=body===undefined?undefined:JSON.stringify(body);signal?.throwIfAborted();
  if(onDispatch){try{await onDispatch();}catch{throw new SafetyError('fal 请求记录未能保存，未发送服务',500);}signal?.throwIfAborted();}
  const response=await fetch(url,{method,headers:{...(key?{Authorization:'Key '+key}:{}),...(text?{'Content-Type':'application/json'}:{}),...(method==='POST'?{'X-Fal-No-Retry':'1'}:{})},...(text?{body:text}:{}),signal:controller.signal,redirect:'error'}),bytes=await readBody(response,limit);
  let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{throw new SafetyError('fal 返回的 JSON 无效（HTTP '+response.status+'）',502);}
  if(!response.ok&&!allowStatuses.includes(response.status))throw new SafetyError('fal 请求失败（HTTP '+response.status+'）',response.status===429?429:502);
  if(!data||typeof data!=='object'||Array.isArray(data))throw new SafetyError('fal 响应结构无效',502);return {data,status:response.status};
 }catch(error){if(signal?.aborted)throw new SafetyError('本地已停止等待，fal 任务可能仍在处理或计费',499);if(controller.signal.aborted)throw new SafetyError('fal 请求超时，远端状态未确认；不会自动重发',504);if(error instanceof SafetyError)throw error;throw new SafetyError('fal 网络请求失败，远端状态可能未确认',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export async function falCatalogue(key){
 const categories=['text-to-image','image-to-image'],settled=await Promise.allSettled(categories.map(async category=>{
  const out=[];let cursor='',more=false;const seen=new Set();
  for(let page=0;page<3;page++){
   const q=new URLSearchParams({category,status:'active',limit:'20',expand:'openapi-3.0'});if(cursor)q.set('cursor',cursor);
   const {data}=await call(BASE+'/models?'+q,{key,limit:20*1024*1024});if(!Array.isArray(data.models)||typeof data.has_more!=='boolean'||data.models.length>100)throw new SafetyError('fal 模型目录格式无效',502);
   out.push(...data.models);more=data.has_more;if(!more)break;
   if(typeof data.next_cursor!=='string'||!data.next_cursor||data.next_cursor.length>2000||seen.has(data.next_cursor))throw new SafetyError('fal 模型目录分页无效',502);
   seen.add(data.next_cursor);cursor=data.next_cursor;
  }
  return {out,more};
 }));
 const byId=new Map(),warnings=[];let valid=0,skipped=0;
 for(let i=0;i<settled.length;i++){
  const result=settled[i];if(result.status!=='fulfilled'){warnings.push('fal '+categories[i]+' 目录读取失败');continue;}valid++;
  if(result.value.more)warnings.push('fal '+categories[i]+' 目录仅显示读取预算内的模型');
  for(const raw of result.value.out){if(raw?.metadata?.status!=='active'||raw?.metadata?.category!==categories[i]){skipped++;continue;}const row=modelFromSchema(raw);if(!row){skipped++;continue;}byId.set(row.id,row);}
 }
 if(!valid)throw new SafetyError('fal 图片模型目录不可用',503);if(skipped)warnings.push('有 '+skipped+' 个模型的输入输出不符合当前图片流程，未列出');
 return {models:[...byId.values()],warnings};
}

function resultUrl(data,field){return field==='images'?data.images?.[0]?.url:field==='image'?data.image?.url:null;}
async function download(url,signal){
 if(typeof url!=='string')throw new SafetyError('fal 未返回可读取的图片地址',502);
 const inline=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);let bytes,mime;
 if(inline){if(inline[2].length>90*1024*1024)throw new SafetyError('fal 图片超过预算',413);bytes=Buffer.from(inline[2],'base64');mime=inline[1];}
 else{
  if(url.length>12000)throw new SafetyError('fal 图片地址超过预算',413);let parsed;try{parsed=new URL(url);}catch{throw new SafetyError('fal 图片地址无效',502);}
  const host=parsed.hostname.toLowerCase(),safeHost=host==='fal.media'||host.endsWith('.fal.media')||host==='storage.googleapis.com'&&parsed.pathname.startsWith('/falserverless/');
  if(parsed.protocol!=='https:'||!safeHost||parsed.port||parsed.username||parsed.password||parsed.hash)throw new SafetyError('fal 图片地址不在允许的媒体来源',502);
  const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
  try{const response=await fetch(parsed.href,{signal:controller.signal,redirect:'error'});if(!response.ok)throw new SafetyError('fal 图片下载失败（HTTP '+response.status+'）',502);bytes=await readBody(response,64*1024*1024);mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase().trim();}
  catch(error){if(signal?.aborted)throw new SafetyError('已停止下载 fal 图片，远端结果仍可能存在',499);if(error instanceof SafetyError)throw error;throw new SafetyError('fal 图片下载失败',502);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216,webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(!bytes.length||bytes.length>64*1024*1024||!(mime==='image/png'&&png||mime==='image/jpeg'&&jpeg||mime==='image/webp'&&webp))throw new SafetyError('fal 图片类型与实际内容不一致',502);return {bytes,mime};
}

export async function falRetrieve(key,{model,requestId,output},signal,onStatus){
 const path=requestPath(model,requestId);if(!['images','image'].includes(output))throw new SafetyError('fal 结果字段记录无效',422);
 const deadline=Date.now()+10*60*1000;let previous='';
 while(Date.now()<deadline){
  signal?.throwIfAborted();const {data}=await call(QUEUE+path+'/status',{key,signal});
  if(typeof data.request_id!=='string'||data.request_id.toLowerCase()!==requestId||!['IN_QUEUE','IN_PROGRESS','COMPLETED'].includes(data.status))throw new SafetyError('fal 返回的任务身份或状态不一致',502);
  if(data.status!==previous){await onStatus?.(data.status);previous=data.status;}
  if(data.status==='COMPLETED'){
   if(data.error)throw new SafetyError('fal 报告任务失败，请查看服务端任务记录',502);
   const result=await call(QUEUE+path,{key,signal});const image=await download(resultUrl(result.data,output),signal);
   const warnings=Array.isArray(result.data.has_nsfw_concepts)&&result.data.has_nsfw_concepts.some(Boolean)?['fal 标记部分结果触及内容处理规则。']:[];
   return {...image,requestId,usage:{},warnings};
  }
  try{await delay(2500,undefined,{signal});}catch{throw new SafetyError('本地已停止等待，fal 任务可能仍在处理或计费',499);}
 }
 throw new SafetyError('等待 fal 结果超时；远端任务可能仍在处理，可使用原任务 ID 取回',504);
}

export async function falGenerate(key,{model,prompt,references=[],spec,onDispatch,onAccepted,onStatus},signal){
 endpoint(model);if(!spec||typeof prompt!=='string'||!prompt||spec.promptMax!==null&&prompt.length>spec.promptMax)throw new SafetyError('fal 提示词或模型描述无效',422);
 if(references.length<spec.min||references.length>spec.max||references.length>0&&references.length<spec.minReference)throw new SafetyError('fal 参考图数量不符合模型接口',422);
 if(references.some(url=>!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(url)))throw new SafetyError('fal 参考图格式无效',422);
 const body={prompt};if(spec.canSetOne)body.num_images=1;
 if(references.length){if(!spec.imageField)throw new SafetyError('fal 模型不接受参考图',422);body[spec.imageField]=spec.imageField==='image_urls'?references:references[0];}
 const {data}=await call(QUEUE+'/'+model,{key,method:'POST',body,signal,limit:1024*1024,timeout:60000,onDispatch});
 if(!UUID.test(data.request_id||''))throw new SafetyError('fal 已响应但未返回有效任务 ID；请核对服务端记录，不要自动重发',502);
 const requestId=data.request_id.toLowerCase();await onAccepted?.({requestId,model,output:spec.output});
 return falRetrieve(key,{model,requestId,output:spec.output},signal,onStatus);
}

export async function falCancel(key,{model,requestId},signal){
 const {data,status}=await call(QUEUE+requestPath(model,requestId)+'/cancel',{key,method:'PUT',signal,limit:1024*1024,allowStatuses:[400,404]});
 if(status===200&&data.status==='OK')return {state:'removed_from_queue',detail:'fal 已从队列移除任务。'};
 if(status===202&&data.status==='CANCELLATION_REQUESTED')return {state:'cancellation_requested',detail:'fal 已接收取消请求；运行中的任务仍可能完成或计费。'};
 if(status===400&&data.status==='ALREADY_COMPLETED')return {state:'already_completed',detail:'fal 表示任务已完成，可尝试取回。'};
 if(status===404&&data.status==='NOT_FOUND')return {state:'not_found',detail:'fal 未找到此任务，或当前凭据不属于原账户。'};
 throw new SafetyError('fal 未确认远端取消状态，请核对任务记录',502);
}

// General workflow primitives share the same fixed hosts and queue identity checks.
export async function falSearch(key,{query='',category='',cursor=''}={},signal){
 if(typeof query!=='string'||query.length>160||typeof category!=='string'||category.length>100||typeof cursor!=='string'||cursor.length>2000)throw new SafetyError('fal 模型搜索参数无效',422);
 const params=new URLSearchParams({status:'active',limit:'20'});if(query)params.set('q',query);if(category)params.set('category',category);if(cursor)params.set('cursor',cursor);
 const {data}=await call(BASE+'/models?'+params,{key,signal,limit:4*1024*1024});
 if(!Array.isArray(data.models)||typeof data.has_more!=='boolean'||data.models.length>100||data.has_more&&(typeof data.next_cursor!=='string'||data.next_cursor.length>2000))throw new SafetyError('fal 模型搜索响应无效',502);
 return {models:data.models.filter(item=>ENDPOINT.test(item?.endpoint_id||'')&&item.metadata?.status==='active').map(item=>({id:item.endpoint_id,name:String(item.metadata?.display_name||item.endpoint_id).slice(0,200),category:String(item.metadata?.category||'').slice(0,100),status:'active'})),hasMore:data.has_more,nextCursor:data.has_more?data.next_cursor:null};
}
export async function falWorkflowSpec(key,model,signal){
 endpoint(model);const params=new URLSearchParams({endpoint_id:model,expand:'openapi-3.0',status:'active'});
 const {data}=await call(BASE+'/models?'+params,{key,signal,limit:8*1024*1024});
 if(!Array.isArray(data.models))throw new SafetyError('fal 模型描述响应无效',502);
 const matches=data.models.filter(item=>item.endpoint_id===model&&item.metadata?.status==='active');if(matches.length!==1)throw new SafetyError('fal 未返回唯一可用的模型端点',404);
 const spec=matches[0].openapi,metadata=spec?.info?.['x-fal-metadata'];
 if(!spec||typeof spec!=='object'||Array.isArray(spec)||metadata?.endpointId&&metadata.endpointId!==model||!spec.paths?.['/'+model]?.post?.requestBody?.content?.['application/json']?.schema)throw new SafetyError('fal 模型缺少可检查的输入接口描述',422);
 return {model,spec,name:String(matches[0].metadata?.display_name||model).slice(0,200),category:String(matches[0].metadata?.category||'').slice(0,100)};
}
export async function falSubmitWorkflow(key,{model,input,onDispatch,onAccepted},signal){
 endpoint(model);if(typeof onDispatch!=='function'||typeof onAccepted!=='function')throw new SafetyError('fal 工作流缺少持久化回执',500);
 const {data}=await call(QUEUE+'/'+model,{key,method:'POST',body:input,signal,limit:1024*1024,timeout:60000,onDispatch});
 if(!UUID.test(data.request_id||''))throw new SafetyError('fal 已响应但未返回有效任务 ID，请核对远端后再操作',502);
 const requestId=data.request_id.toLowerCase();await onAccepted({model,requestId});return requestId;
}
export async function falWorkflowStatus(key,{model,requestId},signal){
 const {data}=await call(QUEUE+requestPath(model,requestId)+'/status',{key,signal});
 if(typeof data.request_id!=='string'||data.request_id.toLowerCase()!==requestId||!['IN_QUEUE','IN_PROGRESS','COMPLETED'].includes(data.status))throw new SafetyError('fal 工作流状态或身份不一致',502);
 return {status:data.status,failed:!!data.error,queuePosition:Number.isSafeInteger(data.queue_position)&&data.queue_position>=0?data.queue_position:null};
}
export async function falWorkflowResult(key,details,signal){const {data}=await call(QUEUE+requestPath(details.model,details.requestId),{key,signal,limit:8*1024*1024});return data;}
