import {SafetyError} from './safety.js';
import {falCatalogue,falGenerate,falRetrieve,falCancel} from './fal-image-provider.js';
import {Blob} from 'node:buffer';
import {createHash} from 'node:crypto';
import {validateStaticExternalSvg} from './static-external-svg.js';
import {previewImageSize} from './image-header.js';
import {VENICE_IMAGE_MODES} from './venice-image-transform.js';
const routeIdentity=route=>JSON.stringify([route.protocol,route.baseURL,route.ref,...(route.configurationRevision?[route.configurationRevision,route.configuredModel||'']:[])]);
export const imageConnectionFingerprint=route=>createHash('sha256').update(routeIdentity(route)).digest('hex');
const safeRequestId=(value,key)=>typeof value==='string'?value.replaceAll(key,'[redacted]').replace(/[\x00-\x1f\x7f]/g,'').slice(0,200)||null:null;
const veniceOptions=(value,pattern)=>Array.isArray(value)&&value.length<=32&&value.every(item=>typeof item==='string'&&pattern.test(item))?[...new Set(value)]:[];
const intersectOptions=(prior,next)=>prior===undefined?next:prior.filter(value=>next.includes(value));
const OPENAI_TRANSPARENT_MODELS=new Set(['gpt-image-2','gpt-image-2-2026-04-21','gpt-image-2.5-sunburst','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare','gpt-image-2.5-flare-2026-09-08','gpt-image-2.6-sunburst','gpt-image-2.6-flare']);
const OPENAI_EXTENDED_QUALITY=new Set(['gpt-image-2.5-sunburst','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare','gpt-image-2.5-flare-2026-09-08','gpt-image-2.6-sunburst','gpt-image-2.6-flare']);
function defaultProtocol(baseURL){try{const host=new URL(baseURL).hostname;return host==='openrouter.ai'?'openrouter':host==='api.venice.ai'?'venice':host==='api.fal.ai'?'fal':host==='api.openai.com'?'openai':'gemini';}catch{return 'gemini';}}
// Options come from Google's model-specific documentation, not from a guess
// about an arbitrary compatible provider or a guarantee of account access.
function googleImageParameters(model){
 const common=['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9'];let ratios=common,sizes;
 if(model==='gemini-nano-banana-2.1'){ratios=[...common,'1:4','4:1','1:8','8:1'];sizes=['1K','2K','4K'];}
 else if(model==='gemini-3.1-flash-image'){ratios=[...common,'1:4','4:1','1:8','8:1'];sizes=['512','1K','2K','4K'];}
 else if(model==='gemini-3-pro-image')sizes=['1K','2K','4K'];
 else if(model==='gemini-3.1-flash-lite-image')sizes=['1K'];
 else return {};
 return {resolution:{type:'enum',values:sizes},aspect_ratio:{type:'enum',values:ratios}};
}

