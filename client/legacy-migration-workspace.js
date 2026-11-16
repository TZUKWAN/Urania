import {serializePageSvg} from './svg-export.js';
import {configureAssets} from './engine.js';

const API='/designcraft/api/v2/studio/legacy';
const hex=bytes=>crypto.subtle.digest('SHA-256',bytes).then(hash=>[...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join(''));

export function createLegacyMigrationWorkspace(React){
 const h=React.createElement;
 return function LegacyMigrationWorkspace({controller,onClose}){
  const root=React.useRef(controller.view.root),epoch=React.useRef(controller.view.epoch),alive=React.useRef(true);
  const [docs,setDocs]=React.useState([]),[plans,setPlans]=React.useState([]),[plan,setPlan]=React.useState(null),[doc,setDoc]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const call=async(action,body={})=>{
   if(controller.view?.root!==root.current||controller.view?.epoch!==epoch.current)throw new Error('工作区已经切换，迁移快照仍然保留');
   const response=await fetch(API,{method:'POST',headers:{...controller.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action,epoch:epoch.current,...body})});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'旧作品迁移请求失败');return data;
  };
  const refresh=async()=>{const value=await call('list');if(alive.current){setDocs(value.docs);setPlans(value.plans);}};
  const open=async id=>{const result=await call('read',{id});if(alive.current){setPlan(result.plan);setDoc(result.document);}};
  const run=fn=>async()=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){if(alive.current)setError(e.message||String(e));else controller.change({error:'迁移已保留当前进度：'+(e.message||String(e))});}finally{if(alive.current)setBusy(false);}};
  React.useEffect(()=>{alive.current=true;refresh().catch(e=>alive.current&&setError(e.message));return()=>{alive.current=false;};},[]);
  const prepare=async old=>{const result=await call('snapshot',{docId:old.id,revision:old.revision});await refresh();await open(result.plan.id);};
  const file=async(item,backup=false)=>{
   const params=new URLSearchParams({epoch:epoch.current,id:plan.id,...(backup?{backup:'1'}:{itemId:item.id,sha256:item.sha256})});
   const response=await fetch(API+'-file?'+params,{headers:controller.sourceHeaders()});if(!response.ok)throw new Error((await response.json()).error||'迁移文件读取失败');
   const bytes=await response.arrayBuffer();if(await hex(bytes)!==response.headers.get('x-content-sha256')||!backup&&await hex(bytes)!==item.sha256)throw new Error('迁移文件摘要不一致，未导入');return bytes;
  };
  const backup=async()=>{const bytes=await file(null,true),url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=(plan.title||'旧作品')+'-原始备份.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  const migrate=async()=>{
   if(!plan||!doc)throw new Error('请先准备一份旧作品快照');
   const queue=[...plan.items],issues=[];
   if(plan.type!=='deck'){
    configureAssets(root.current,doc.id,[]);
    for(const page of doc.pages){
     try{
      const svg=await serializePageSvg(doc,page,{assetUrl:name=>'/designcraft/api/v1/asset?'+new URLSearchParams({root:root.current,name:typeof name==='string'?name:name?.src||''})});
      const staged=await call('stage-page',{id:plan.id,pageId:page.id,svg});queue.push(staged.item);
     }catch(e){const message='画板 '+(page.name||page.id)+' 未转换：'+e.message;issues.push(message);await call('note',{id:plan.id,pageId:page.id,message});}
    }
   }
   if(!queue.length){await open(plan.id);throw new Error('没有可导入的原生源；旧作品备份及未转换说明已保留');}
   const ownerRoot=root.current;await controller.resumeHostMenu();let completed=0;
   for(const item of queue){
    if(controller.view?.root!==ownerRoot||controller.view?.epoch!==epoch.current)throw new Error('工作区发生切换；已迁移 '+completed+' 项，重新打开迁移记录即可继续');
    const matches=await call('candidates',{id:plan.id,itemId:item.id,sha256:item.sha256});
    if(matches.sources.length>1){issues.push(item.title+' 已有多份导入，请在作品列表选择');continue;}
    let sourceId=matches.sources[0]?.sourceId;
    if(!sourceId){
     const bytes=await file(item);const name=(item.title||'迁移作品').replace(/[<>:"/\\|?*\0]/g,'_').slice(0,100)+'.'+item.extension;
     await controller.importFile(new File([bytes],name,{type:item.extension==='svg'?'image/svg+xml':'application/octet-stream'}));
     if(controller.view.root!==ownerRoot)throw new Error('工作区发生切换；已导入文件仍保留');
     epoch.current=controller.view.epoch;sourceId=controller.view.sourceId;
    }
    await call('receipt',{id:plan.id,itemId:item.id,sha256:item.sha256,sourceId});completed++;
   }
   controller.change({migrationNotice:'迁移记录 '+plan.id+'：已导入或确认 '+completed+' 项。'+(issues.length?issues.join('；'):'原始备份和旧作品均保留。')});
   onClose();
  };
  return h('div',{className:'dcLegacyWorkspace',role:'region','aria-label':'旧作品迁移'},
   h('div',{className:'dcStudioImageHeader'},h('strong',null,'旧作品迁移'),h('span',null,'先备份，再另存专业源'),h('button',{className:'dcBtn',disabled:busy,onClick:onClose},'返回设计')),
   error?h('div',{className:'dcNativeNotice',role:'alert'},error):null,
   h('div',{className:'dcLegacyBody'},h('section',null,h('h3',null,'旧作品'),docs.length?docs.map(item=>h('div',{key:item.id,className:'dcLegacyRow'},h('span',null,item.title),h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>prepare(item))},'准备迁移'))):h('p',null,'当前工作区没有旧作品。'),
    h('h3',null,'迁移记录'),...plans.map(item=>h('div',{key:item.id,className:'dcLegacyRow'},h('span',null,item.error||item.title+' · '+item.at),!item.error?h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>open(item.id))},'继续'):null))),
    plan?h('section',null,h('h3',null,plan.title),h('p',null,'旧版本：'+plan.revision+' · 原生源 '+plan.items.length+' 项 · 画板 '+plan.pages.length+' 页'),
     ...plan.warnings.map((warning,index)=>h('p',{key:index,role:'status'},warning)),
     ...(plan.receipts||[]).filter(item=>item.kind==='page-error').map(item=>h('p',{key:item.at,role:'status'},item.message)),
     h('button',{className:'dcBtn',disabled:busy,onClick:run(backup)},'下载原始备份'),
     h('button',{className:'dcBtn dcPrimary',disabled:busy,onClick:run(migrate)},'转换并迁移可恢复内容'),
     h('p',null,'每项导入都有独立来源；已导入的文件可在重新打开记录后继续核对。')):null));
 };
}
