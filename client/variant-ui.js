export function createVariantPanel({React,store,sync}){
 const {createElement:h,useState,useEffect,useRef}=React;
 return function VariantPanel(){
  const s=store.get(),scope=s.root+'|'+s.doc?.id,[groups,setGroups]=useState([]),[groupsScope,setGroupsScope]=useState(scope),[expanded,setExpanded]=useState(false),[activeId,setActiveId]=useState(''),[label,setLabel]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[offset,setOffset]=useState(0),generation=useRef(0);
  const refresh=async(ticket=generation.current)=>{const scopeAtCall=store.get().root+'|'+store.get().doc?.id,result=await sync.variantGroups();if(ticket===generation.current&&store.get().root+'|'+store.get().doc?.id===scopeAtCall){setGroupsScope(scopeAtCall);setGroups(result.groups||[]);if(result.warnings?.length)setError(result.warnings.map(w=>w.error).join('；'));}};
  useEffect(()=>{const ticket=++generation.current;setGroups([]);setExpanded(false);setOffset(0);refresh(ticket).catch(e=>setError(e.message));const timer=setInterval(()=>refresh(ticket).catch(e=>ticket===generation.current&&setError(e.message)),5000);return()=>{generation.current++;clearInterval(timer);};},[scope]);
  const run=async operation=>{setBusy(true);setError('');try{await operation();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const visible=groupsScope===scope?groups:[],active=visible.find(g=>g.id===activeId)||visible[0];
  return h('div',null,h('p',{className:'dcHint'},'作品方案保留独立的可编辑文档，复用同一项目素材。复制后可以直接编辑，也可让左侧 AI 修改该方案。采用时合并原作后续的人工作业；有冲突则保留双方。'),
   h('input',{className:'dcInput','aria-label':'作品方案名称',value:label,placeholder:'方案名称',onChange:e=>setLabel(e.target.value)}),
   h('button',{className:'dcBtn dcPrimary',disabled:busy||!s.doc,onClick:()=>run(()=>sync.forkVariant(label))},'复制当前作品为方案'),
   error?h('p',{role:'alert',className:'dcHint'},error):null,
   visible.length>1?h('select',{className:'dcSelect','aria-label':'作品方案组',value:active?.id,onChange:e=>{setActiveId(e.target.value);setOffset(0);}},...visible.map(g=>h('option',{key:g.id,value:g.id},g.originalTitle+' · '+g.createdAt.slice(0,10)))):null,
   ...(active?[active]:[]).map(group=>h('section',{className:'dcCard',key:group.id,'data-variant-group':group.id},h('div',{className:'dcSectionTitle'},group.originalTitle),
    h('button',{className:'dcBtn',disabled:busy,onClick:()=>run(()=>sync.forkVariant(label,group.id))},'从原作新增方案'),
    h('button',{className:'dcBtn',onClick:()=>run(()=>sync.openDoc(group.originalDocId))},'打开原作'),
    h('button',{className:'dcBtn',onClick:()=>setExpanded(true)},'放大并排比较作品'),
    h('div',{style:expanded?{position:'fixed',inset:'5vh 4vw',zIndex:1600,background:'var(--dc-surface)',padding:24,overflow:'auto',display:'grid',gridTemplateColumns:'repeat(3,minmax(220px,1fr))',gap:12}:{display:'grid',gridTemplateColumns:'repeat(2,minmax(160px,1fr))',gap:8}},
     expanded?h('button',{className:'dcBtn',style:{position:'absolute',right:8,top:2},onClick:()=>setExpanded(false)},'关闭作品并排比较'):null,
     h('div',null,h('div',{className:'dcHint'},'当前原作'),!group.originalMissing?h('iframe',{title:'原作预览',src:sync.previewUrl(group.originalDocId,group.currentOriginalRevision),style:{width:'100%',height:expanded?'65vh':220,border:'1px solid var(--dc-line)'}}):h('p',null,'原作已不存在')),
     ...group.branches.slice(offset,offset+2).map(branch=>h('div',{key:branch.docId,'data-variant-doc':branch.docId},
      h('div',{className:'dcHint'},branch.label+(branch.modified?' · 已保存修改':' · 尚未编辑')),
      !branch.missing?h('iframe',{title:'作品方案预览 '+branch.label,src:sync.previewUrl(branch.docId,branch.revision),style:{width:'100%',height:expanded?'65vh':220,border:'1px solid var(--dc-line)'}}):h('p',null,'方案文件已不存在'),
      h('button',{className:'dcBtn',disabled:busy||branch.missing,onClick:()=>run(()=>sync.openDoc(branch.docId))},'编辑 '+branch.label),
      h('button',{className:'dcBtn dcPrimary',disabled:busy||branch.missing||!branch.modified,onClick:()=>run(()=>sync.adoptVariant(group.id,branch.docId))},'采用 '+branch.label)
     ))),
    group.branches.length>2?h('div',{className:'dcRow'},h('button',{className:'dcBtn',disabled:offset===0,onClick:()=>setOffset(Math.max(0,offset-2))},'上一组方案'),h('button',{className:'dcBtn',disabled:offset+2>=group.branches.length,onClick:()=>setOffset(offset+2)},'下一组方案')):null
   )));
 };
}
