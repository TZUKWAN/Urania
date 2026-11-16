import {selectedObjectIds} from './native-contract.js?v=163';

// Describe the real engine selection, including pixels and slide ranges.
export function aiCanvasTarget(document){
 if(!document)return '当前设计';
 const ids=Array.isArray(document.objectIds)?document.objectIds:selectedObjectIds(document);
 const native=document.nativeSelection?.data,engine=document.engine;
 if(engine==='photocraft'){
  if(native?.rasterSelection)return '图片选区'+(ids.length?' · '+ids.length+' 个图层':'');
  return ids.length?'已选 '+ids.length+' 个图层':'整张图片';
 }
 const selection=native?.selection,page=document.page;
 if(engine==='deckcraft'){
  const names={master:'幻灯片母版',layout:'版式',handout:'讲义母版',notesMaster:'备注母版'};
  const index=page?.nativePage?.index??page?.index;
  const scope=names[selection?.target?.kind]||(Number.isSafeInteger(index)?'第 '+(index+1)+' 页':'当前页');
  if(selection?.text?.notes)return scope+' · 备注';
  if(ids.length)return scope+' · 已选 '+ids.length+' 个对象';
  if(selection?.slides?.length>1)return '已选 '+selection.slides.length+' 页';
  return scope;
 }
 const scope=Number.isSafeInteger(page?.index)?'第 '+(page.index+1)+' 个画板':'当前画布';
 return ids.length?'已选 '+ids.length+' 个对象':scope;
}

export function createAiCanvasTools(React){
 const h=React.createElement;
 return function AiCanvasTools({controller,document,disabled,onError,onQuote}){
  const native=controller.state,photo=document.engine==='photocraft';
  const select=tool=>()=>controller.setAiSelectionTool(tool).catch(error=>onError(error.message));
  return h('div',{className:'dcAiCanvasTools',role:'toolbar','aria-label':'AI 画布选择'},
   h('div',{className:'dcAiCanvasTarget',role:'status','aria-live':'polite'},h('strong',null,aiCanvasTarget(document)),h('small',null,photo?'点击选择图层；Shift 加选，或框选图片区域':'点击选择；Shift 加选，也可拖框多选')),
   photo?h('div',{className:'dcAiSelectModes','aria-label':'图片选择方式'},...['objects','region'].map(tool=>h('button',{key:tool,className:'dcBtn',disabled,'aria-pressed':native.aiSelectionTool===tool,onClick:select(tool)},tool==='objects'?'选择图层':'框选区域'))):null,
   photo&&document.nativeSelection?.data?.rasterSelection?h('button',{className:'dcBtn',disabled,onClick:()=>controller.contextCommand(document,'clear-selection').catch(error=>onError(error.message))},'取消区域'):null,
   h('button',{className:'dcBtn dcPrimary',disabled,onClick:onQuote},'让 AI 修改'));
 };
}
