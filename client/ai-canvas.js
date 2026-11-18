import {selectedObjectIds} from './native-contract.js?v=167';
import {createStudioComponents} from './studio-system.js?v=167';

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
 const {Icon,Button}=createStudioComponents(React);
 return function AiCanvasTools({controller,document,disabled,onError,onQuote,onAdvanced,onPhoto}){
  const native=controller.state,photo=document.engine==='photocraft';
  const select=tool=>()=>controller.setAiSelectionTool(tool).catch(error=>onError(error.message));
  return h('div',{className:'dcAiCanvasTools',role:'toolbar','aria-label':'AI 画布选择'},
   h('div',{className:'dcAiCanvasTarget',role:'status','aria-live':'polite'},
    h('span',{className:'dcStudioTarget'},h(Icon,{name:photo?'photo':document.engine==='deckcraft'?'deck':'vector',size:13}),h('span',null,aiCanvasTarget(document)))),
   photo?h('div',{className:'dcAiSelectModes','aria-label':'图片选择方式'},...['objects','region'].map(tool=>h('button',{key:tool,className:'dcBtn',disabled,'aria-pressed':native.aiSelectionTool===tool,onClick:select(tool)},tool==='objects'?'选择图层':'框选区域'))):null,
   photo&&document.nativeSelection?.data?.rasterSelection?h('button',{className:'dcBtn',disabled,onClick:()=>controller.contextCommand(document,'clear-selection').catch(error=>onError(error.message))},'取消区域'):null,
   photo?h(Button,{icon:'photo',label:'图片生成与局部重绘',disabled,onClick:onPhoto}):null,
   h(Button,{icon:'settings','aria-pressed':!!native.advancedEditing,disabled,onClick:onAdvanced},native.advancedEditing?'返回简洁画布':'专业编辑'),
   h(Button,{icon:'ai',className:'dcPrimary',disabled,onClick:onQuote},'让 AI 修改'));
 };
}
