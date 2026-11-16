export function createLocalWorkflowPanel(React){
 const h=React.createElement;
 return function LocalWorkflowPanel({controller,onClose,onContinue}){
  const owner=React.useRef({id:controller.view.id,root:controller.view.root,epoch:controller.view.epoch}),key=React.useRef(crypto.randomUUID()),alive=React.useRef(true),lock=React.useRef(false);
  const [catalog,setCatalog]=React.useState([]),[items,setItems]=React.useState([]),[skillId,setSkillId]=React.useState(''),[bundleId,setBundleId]=React.useState(''),[file,setFile]=React.useState(''),[title,setTitle]=React.useState(''),[brief,setBrief]=React.useState(''),[outputKind,setOutputKind]=React.useState('vector'),[status,setStatus]=React.useState(null),[rule,setRule]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[htmlId,setHtmlId]=React.useState(''),[htmlRevision,setHtmlRevision]=React.useState('');
  const current=()=>{const v=controller.view,o=owner.current;if(v?.id!==o.id||v?.root!==o.root||v?.epoch!==o.epoch)throw new Error('工作区已切换，请重新打开本地工作流面板');};
  const call=async(action,data={})=>{current();const response=await fetch('/designcraft/api/v2/studio/local-workflows',{method:'POST',headers:{...controller.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action,epoch:owner.current.epoch,...data})});const result=await response.json();current();if(!response.ok||!result.ok)throw new Error(result.error||'本地工作流请求失败');return result;};
  const refresh=async()=>{const data=await call('list');if(alive.current)setItems(data.items);};
  React.useEffect(()=>{alive.current=true;Promise.all([call('catalog'),call('list')]).then(([a,b])=>{if(alive.current){setCatalog(a.items);setItems(b.items);}}).catch(e=>alive.current&&setError(e.message));return()=>{alive.current=false;};},[]);
  const run=fn=>async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){if(alive.current)setError(e.message);}finally{lock.current=false;if(alive.current)setBusy(false);}};
  const load=async id=>{const data=await call('status',{runId:id});if(alive.current){setStatus(data);setRule(null);}return data;};
  const prepare=async()=>{const data=await call('prepare',{skillId,title,brief,outputKind,operationKey:key.current,...(bundleId.trim()?{bundleId:bundleId.trim()}:{}),...(file.trim()?{file:file.trim()}:{})});if(alive.current){setStatus(data);setRule(null);}await refresh();};
  const read=async offset=>{const data=await call('read',{runId:status.workflow.id,revision:status.workflow.revision,offset,limit:20000});if(alive.current)setRule(data);};
  const attach=async(type,id,revision)=>{await call('attach',{runId:status.workflow.id,revision:status.workflow.revision,sourceType:type,sourceId:id,sourceRevision:revision});await load(status.workflow.id);await refresh();};
  const colorReport=async()=>{await controller.checkpointHostPanel();await call('publish_report',{runId:status.workflow.id,revision:status.workflow.revision,operation:'color_audit'});await load(status.workflow.id);await refresh();};
  const complete=async()=>{const data=await call('complete',{runId:status.workflow.id,revision:status.workflow.revision});if(alive.current)setStatus(data);await refresh();};
  const cancel=async()=>{await call('cancel',{runId:status.workflow.id,revision:status.workflow.revision});await load(status.workflow.id);await refresh();};
  const workflow=status?.workflow,open=workflow&&!['completed','cancelled'].includes(workflow.status);
  return h('section',{className:'dcStudioImageWorkspace',role:'region','aria-label':'OpenDesign 本地工作流'},
   h('div',{className:'dcStudioImageHeader'},h('strong',null,'OpenDesign 本地工作流'),h('span',null,'当前 DSH 会话 · 真实规则与作品版本'),h('button',{className:'dcBtn',disabled:busy,onClick:()=>{key.current=crypto.randomUUID();setStatus(null);setRule(null);}},'新工作流'),h('button',{className:'dcBtn',disabled:busy,onClick:onClose},'返回设计')),
   error?h('div',{className:'dcNativeNotice',role:'alert'},error):null,
   h('div',{style:{overflow:'auto',padding:14}},
    !workflow?h('form',{onSubmit:e=>{e.preventDefault();run(prepare)();},style:{display:'grid',gap:10,maxWidth:850}},
     h('label',null,'本地规则',h('select',{value:skillId,required:true,disabled:busy,onChange:e=>setSkillId(e.target.value)},h('option',{value:'',disabled:true},'选择真实规则入口'),...catalog.map(item=>h('option',{key:item.id,value:item.id},item.id)))),
     h('label',null,'作品名称',h('input',{className:'dcInput',value:title,required:true,maxLength:200,disabled:busy,onChange:e=>setTitle(e.target.value)})),
     h('label',null,'实际需求',h('textarea',{className:'dcInput',value:brief,required:true,maxLength:40000,disabled:busy,onChange:e=>setBrief(e.target.value)})),
     h('label',null,'输出',h('select',{value:outputKind,disabled:busy,onChange:e=>setOutputKind(e.target.value)},...Object.entries({vector:'可编辑矢量/海报',photo:'可编辑图片',deck:'可编辑演示',html:'HTML设计源',report:'分析报告'}).map(([id,label])=>h('option',{key:id,value:id},label)))),
     h('details',null,h('summary',null,'已保存原包及规则文件'),h('label',null,'原包 ID',h('input',{className:'dcInput',value:bundleId,disabled:busy,onChange:e=>setBundleId(e.target.value)})),h('label',null,'实际规则文件',h('input',{className:'dcInput',value:file,disabled:busy,onChange:e=>setFile(e.target.value)}))),
     h('p',null,'仅有目录介绍的入口需要先保留真实原包。此处建立计划与执行记录，不自动运行上游脚本或已放弃的外部平台。'),
     h('button',{className:'dcBtn dcPrimary',disabled:busy,type:'submit'},'固定规则并创建计划')
    ):h('article',null,
     h('h3',null,workflow.skillId),h('p',null,'状态：'+({awaiting_model:'等待当前DSH创作',has_artifacts:'已有真实保存产物',completed:'本地编排已结束',cancelled:'已取消编排'})[workflow.status]),h('p',null,'计划 '+workflow.planId+' / '+workflow.planRevision.slice(0,12)),
     h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>load(workflow.id))},'核对已保存状态'),h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>read(0))},'查阅实际规则'),open&&onContinue?h('button',{className:'dcBtn dcPrimary',disabled:busy,onClick:run(()=>onContinue(workflow))},'放入当前 DSH 输入框'):null),
     h('p',null,'界面查阅不会冒充模型已读取。当前DSH需通过 workflow_read 读取规则，再使用原生/HTML/图片工具生成实际作品。'),
     rule?h('div',null,h('pre',{style:{maxHeight:360,overflow:'auto',whiteSpace:'pre-wrap'}},rule.content),rule.nextOffset!==null?h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>read(rule.nextOffset))},'读取下一页'):null):null,
     open&&workflow.outputKind!=='report'?h('div',null,h('button',{className:'dcBtn',disabled:busy||!controller.view.sourceId||!controller.view.sourceRevision,onClick:run(()=>attach('native',controller.view.sourceId,controller.view.sourceRevision))},'关联当前已保存原生作品'),workflow.outputKind==='html'?h('div',null,h('input',{className:'dcInput',value:htmlId,placeholder:'已保存网页 ID',onChange:e=>setHtmlId(e.target.value)}),h('input',{className:'dcInput',value:htmlRevision,placeholder:'精确网页修订',onChange:e=>setHtmlRevision(e.target.value)}),h('button',{className:'dcBtn',disabled:busy||!htmlId||!htmlRevision,onClick:run(()=>attach('html',htmlId,htmlRevision))},'关联指定网页版本')):null):null,
     open&&workflow.outputKind==='report'?h('button',{className:'dcBtn',disabled:busy,onClick:run(colorReport)},'生成当前文档的实际颜色检查报告'):null,
     ...workflow.artifacts.map((item,i)=>h('p',{key:i},'产物：'+(item.sourceId||item.assetName)+' / '+item.sourceHash.slice(0,16))),
     h('p',null,'关联记录核对实际源字节；不证明视觉效果或模型已遵循全部规则。'),
     open?h('div',null,h('button',{className:'dcBtn',disabled:busy||!status.rulesDelivered||!status.eligibleArtifactCount,onClick:run(complete)},'完成本地编排'),h('button',{className:'dcBtn',disabled:busy,onClick:run(cancel)},'结束并保留原件')):null
    ),
    h('hr'),h('h4',null,'本项目工作流'),...items.map(item=>h('button',{key:item.id,className:'dcBtn',disabled:busy,onClick:run(()=>load(item.id)),style:{display:'block',marginBottom:6}},item.skillId+' · '+item.status+' · '+item.artifacts+' 份产物'))
   ));
 };
}
