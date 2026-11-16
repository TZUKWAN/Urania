const API='/designcraft/api/v2/studio/stock-images';
async function checksum(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');}
export async function openStockImage(controller,onClose,imageId){
 await controller.resumeHostMenu();const {root,epoch,sessionId,id}=controller.view,headers=controller.sourceHeaders();onClose();await new Promise(resolve=>requestAnimationFrame(resolve));
 const sameProject=()=>controller.view?.root===root&&controller.view?.sessionId===sessionId;
 try{
  if(!sameProject()||controller.view.id!==id||controller.view.epoch!==epoch)throw new Error('工作区已切换，图库图片仍保留');
  const response=await fetch(API,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'open',epoch,imageId})}),data=await response.json();
  if(!sameProject())return;if(!response.ok||!data.ok)throw new Error((data.error||'图片导入未确认')+(data.openId?'；已保留导入预约，请在在线找图中核对。':''));controller.change({imageNotice:data.note||'已核对图库图片来源。'});
 }catch(error){if(sameProject())controller.change({imageNotice:String(error.message||error)});}
}
export function createStockPanel(React){
 const h=React.createElement;
 return function StockPanel({controller,onClose,onBack,onOpenImage}){
  const owner=React.useRef({root:controller.view.root,epoch:controller.view.epoch,sessionId:controller.view.sessionId,id:controller.view.id}),alive=React.useRef(true),lock=React.useRef(false),requests=React.useRef(new Set()),urls=React.useRef(new Set());
  const [query,setQuery]=React.useState(''),[search,setSearch]=React.useState(null),[local,setLocal]=React.useState({images:[],searches:[],errors:[],imports:{items:[],errors:[]}}),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[preview,setPreview]=React.useState(null),[selected,setSelected]=React.useState(null);
  const isCurrent=()=>alive.current&&controller.view?.root===owner.current.root&&controller.view?.epoch===owner.current.epoch&&controller.view?.sessionId===owner.current.sessionId&&controller.view?.id===owner.current.id;
  const current=()=>{if(!isCurrent())throw new Error('工作区已切换，请关闭后重新打开在线找图');};
  const request=async(payload)=>{
   current();const abort=new AbortController();requests.current.add(abort);
   try{const response=await fetch(API,{method:'POST',headers:{...controller.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({...payload,epoch:owner.current.epoch}),signal:abort.signal}),data=await response.json();current();if(!response.ok||!data.ok)throw new Error((data.error||'图库请求失败')+(data.openId?'；导入预约已保留，请核对保存源。':data.materialized?'；图片字节已保留，来源记录尚未确认。':''));return data;}finally{requests.current.delete(abort);}
  };
  const refresh=async()=>{const data=await request({action:'list'});setLocal(data);return data;};
  const run=action=>async()=>{if(lock.current||!isCurrent())return;lock.current=true;setBusy(true);setError('');try{await action();}catch(err){if(isCurrent())setError(err.name==='AbortError'?'已停止本地等待；请刷新记录核对已保存结果。':String(err.message||err));}finally{lock.current=false;if(isCurrent())setBusy(false);}};
  const clearPreview=()=>{setPreview(previous=>{if(previous?.url){URL.revokeObjectURL(previous.url);urls.current.delete(previous.url);}return null;});};
  React.useEffect(()=>{alive.current=true;void run(refresh)();return()=>{alive.current=false;for(const request of requests.current)request.abort();requests.current.clear();for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();};},[]);
  const searchFor=async(offset=0)=>{setSearch(null);setSelected(null);clearPreview();setNotice('');const data=await request({action:'search',query,offset});setSearch(data.search);setNotice(data.note||'');await refresh();};
  const loadSearch=async searchId=>{setSearch(null);setSelected(null);clearPreview();const data=await request({action:'search_read',searchId});setSearch(data.search);setQuery(data.search.request.query);setNotice('已读取保存的搜索记录；预览或保存时会重新核对线上版本。');};
  const showPreview=async(fields,label)=>{
   current();clearPreview();const abort=new AbortController();requests.current.add(abort);
   try{const params=new URLSearchParams({epoch:owner.current.epoch,...fields}),response=await fetch(API+'/preview?'+params,{headers:controller.sourceHeaders(),signal:abort.signal});if(!response.ok){const data=await response.json();throw new Error(data.error||'图片预览失败');}
    const type=(response.headers.get('content-type')||'').split(';')[0],bytes=await response.arrayBuffer();if(!['image/png','image/jpeg'].includes(type)||bytes.byteLength>16*1024*1024||await checksum(bytes)!==response.headers.get('x-designcraft-sha256'))throw new Error('图片预览格式、大小或摘要不一致');current();const url=URL.createObjectURL(new Blob([bytes],{type}));urls.current.add(url);setPreview({url,label});
   }finally{requests.current.delete(abort);}
  };
  const capture=async item=>{const data=await request({action:'capture',searchId:search.id,candidateId:item.id});setSelected({record:data.record,candidate:item});setNotice(data.note||'已核对并保存图库图片和来源。');await refresh();};
  const selectSaved=async imageId=>{const data=await request({action:'read',imageId});setSelected(data);clearPreview();setNotice('已核对保存图片及搜索来源；可下载署名记录或打开独立图片源。');};
  const downloadCredits=async imageId=>{const data=await request({action:'credits',imageId}),url=URL.createObjectURL(new Blob([JSON.stringify(data.credits,null,2)+'\n'],{type:'application/json'}));urls.current.add(url);const link=document.createElement('a');link.href=url;link.download=imageId+'-credits.json';document.body.append(link);link.click();link.remove();setTimeout(()=>{URL.revokeObjectURL(url);urls.current.delete(url);},1000);};
  const details=item=>h('div',{style:{fontSize:12,lineHeight:1.7,overflowWrap:'anywhere'}},h('p',null,item.width+' × '+item.height+' · '+(item.downloadKind==='scaled'?'官方缩放图':'原尺寸文件')),h('p',null,'作者：'+(item.author||'来源未提供作者')),h('p',null,'许可：'+(item.license||item.usageTerms||'来源未提供明确许可')),item.attribution?h('p',null,'署名：'+item.attribution):null,item.credit?h('p',null,'来源署名：'+item.credit):null,item.restrictions?h('p',null,'附加说明：'+item.restrictions):null,h('a',{href:item.sourceUrl,target:'_blank',rel:'noopener noreferrer'},'查看原始说明页'),item.licenseUrl?h('span',null,' · ',h('a',{href:item.licenseUrl,target:'_blank',rel:'noopener noreferrer'},'查看许可')):null);
  const disabled=busy||!isCurrent();
  return h('section',{className:'dcStudioImageWorkspace',role:'region','aria-label':'在线找图'},
   h('div',{className:'dcStudioImageHeader'},h('strong',null,'在线找图'),h('span',null,'Wikimedia Commons · 无需图库密钥'),busy?h('button',{className:'dcBtn',onClick:()=>{for(const request of requests.current)request.abort();setNotice('已停止本地等待，已保存文件仍保留；请刷新记录核对。');}},'停止本次请求'):null,h('button',{className:'dcBtn',disabled:busy,onClick:run(refresh)},'刷新已保存记录'),h('button',{className:'dcBtn',disabled:busy,onClick:onBack||onClose},onBack?'返回图片工具':'返回设计')),
   !isCurrent()?h('div',{className:'dcNativeNotice',role:'alert'},'工作区已切换，请返回设计后重新打开。'):null,
   error?h('div',{className:'dcNativeNotice',role:'alert'},error):null,notice?h('div',{className:'dcNativeNotice',role:'status'},notice):null,
   h('form',{className:'dcStudioImageForm',onSubmit:event=>{event.preventDefault();void run(()=>searchFor(0))();}},h('label',null,'找什么图片',h('input',{className:'dcInput',value:query,maxLength:200,disabled,onChange:event=>setQuery(event.target.value),placeholder:'例如：mountain landscape'})),h('button',{type:'submit',className:'dcBtn dcPrimary',disabled:disabled||!query.trim()},busy?'处理中…':'搜索'),h('small',null,'预览和保存会从来源站点读取图片。许可和署名由来源站点提供，请核对说明页；下载的可能是缩放图。')),
   h('div',{className:'dcStudioImageJobs',style:{flex:1}},
    search?h('section',null,h('h3',null,'搜索结果：'+search.request.query),!search.items.length?h('p',null,'本页没有符合 PNG/JPEG、尺寸和来源条件的图片。'):null,search.skipped.length?h('p',null,'本页有 '+search.skipped.length+' 个结果因格式、尺寸或来源信息不足未采用。'):null,
     ...search.items.map(item=>{const saved=local.images.find(row=>row.searchId===search.id&&row.candidateId===item.id);return h('article',{className:'dcStudioImageJob',key:item.id},h('strong',null,item.title.replace(/^File:/,'')),details(item),h('div',{className:'dcStudioImageForm',style:{padding:'8px 0',border:0}},h('button',{className:'dcBtn',disabled,onClick:run(()=>showPreview({searchId:search.id,candidateId:item.id},item.title))},'预览'),h('button',{className:'dcBtn',disabled,onClick:run(()=>saved?selectSaved(saved.id):capture(item))},saved?'查看保存记录':'保存图片与来源')));}),search.nextOffset!==null?h('button',{className:'dcBtn',disabled:disabled||query.trim()!==search.request.query,onClick:run(()=>searchFor(search.nextOffset))},'下一页'):null):null,
    preview?h('article',{className:'dcStudioImageJob'},h('strong',null,preview.label),h('div',null,h('img',{src:preview.url,alt:preview.label,style:{maxWidth:'100%',maxHeight:420,objectFit:'contain'}})),h('button',{className:'dcBtn',onClick:clearPreview},'关闭预览')):null,
    selected?h('article',{className:'dcStudioImageJob'},h('h3',null,'已保存：'+selected.candidate.title.replace(/^File:/,'')),details(selected.candidate),h('p',{style:{fontSize:12}},'已保留实际图片、摘要和来源。编辑后可沿用项目素材流程放入海报或 PPT。'),h('div',{className:'dcStudioImageForm',style:{padding:'8px 0',border:0}},h('button',{className:'dcBtn',disabled,onClick:run(()=>showPreview({imageId:selected.record.id},selected.candidate.title))},'预览保存图片'),h('button',{className:'dcBtn',disabled,onClick:run(()=>downloadCredits(selected.record.id))},'下载署名记录'),h('button',{className:'dcBtn dcPrimary',disabled:disabled||!controller.runtime?.engines?.photocraft||!!controller.state.sourceNavigation,onClick:run(()=>onOpenImage(selected.record.id))},'打开独立图片编辑'))):null,
    h('section',null,h('h3',null,'项目中保存的图片'),...local.images.map(row=>h('div',{key:row.id,style:{display:'flex',gap:8,alignItems:'center',padding:'6px 0'}},h('span',{style:{fontSize:12,overflowWrap:'anywhere'}},row.assetName+' · '+row.width+' × '+row.height),h('button',{className:'dcBtn',disabled,onClick:run(()=>selectSaved(row.id))},'核对与查看'))),!local.images.length?h('p',null,'尚无保存图片。'):null),
    local.errors.length||local.imports.errors.length?h('p',{role:'alert'},'有 '+(local.errors.length+local.imports.errors.length)+' 条记录无法读取，请保留文件并核对。'):null,
    local.imports.items.length?h('section',null,h('h3',null,'图片导入记录'),...local.imports.items.map(row=>h('article',{key:row.id,className:'dcStudioImageJob'},h('p',{style:{fontSize:12,overflowWrap:'anywhere'}},row.id),h('p',null,row.links.length?'已有保存来源记录，仍可核对实际文件。':'尚无确认的保存来源；核对不会重复导入。'),h('button',{className:'dcBtn',disabled,onClick:run(async()=>{const data=await request({action:'reconcile',id:row.id});setNotice(data.note||'核对结束');await refresh();})},'核对保存源')))):null,
    local.searches.length?h('label',{style:{display:'block',fontSize:12,margin:'12px 0'}},'重新查看搜索记录 ',h('select',{className:'dcInput',value:search?.id||'',disabled,onChange:event=>{if(event.target.value)void run(()=>loadSearch(event.target.value))();}},h('option',{value:''},'选择已保存的搜索'),...local.searches.map(row=>h('option',{key:row.id,value:row.id},row.query+' · '+row.at)))):null
   )
  );
 };
}