// Secrets are resolved from the host's credential service for each operation.
// Neither model catalogues nor task records contain their values.
export class DshImageProviders{
 constructor(ctx,connections=[],imageSettings=null){this.ctx=ctx;this.imageSettings=imageSettings;this.connections=Array.isArray(connections)?connections.filter(p=>p&&typeof p.id==='string'):[];this.cache=new Map();}
 async routes(){
  const refs=new Map(this.connections.map(p=>[p.id,{id:p.id,name:p.name||p.id,baseURL:p.baseURL,ref:p.credentialRef,protocol:p.protocol||defaultProtocol(p.baseURL)}]));if(!refs.has('openrouter'))refs.set('openrouter',{id:'openrouter',name:'OpenRouter · DSH',baseURL:'https://openrouter.ai/api/v1',ref:'OPENROUTER_API_KEY',protocol:'openrouter'});
  if(!refs.has('venice'))refs.set('venice',{id:'venice',name:'Venice · DSH',baseURL:'https://api.venice.ai/api/v1',ref:'VENICE_API_KEY',protocol:'venice'});
  if(!refs.has('fal'))refs.set('fal',{id:'fal',name:'fal · DSH',baseURL:'https://api.fal.ai/v1',ref:'FAL_KEY',protocol:'fal'});
  if(!refs.has('openai'))refs.set('openai',{id:'openai',name:'OpenAI · DSH',baseURL:'https://api.openai.com/v1',ref:'OPENAI_API_KEY',protocol:'openai'});
  if(!refs.has('google-gemini'))refs.set('google-gemini',{id:'google-gemini',name:'Google Gemini · DSH (GOOGLE_API_KEY)',baseURL:'https://generativelanguage.googleapis.com/v1beta',ref:'GOOGLE_API_KEY',protocol:'gemini'});
  if(!refs.has('gemini'))refs.set('gemini',{id:'gemini',name:'Google Gemini · DSH (GEMINI_API_KEY)',baseURL:'https://generativelanguage.googleapis.com/v1beta',ref:'GEMINI_API_KEY',protocol:'gemini'});
  for(const form of this.ctx.get?.('settings')?.describe?.({redactSecrets:true})||[]){
   for(const [id,p] of Object.entries(form.value?.providers||{})){
    if(!p||typeof p!=='object')continue;let url;try{url=new URL(p.baseURL);}catch{continue;}
    if((url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))&&!url.username&&!url.password&&typeof p.apiKeyEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.apiKeyEnv))refs.set(id,{id,name:(p.displayName||id)+' · DSH',baseURL:url.href.replace(/\/$/,''),ref:p.apiKeyEnv,protocol:url.hostname==='openrouter.ai'?'openrouter':url.hostname==='api.venice.ai'?'venice':url.hostname==='api.fal.ai'?'fal':url.hostname==='api.openai.com'?'openai':'gemini'});
   }
  }
  const dedicated=this.imageSettings?.route();refs.delete('designcraft-image-api');if(dedicated)refs.set(dedicated.id,dedicated);
  const result=[];for(const route of refs.values()){let url;try{url=new URL(route.baseURL);}catch{continue;}if(!['gemini','openrouter','venice','fal','openai'].includes(route.protocol)||route.protocol==='fal'&&(url.origin!=='https://api.fal.ai'||!['/v1','/v1/'].includes(url.pathname))||route.protocol==='openai'&&route.id!=='designcraft-image-api'&&(url.origin!=='https://api.openai.com'||!['/v1','/v1/'].includes(url.pathname))||url.username||url.password||url.search||url.hash||!((url.protocol==='https:')||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||! /^[A-Za-z_][A-Za-z0-9_]*$/.test(route.ref||''))continue;route.baseURL=route.protocol==='fal'?'https://api.fal.ai/v1':route.protocol==='openai'&&route.id!=='designcraft-image-api'?'https://api.openai.com/v1':route.baseURL.replace(/\/$/,'');try{const credential=await this.ctx.get?.('credentials')?.resolve?.(route.ref);if(typeof credential?.value==='string'&&credential.value.trim())result.push(route);}catch{/* An unavailable optional credential must not hide other configured providers. */}}return result;
 }
 async route(id){const route=(await this.routes()).find(r=>r.id===id);if(!route)throw new SafetyError('DSH 没有可用的图片服务连接，请配置支持图片生成或编辑的现有服务',503);return route;}
 async request(route,path,{body,form,signal,limit=48*1024*1024,responseType='json',onDispatch}={}){
  const key=(await this.ctx.get?.('credentials')?.resolve?.(route.ref))?.value;if(typeof key!=='string'||!key.trim())throw new SafetyError('DSH 图片服务凭据不可用',503);
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>controller.abort(new Error('图片服务请求超时')),180000);
  try{
   if(body!==undefined&&form!==undefined)throw new SafetyError('图片请求不能同时使用 JSON 和表单',422);const encoded=body!==undefined?JSON.stringify(body):undefined,posting=body!==undefined||form!==undefined;if(posting){signal?.throwIfAborted();try{await onDispatch?.();}catch(error){throw new SafetyError('图片请求记录未能保存，未发送服务：'+String(error.message||error).slice(0,200),500);}signal?.throwIfAborted();}
   const google=new URL(route.baseURL).origin==='https://generativelanguage.googleapis.com';
   const response=await fetch(route.baseURL+path,{method:posting?'POST':'GET',headers:{...(google?{'x-goog-api-key':key}:{Authorization:'Bearer '+key}),...(body!==undefined?{'Content-Type':'application/json'}:{}),'X-Title':'DesignCraft for DSH'},...(posting?{body:form??encoded}:{}),signal:controller.signal,redirect:'error'});
   if(Number(response.headers.get('content-length'))>limit)throw new SafetyError('图片服务响应超过预算',413);
   if(!response.body)throw new SafetyError('图片服务未返回响应内容',502);
   const reader=response.body.getReader(),chunks=[];let bytes=0;while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>limit){await reader.cancel();throw new SafetyError('图片服务响应超过预算',413);}chunks.push(Buffer.from(item.value));}
   const payload=Buffer.concat(chunks,bytes),warnings=[];
   if(route.protocol==='venice'&&response.headers.get('x-venice-is-blurred')?.toLowerCase()==='true')warnings.push('Venice 标记该图片已被模糊处理。');
   if(route.protocol==='venice'&&response.headers.get('x-venice-is-content-violation')?.toLowerCase()==='true')warnings.push('Venice 标记该图片触及内容处理规则，画面可能被遮盖。');
   if(response.ok&&responseType==='image'){
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),png=payload.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=payload[0]===255&&payload[1]===216,webp=payload.subarray(0,4).toString()==='RIFF'&&payload.subarray(8,12).toString()==='WEBP';
    if(!(mime==='image/png'&&png||mime==='image/jpeg'&&jpeg||mime==='image/webp'&&webp))throw new SafetyError('图片服务返回的媒体类型或文件内容不一致',502);
    return {bytes:payload,mime,requestId:safeRequestId(response.headers.get('x-request-id'),key),warnings};
   }
   let data;try{data=JSON.parse(payload.toString('utf8'));}catch{throw new SafetyError('图片服务未返回有效 JSON（HTTP '+response.status+'）',502);}
   if(!response.ok||data?.error){const raw=String(typeof data==='string'?data:typeof data?.error==='string'?data.error:data?.error?.message||'请求未成功').replaceAll(key,'[redacted]').replace(/Bearer\s+\S+|sk-[A-Za-z0-9_-]+/gi,'[redacted]').slice(0,400);throw new SafetyError('图片服务 HTTP '+response.status+'：'+raw,response.status===429?429:502);}
   if(!data||typeof data!=='object'||Array.isArray(data))throw new SafetyError('图片服务返回的 JSON 结构无效',502);
   if(responseType==='image')throw new SafetyError('图片服务未返回实际图片字节',502);
   return {data,requestId:safeRequestId(response.headers.get('x-request-id'),key)||safeRequestId(data.id,key)||safeRequestId(data.responseId,key),warnings};
  }catch(error){if(signal?.aborted)throw new SafetyError('本地已停止等待；服务端可能仍在处理或计费，请核对任务记录',499);if(controller.signal.aborted)throw new SafetyError('图片服务超时，结果未确认；请核对任务记录，不自动重发',504);if(error instanceof SafetyError)throw error;throw new SafetyError('图片服务网络请求失败：'+String(error.message).replaceAll(key,'[redacted]').slice(0,300),502);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async catalogue(provider){
  const configured=this.imageSettings?.route(),routes=await this.routes();
  const preferred=provider||configured?.id||routes[0]?.id;
  if(configured&&(!provider||provider===configured.id)&&!routes.some(row=>row.id===configured.id))throw new SafetyError('独立生图 API 的密钥不可用，请打开生图 API 设置核对',503);
  if(!routes.length)return {providers:[],models:[]};const route=routes.find(row=>row.id===preferred);if(!route)throw new SafetyError('所选图片服务已改变，请重新选择',409);let entry=this.cache.get(route.id);
  if(!entry||entry.routeIdentity!==routeIdentity(route)||Date.now()-entry.at>180000){
   if(route.configuredModel){
    const id=route.protocol==='gemini'?route.configuredModel.replace(/^models\//,''):route.configuredModel;
    const inputImage=route.protocol==='openai'?/^(?:gpt-image-[A-Za-z0-9._-]+|chatgpt-image-latest)$/.test(id):/(?:image|nano-banana)/i.test(id);
    entry={at:Date.now(),protocol:route.protocol,baseURL:route.protocol==='gemini'?(new URL(route.baseURL).origin==='https://generativelanguage.googleapis.com'&&new URL(route.baseURL).pathname==='/'?route.baseURL+'/v1beta':route.baseURL.replace(/\/v1$/,'/v1beta')):route.baseURL,models:[{id,name:id+' · 手动配置',inputImage,capabilitySource:'user_configured_protocol_inferred',...(route.protocol==='openai'?{maxInputImages:4}:{}),parameters:{}}],warnings:['模型 ID 来自您的配置，未读取服务目录；图片及参考图能力尚未核验，实际支持以服务响应为准。']};
   }else if(route.protocol==='gemini'){
    // Google's Model resource may omit modality metadata entirely. Use only
    // models actually returned by this connection; where metadata is absent,
    // label image-named or explicitly documented Gemini models as inferred candidates.
    const parsed=new URL(route.baseURL);let baseURL=route.baseURL.replace(/\/v1$/,'/v1beta');
    if(parsed.hostname==='generativelanguage.googleapis.com'&&(!parsed.pathname||parsed.pathname==='/'))baseURL=route.baseURL+'/v1beta';
    const native={...route,baseURL},models=[],tokens=new Set();let token='';
    for(let page=0;page<10;page++){
     const query=new URLSearchParams({pageSize:'100'});if(token)query.set('pageToken',token);
     const response=await this.request(native,'/models?'+query,{limit:4*1024*1024});
     if(!Array.isArray(response.data.models))throw new SafetyError('该 DSH 连接没有返回原生模型目录',422);
     models.push(...response.data.models);if(models.length>5000)throw new SafetyError('模型目录超过预算',413);
     const next=response.data.nextPageToken;if(!next){token='';break;}
     if(typeof next!=='string'||next.length>2000||tokens.has(next))throw new SafetyError('模型目录分页无效',502);
     tokens.add(next);token=next;
    }
    if(token)throw new SafetyError('模型目录页数超过预算，请缩小服务目录',413);
    const candidates=[];
    for(const m of models){
     if(typeof m?.name!=='string'||!/^models\/[A-Za-z0-9._-]+$/.test(m.name))continue;
     const outputs=Array.isArray(m.supportedOutputModalities)?m.supportedOutputModalities.filter(v=>typeof v==='string').map(v=>v.toLowerCase()):null;
     const inputs=Array.isArray(m.supportedInputModalities)?m.supportedInputModalities.filter(v=>typeof v==='string').map(v=>v.toLowerCase()):null;
     const documentedNano=parsed.origin==='https://generativelanguage.googleapis.com'&&m.name==='models/gemini-nano-banana-2.1';
     const inferred=!outputs&&(documentedNano||/^models\/gemini[-.][A-Za-z0-9._-]*[-_]image(?:[-_.]|$)/i.test(m.name))&&Array.isArray(m.supportedGenerationMethods)&&m.supportedGenerationMethods.includes('generateContent');
     if(!outputs?.includes('image')&&!inferred||parsed.origin==='https://generativelanguage.googleapis.com'&&Array.isArray(m.supportedGenerationMethods)&&!m.supportedGenerationMethods.includes('generateContent'))continue;
     const id=m.name.slice(7),parameters=parsed.origin==='https://generativelanguage.googleapis.com'?googleImageParameters(id):{};
     candidates.push({id,name:m.displayName||m.name,inputImage:inputs?inputs.includes('image'):inferred||documentedNano,capabilitySource:inferred||!inputs&&documentedNano?'model_name_inferred':'provider_declared',parameters});
    }
    entry={at:Date.now(),protocol:'gemini',baseURL:native.baseURL,models:candidates};
   }else if(route.protocol==='openai'){
    const {data}=await this.request(route,'/models',{limit:8*1024*1024});if(!Array.isArray(data.data)||data.data.length>5000)throw new SafetyError('OpenAI 模型目录无效或超过预算',502);
    const models=data.data.filter(item=>typeof item?.id==='string'&&/^(?:gpt-image-[A-Za-z0-9._-]+|chatgpt-image-latest)$/.test(item.id)).map(item=>{const documented=new URL(route.baseURL).origin==='https://api.openai.com'&&OPENAI_TRANSPARENT_MODELS.has(item.id),qualities=OPENAI_EXTENDED_QUALITY.has(item.id)?['low','medium','high','xhigh','max']:['low','medium','high'];return {id:item.id,name:item.id,inputImage:true,maxInputImages:4,capabilitySource:'model_name_inferred',svgCapable:new URL(route.baseURL).origin==='https://api.openai.com'&&/^gpt-image-2\.6-(?:sunburst|flare)(?:-\d{4}-\d{2}-\d{2})?$/.test(item.id),...(documented?{transparentGenerate:true,transparentEdit:true,transparentCapabilitySource:'official_model_docs',transparentPreview:item.id==='gpt-image-2'||item.id==='gpt-image-2-2026-04-21',openAiSizing:true,qualityGenerate:qualities,qualityEdit:qualities,optionsCapabilitySource:'official_model_docs'}:{}),parameters:documented?{resolution:{type:'enum',values:['1024x1024','1536x1024','1024x1536']}}:{}};});
    entry={at:Date.now(),protocol:'openai',models,warnings:['图片及参考图能力依据已返回模型名称和官方协议推断，账号权限与实际支持以服务响应为准。']};
   }else if(route.protocol==='fal'){
    const key=(await this.ctx.get?.('credentials')?.resolve?.(route.ref))?.value;if(typeof key!=='string'||!key.trim())throw new SafetyError('DSH fal 凭据不可用',503);
    const result=await falCatalogue(key);entry={at:Date.now(),protocol:'fal',...result};
   }else if(route.protocol==='venice'){
    const requested=['image','inpaint'],responses=await Promise.allSettled(requested.map(type=>this.request(route,'/models?type='+type,{limit:4*1024*1024}))),byId=new Map(),warnings=[];let validCatalogues=0;
    for(let i=0;i<responses.length;i++){
     const response=responses[i],kind=requested[i];
     if(response.status!=='fulfilled'){warnings.push((kind==='image'?'文生图':'图片编辑')+'模型目录读取失败：'+String(response.reason?.message||response.reason).slice(0,200));continue;}
     const data=response.value.data;if(!Array.isArray(data?.data)){warnings.push((kind==='image'?'文生图':'图片编辑')+'模型目录格式无效');continue;}
     validCatalogues++;if(data.data.length>5000)throw new SafetyError('Venice 模型目录超过预算',413);
     for(const m of data.data){
      if(!m||m.type!==kind||typeof m.id!=='string'||!/^[A-Za-z0-9._:/-]{1,200}$/.test(m.id)||m.model_spec?.offline===true)continue;
      const c=m.model_spec?.constraints||{},caps=m.model_spec?.capabilities||{},rawMax=c.maxInputImages??caps.maxInputImages,combine=c.combineImages??caps.combineImages;
      const maxInputImages=Number.isSafeInteger(rawMax)&&rawMax>=1?Math.min(rawMax,16):combine===false?1:3;
      let row=byId.get(m.id);if(!row){row={id:m.id,name:typeof m.model_spec?.name==='string'?m.model_spec.name.slice(0,200):m.id,inputImage:false,requiresInputImage:true,maxInputImages:0,capabilitySource:'provider_declared',parameters:{},veniceSizing:true,generationPromptMax:null,editPromptMax:null};byId.set(m.id,row);}
      const declared=Number.isSafeInteger(c.promptCharacterLimit)&&c.promptCharacterLimit>0?c.promptCharacterLimit:null;
      const transparent=c.supportsTransparentBackground===true;
      const qualities=Array.isArray(c.qualities)&&c.qualities.length<=3&&c.qualities.every(value=>['low','medium','high'].includes(value))?[...new Set(c.qualities)]:[];
      const resolutions=veniceOptions(c.resolutions,/^[A-Za-z0-9._-]{1,16}$/),aspects=veniceOptions(c.aspectRatios,/^(?:auto|[1-9]\d{0,3}:[1-9]\d{0,3})$/i);
      if(kind==='image'){const styleMax=m.model_spec?.supportsStyleReferences===true&&Number.isSafeInteger(c.maxStyleReferences)&&c.maxStyleReferences>0?Math.min(c.maxStyleReferences,4):0,styleStrength=styleMax>0&&c.supportsStyleReferenceStrength===true;row.requiresInputImage=false;row.generationPromptMax=Math.min(declared||7500,7500);row.transparentGenerate=row.transparentGenerate===undefined?transparent:row.transparentGenerate&&transparent;row.qualityGenerate=intersectOptions(row.qualityGenerate,qualities);row.resolutionsGenerate=intersectOptions(row.resolutionsGenerate,resolutions);row.aspectsGenerate=intersectOptions(row.aspectsGenerate,aspects);row.styleReferenceMax=row.styleReferenceMax===undefined?styleMax:Math.min(row.styleReferenceMax,styleMax);row.styleReferenceStrength=row.styleReferenceStrength===undefined?styleStrength:row.styleReferenceStrength&&styleStrength;}
      else{row.inputImage=true;row.maxInputImages=maxInputImages;row.editPromptMax=Math.min(declared||32768,32768);row.transparentEdit=row.transparentEdit===undefined?transparent:row.transparentEdit&&transparent;row.qualityEdit=intersectOptions(row.qualityEdit,qualities);row.resolutionsEdit=intersectOptions(row.resolutionsEdit,resolutions);row.aspectsEdit=intersectOptions(row.aspectsEdit,aspects);if(c.singleImageAspectRatio===false)row.singleImageAspectRatio=false;}
     }
    }
    if(!validCatalogues)throw new SafetyError('Venice 图片和编辑模型目录均不可用',503);
    entry={at:Date.now(),protocol:'venice',models:[...byId.values()],warnings};
   }else{
    const {data}=await this.request(route,'/images/models',{limit:4*1024*1024});if(!Array.isArray(data.data)||data.data.length>5000)throw new SafetyError('图片模型目录无效或超过预算',502);
    let invalidReferenceRanges=0;
    const candidates=data.data.filter(m=>m&&typeof m==='object'&&Array.isArray(m.architecture?.output_modalities)&&m.architecture.output_modalities.includes('image')&&typeof m.id==='string').map(m=>{
     const parameters=m.supported_parameters&&typeof m.supported_parameters==='object'&&!Array.isArray(m.supported_parameters)?m.supported_parameters:{},reference=parameters.input_references;
     let inputImage=!!(Array.isArray(m.architecture?.input_modalities)&&m.architecture.input_modalities.includes('image')&&reference),limits={};
     if(inputImage&&reference.type==='range'){
      if(!Number.isSafeInteger(reference.min)||!Number.isSafeInteger(reference.max)||reference.min<0||reference.max<reference.min){inputImage=false;invalidReferenceRanges++;}
      else if(reference.max===0)inputImage=false;
      else limits={minReferenceImages:reference.min,maxInputImages:reference.max,referenceLimitSource:'model_catalogue'};
     }
     return {id:m.id,name:m.name||m.id,inputImage,parameters,...limits};
    });
    entry={at:Date.now(),protocol:'openrouter',models:candidates,...(invalidReferenceRanges?{warnings:['部分模型的参考图数量范围无效，已停用这些模型的参考图入口。']}: {})};
   }
   entry.routeIdentity=routeIdentity(route);this.cache.set(route.id,entry);
  }
  const ordered=configured?[...routes.filter(row=>row.id===configured.id),...routes.filter(row=>row.id!==configured.id)]:routes;
  return {providers:ordered.map(({id,name})=>({id,name})),provider:route.id,...(route.configurationRevision?{connectionFingerprint:imageConnectionFingerprint(route)}:{}),models:entry.models.map(({_fal,...row})=>row),...(entry.warnings?.length?{warnings:entry.warnings}:{})};

 }
 async transformCatalogue(){
  const routes=await this.routes();return {providers:routes.filter(route=>route.protocol==='venice').map(({id,name})=>({id,name})),operations:VENICE_IMAGE_MODES,note:'端点能力来自 Venice 官方文档；账户权限、价格与实际服务尚需确认。'};
 }
 async transformVenice({provider,mode,image,scale,creativity,connectionFingerprint,onDispatch},signal){
  if(!VENICE_IMAGE_MODES.includes(mode))throw new SafetyError('未知 Venice 图片处理操作',422);
  const route=await this.route(provider);if(route.protocol!=='venice'||!/^[a-f0-9]{64}$/.test(connectionFingerprint||'')||imageConnectionFingerprint(route)!==connectionFingerprint)throw new SafetyError('Venice 图片服务连接已改变，未发送图片',409);
  const match=/^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image||'');if(!match)throw new SafetyError('图片处理需要实际 PNG 或 JPEG 输入',422);
  const bytes=Buffer.from(match[1],'base64');if(!bytes.length||bytes.length>8*1024*1024||bytes.toString('base64')!==match[1])throw new SafetyError('图片处理输入无效或超过 8 MiB',413);
  const input=previewImageSize(bytes);
  if(mode==='venice_upscale'&&(![2,4].includes(scale)||typeof creativity!=='number'||!Number.isFinite(creativity)||creativity<0||creativity>0.02||input.width<256||input.height<256||input.width*input.height>=16777216))throw new SafetyError('放大需要至少 256×256 的图片、2 或 4 倍和 0 至 0.02 的创意强度；输入须低于 16777216 像素',422);
  if(mode==='venice_remove_background'&&(scale!==null||creativity!==null))throw new SafetyError('背景移除不接受放大参数',422);
  const path=mode==='venice_upscale'?'/image/upscale':'/image/background-remove',body={image:match[1],...(mode==='venice_upscale'?{scale,creativity}:{})};
  const result=await this.request(route,path,{body,signal,onDispatch,responseType:'image',limit:64*1024*1024});
  if(result.mime!=='image/png')throw new SafetyError('Venice 图片处理没有返回预期的 PNG 字节',502);
  const output=previewImageSize(result.bytes),warnings=[...(result.warnings||[])];
  if(mode==='venice_upscale'&&(output.width!==input.width*scale||output.height!==input.height*scale))warnings.push('服务返回的实际尺寸与请求倍数不同，请以返回图片为准。');
  if(mode==='venice_remove_background')warnings.push('背景移除结果的透明度、边缘与内容需检查。');
  return {...result,warnings};
 }
 async generate({provider,model,prompt,resolution,aspectRatio,quality,connectionFingerprint,transparentBackground,references=[],styleReferences=[],styleReferenceStrength,onDispatch,onRemoteAccepted,onRemoteStatus},signal){
  if(transparentBackground!==undefined&&typeof transparentBackground!=='boolean')throw new SafetyError('透明背景选项无效',422);
  if(quality!==undefined&&typeof quality!=='string')throw new SafetyError('图片画质选项无效',422);
  if(!Array.isArray(styleReferences)||styleReferences.length>4||styleReferenceStrength!==undefined&&(typeof styleReferenceStrength!=='number'||!Number.isFinite(styleReferenceStrength)||styleReferenceStrength<0.1||styleReferenceStrength>1)||!styleReferences.length&&styleReferenceStrength!==undefined)throw new SafetyError('风格参考图或强度无效',422);
  const catalogue=await this.catalogue(provider),entry=catalogue.models.find(m=>m.id===model);if(!entry)throw new SafetyError('请从当前图片服务目录或手动配置中选择模型',422);if(references.length&&!entry.inputImage)throw new SafetyError('所选模型没有图片参考/编辑能力声明',422);
  const route=await this.route(catalogue.provider),cached=this.cache.get(route.id);if(connectionFingerprint!==undefined&&(!/^[a-f0-9]{64}$/.test(connectionFingerprint)||imageConnectionFingerprint(route)!==connectionFingerprint))throw new SafetyError('图片服务连接已改变，未发送产品参考图；请重新制定计划',409);if(!cached||cached.routeIdentity!==routeIdentity(route))throw new SafetyError('图片服务连接已改变，请重新选择模型',409);if(transparentBackground===true&&(!['venice','openai'].includes(cached.protocol)||(references.length?entry.transparentEdit:entry.transparentGenerate)!==true))throw new SafetyError('当前模型没有可核对的透明背景能力，未发送请求',422);if(quality&&(!['venice','openai'].includes(cached.protocol)||(references.length?entry.qualityEdit:entry.qualityGenerate)?.includes(quality)!==true))throw new SafetyError('当前模型没有可核对的画质选项，未发送请求',422);if(styleReferences.length&&(cached.protocol!=='venice'||references.length||!Number.isSafeInteger(entry.styleReferenceMax)||styleReferences.length>entry.styleReferenceMax||styleReferenceStrength!==undefined&&entry.styleReferenceStrength!==true))throw new SafetyError('当前模型未声明支持所选风格参考，或请求混入普通参考图',422);let image,additionalImages=[],usage,requestId,providerWarnings=[];
  if(styleReferences.length){let total=0;for(const value of styleReferences){const match=/^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value||'');if(!match)throw new SafetyError('风格参考必须为实际 PNG/JPEG',422);const bytes=Buffer.from(match[1],'base64');if(!bytes.length||bytes.length>=8000000||(total+=bytes.length)>16*1024*1024||bytes.toString('base64')!==match[1])throw new SafetyError('风格参考图无效或超过预算',413);previewImageSize(bytes);}}
  if(cached.protocol==='gemini'){
   const parts=[{text:prompt},...references.map(url=>{const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(url);if(!match)throw new SafetyError('图片参考数据无效',422);return {inlineData:{mimeType:match[1],data:match[2]}};})];
   if(resolution&&!entry.parameters.resolution?.values?.includes(resolution)||aspectRatio&&!entry.parameters.aspect_ratio?.values?.includes(aspectRatio))throw new SafetyError('该模型没有声明所选尺寸或比例，请重新选择',422);
   const imageConfig={...(resolution?{imageSize:resolution}:{}),...(aspectRatio?{aspectRatio}:{})},generationConfig={responseModalities:['TEXT','IMAGE'],...(Object.keys(imageConfig).length?{imageConfig}:{})};
   const response=await this.request({...route,baseURL:cached.baseURL},'/models/'+encodeURIComponent(model)+':generateContent',{body:{contents:[{role:'user',parts}],generationConfig},signal,onDispatch});requestId=response.requestId;
   const candidates=Array.isArray(response.data.candidates)?response.data.candidates:[],outputParts=candidates.filter(c=>c&&(!c.finishReason||c.finishReason==='STOP')).flatMap(c=>Array.isArray(c.content?.parts)?c.content.parts:[]).filter(p=>p&&p.thought!==true&&(p.inlineData?.data||p.inline_data?.data));
   if(outputParts.length>128)throw new SafetyError('单次请求返回的图片超过 128 张预算，未生成候选',413);
   if(outputParts.length>1){providerWarnings.push('服务返回多张最终图片；原图均保存，其余图片可按需转为候选。');additionalImages=outputParts.slice(1).map(part=>{const data=part.inlineData||part.inline_data;return {b64_json:data.data,media_type:data.mimeType||data.mime_type};});}
   const inline=outputParts[0]?.inlineData||outputParts[0]?.inline_data;image=inline?{b64_json:inline.data,media_type:inline.mimeType||inline.mime_type}:null;
   const meta=response.data.usageMetadata||{};usage={prompt_tokens:meta.promptTokenCount,completion_tokens:meta.candidatesTokenCount,total_tokens:meta.totalTokenCount};
  }else if(cached.protocol==='openai'){
   if(aspectRatio||resolution&&entry.parameters.resolution?.values?.includes(resolution)!==true)throw new SafetyError('当前 OpenAI 模型没有可核对的所选尺寸或比例',422);
   let response;if(references.length){
    if(references.length>4)throw new SafetyError('当前图片工作区最多发送 4 张参考图',422);const form=new FormData();form.append('model',model);form.append('prompt',prompt);form.append('n','1');form.append('output_format','png');if(transparentBackground)form.append('background','transparent');if(resolution)form.append('size',resolution);if(quality)form.append('quality',quality);
    references.forEach((value,index)=>{const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(value);if(!match)throw new SafetyError('OpenAI 参考图格式无效',422);const bytes=Buffer.from(match[2],'base64');form.append('image[]',new Blob([bytes],{type:match[1]}),'reference-'+(index+1)+(match[1]==='image/png'?'.png':'.jpg'));});
    response=await this.request(route,'/images/edits',{form,signal,onDispatch});
   }else response=await this.request(route,'/images/generations',{body:{model,prompt,n:1,output_format:'png',...(transparentBackground?{background:'transparent'}:{}),...(resolution?{size:resolution}:{}),...(quality?{quality}:{})},signal,onDispatch});
   image=response.data.data?.[0];requestId=response.requestId;usage=response.data.usage||{};
  }else if(cached.protocol==='fal'){
   if(resolution||aspectRatio)throw new SafetyError('fal 当前图片界面暂不传递未经核对的尺寸参数',422);
   const privateEntry=cached.models.find(item=>item.id===model),key=(await this.ctx.get?.('credentials')?.resolve?.(route.ref))?.value;
   if(!privateEntry?._fal||typeof key!=='string'||!key.trim()||typeof onRemoteAccepted!=='function')throw new SafetyError('fal 凭据、模型描述或任务记录不可用',503);
   return falGenerate(key,{model,prompt,references,spec:privateEntry._fal,onDispatch,onAccepted:details=>onRemoteAccepted({...details,connection:routeIdentity(route)}),onStatus:onRemoteStatus},signal);
  }else if(cached.protocol==='venice'){
   if(resolution&&(references.length?entry.resolutionsEdit:entry.resolutionsGenerate)?.includes(resolution)!==true||aspectRatio&&(references.length?entry.aspectsEdit:entry.aspectsGenerate)?.includes(aspectRatio)!==true)throw new SafetyError('Venice 模型目录未声明当前端点支持所选尺寸或比例',422);
   if(aspectRatio&&references.length===1&&entry.singleImageAspectRatio===false)throw new SafetyError('该 Venice 模型声明单图编辑会忽略画面比例，请使用源图比例',422);
   if(references.length){
    if(!entry.inputImage||references.length>entry.maxInputImages)throw new SafetyError('该 Venice 模型不支持所选数量的参考图',422);
    if(prompt.length>(entry.editPromptMax||32768))throw new SafetyError('图片编辑提示词超过该模型的字符上限',422);
    const valid=references.every(url=>/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(url));if(!valid)throw new SafetyError('参考图必须是实际 PNG/JPEG 图像',422);
    for(const reference of references){const bytes=Buffer.from(reference.slice(reference.indexOf(',')+1),'base64'),size=previewImageSize(bytes);if(size.width<256||size.height<256)throw new SafetyError('Venice 编辑参考图按文件头计算宽或高小于 256 像素，未发送请求',422);}
    const response=await this.request(route,'/image/multi-edit',{body:{modelId:model,prompt,images:references,output_format:'png',...(resolution?{resolution}:{}),...(aspectRatio?{aspect_ratio:aspectRatio}:{}),...(transparentBackground?{transparent_background:true}:{}),...(quality?{quality}:{})},signal,responseType:'image',onDispatch});
    if(transparentBackground&&response.mime!=='image/png')throw new SafetyError('透明背景请求未返回 PNG，结果尚未确认',502);
    return {bytes:response.bytes,mime:response.mime,requestId:response.requestId,usage:{},warnings:[...(response.warnings||[]),...(transparentBackground?['已请求透明背景；实际透明度、边缘和原生导入效果需检查。']:[])]};
   }
   if(entry.requiresInputImage)throw new SafetyError('所选 Venice 编辑模型需要参考图',422);
   if(prompt.length>(entry.generationPromptMax||7500))throw new SafetyError('图片生成提示词超过该模型的字符上限',422);
   const response=await this.request(route,'/image/generate',{body:{model,prompt,format:'png',variants:1,return_binary:false,...(resolution?{resolution}:{}),...(aspectRatio?{aspect_ratio:aspectRatio}:{}),...(transparentBackground?{transparent_background:true}:{}),...(quality?{quality}:{}),...(styleReferences.length?{style_references:styleReferences.map(image=>({image,...(styleReferenceStrength!==undefined?{strength:styleReferenceStrength}:{})}))}:{})},signal,onDispatch});
   image={b64_json:response.data.images?.[0],media_type:'image/png'};requestId=response.requestId;usage={};providerWarnings=[...(response.warnings||[])];
   if(styleReferences.length)providerWarnings.push('已发送风格参考图；风格符合度及实际费用需核对。');
   if(Number.isFinite(response.data.content_policy_violation_count)&&response.data.content_policy_violation_count>0)providerWarnings.push('Venice 报告部分图像被内容规则拒绝。');
  }else{
   if(references.length&&Number.isSafeInteger(entry.minReferenceImages)&&references.length<entry.minReferenceImages)throw new SafetyError('该模型使用参考图时至少需要 '+entry.minReferenceImages+' 张输入图',422);
   if(Number.isSafeInteger(entry.maxInputImages)&&references.length>entry.maxInputImages)throw new SafetyError('该模型最多接受 '+entry.maxInputImages+' 张参考图',422);
   const body={model,prompt};const add=(key,value)=>{if(value==null||value==='')return;const spec=entry.parameters[key];if(!spec)throw new SafetyError('该模型未声明支持 '+key,422);if(spec.type==='enum'&&!spec.values.includes(value))throw new SafetyError('该模型不支持 '+key+'='+value,422);body[key]=value;};
   add('resolution',resolution);add('aspect_ratio',aspectRatio);if(entry.parameters.output_format?.values?.includes('png'))body.output_format='png';if(entry.parameters.n)body.n=1;if(references.length)body.input_references=references.map(url=>({type:'image_url',image_url:{url}}));
   const response=await this.request(route,'/images',{body,signal,onDispatch});image=response.data.data?.[0];requestId=response.requestId;usage=response.data.usage||{};
  }
  const decodeImage=value=>{
   if(typeof value?.b64_json!=='string'||value.b64_json.length>88*1024*1024||! /^[A-Za-z0-9+/\r\n]*={0,2}$/.test(value.b64_json))throw new SafetyError('图片服务未返回有效图像数据',502);
   const normalized=value.b64_json.replace(/[\r\n]/g,''),bytes=Buffer.from(normalized,'base64');if(!bytes.length||bytes.length>64*1024*1024||bytes.toString('base64').replace(/=+$/,'')!==normalized.replace(/=+$/,''))throw new SafetyError('生成图像大小或编码无效',413);
   return {bytes,mime:value.media_type||null};
  };
  const main=decodeImage(image),additional=additionalImages.map(decodeImage);
  if(transparentBackground){if(!main.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new SafetyError('透明背景请求未返回 PNG，结果尚未确认',502);providerWarnings.push('已请求透明背景；实际透明度、边缘和原生导入效果需检查。');}
  return {...main,...(additional.length?{additional}:{}),requestId,usage:Object.fromEntries(['cost','prompt_tokens','completion_tokens','total_tokens'].filter(k=>Number.isFinite(usage?.[k])).map(k=>[k,usage[k]])),warnings:providerWarnings};
 }
 async falRoute(provider,connection){
  const route=await this.route(provider);if(route.protocol!=='fal'||connection!==routeIdentity(route))throw new SafetyError('fal 服务连接已改变，请恢复原连接后查询',409);
  const key=(await this.ctx.get?.('credentials')?.resolve?.(route.ref))?.value;if(typeof key!=='string'||!key.trim())throw new SafetyError('DSH fal 凭据不可用',503);return key;
 }
 async retrieveFal(provider,details,signal,onStatus){const key=await this.falRoute(provider,details.connection);return falRetrieve(key,details,signal,onStatus);}
 async cancelFal(provider,details,signal){const key=await this.falRoute(provider,details.connection);return falCancel(key,details,signal);}
 async generateOpenAiSvg({provider,model,prompt,onDispatch},signal){
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>16000||typeof onDispatch!=='function')throw new SafetyError('SVG 提示词或任务记录无效',422);
  const catalogue=await this.catalogue(provider||'openai'),entry=catalogue.models.find(item=>item.id===model&&item.svgCapable),route=await this.route(catalogue.provider),cached=this.cache.get(route.id);
  if(!entry||route.protocol!=='openai'||cached?.routeIdentity!==routeIdentity(route))throw new SafetyError('请选择当前 OpenAI 目录中已标明 SVG 家族的模型',422);
  const response=await this.request(route,'/images/generations',{body:{model,prompt,n:1,output_format:'svg'},signal,onDispatch,limit:16*1024*1024}),encoded=response.data.data?.[0]?.b64_json;
  if(typeof encoded!=='string'||encoded.length>12*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new SafetyError('OpenAI 未返回有效 SVG 数据',502);
  const bytes=Buffer.from(encoded,'base64');if(!bytes.length||bytes.length>8*1024*1024||bytes.toString('base64')!==encoded)throw new SafetyError('OpenAI SVG 数据大小或编码无效',502);validateStaticExternalSvg(bytes);
  return {bytes,requestId:response.requestId,usage:Object.fromEntries(['input_tokens','output_tokens','total_tokens'].filter(key=>Number.isFinite(response.data.usage?.[key])).map(key=>[key,response.data.usage[key]]))};
 }
}
