import {createStudioComponents,studioEngines} from './studio-system.js?v=169';
import {selectedObjectIds} from './native-contract.js?v=169';
import {uint64Parameter} from './native-protocol.js?v=169';

export function createStudioPanels(React) {
  const h=React.createElement;
  const {Icon,Button}=createStudioComponents(React);

  function Home({engines,disabled,onEngine,onImport,onWorks,onFocusChat}) {
    const options=studioEngines.filter(engine=>engine.id==='motion'||engines?.[engine.id]);
    return h('div',{className:'dcNativeEmpty'},h('div',{className:'dcStudioHome'},
      h('div',{className:'dcStudioHomeHero'},
        h('div',null,h('h1',null,'你想创作什么？'),
         h('p',null,'从一句话到可编辑的作品。'),
         h(Button,{icon:'ai',className:'dcPrimary',onClick:onFocusChat},'与 AI 开始')),
        h('svg',{className:'dcStudioOrbit',viewBox:'0 0 100 100',fill:'none',stroke:'currentColor','aria-hidden':true},
          h('circle',{cx:50,cy:50,r:26,opacity:.42}),
          h('ellipse',{cx:50,cy:50,rx:47,ry:19,transform:'rotate(-36 50 50)',opacity:.78}),
          h('circle',{cx:31,cy:69,r:4,fill:'currentColor',stroke:'none'}),
          h('path',{d:'M69 22v22m-11-11h22m-18 7 14-14m-14 0 14 14',strokeWidth:1.45}),
          h('path',{d:'M44 49a9 9 0 1 0 12 12 12 12 0 0 1-12-12Z',fill:'currentColor',stroke:'none',opacity:.7}))),
      h('div',{className:'dcStudioCreateGrid'},...options.map(engine=>h('button',{
        key:engine.id,className:'dcStudioStart',disabled,onClick:()=>onEngine(engine.id),
      },h('span',{className:'dcStudioEngineIcon','data-engine':engine.id},h(Icon,{name:engine.icon,size:19})),
      h('span',null,h('strong',null,engine.title),h('small',null,engine.detail)),h(Icon,{name:'arrow',size:15})))),
      h('div',{className:'dcStudioHomeLinks'},
        h(Button,{icon:'upload',disabled,onClick:onImport},'导入设计'),
        h(Button,{icon:'history',disabled,onClick:onWorks},'最近作品'))));
  }

  function PanelHeading({title,detail,onClose,icon}) {
    return h('div',{className:'dcStudioDialogHeading'},
      icon?h(Icon,{name:icon}):null,h('strong',null,title),detail?h('small',null,detail):null,
      onClose?h(Button,{icon:'close',label:'关闭面板',onClick:onClose}):null);
  }
  function CanvasViewControls({document,controller,disabled,onError}) {
    const fit={vectorcraft:'view.fitArtboard',photocraft:'view.fitOnScreen',deckcraft:'view.fit'}[document.engine];
    if(!fit)return null;
    const run=command=>()=>controller.manualViewCommand(document,command).catch(onError);
    return h('div',{className:'dcStudioViewportControls',role:'toolbar','aria-label':'画布缩放'},
      h(Button,{icon:'subtract',label:'缩小画布',disabled,onClick:run('view.zoomOut')}),
      h(Button,{icon:'focus',label:'适应画布',disabled,onClick:run(fit)}),
      h(Button,{icon:'plus',label:'放大画布',disabled,onClick:run('view.zoomIn')}));
  }

  function Inspector({document,controller,disabled,onClose,onError,ContextTools,onQuote,onImage}) {
    const selected=selectedObjectIds(document);
    const objects=flattenLayers(document.layers);
    const node=selected.length===1?objects.find(item=>String(item.id)===String(selected[0])):null;
    const frame=nativeBounds(node);
    const deck=document.engine==='deckcraft';
    const photo=document.engine==='photocraft';
    const viewCommand=(command,params)=>()=>controller.manualViewCommand(document,command,params).catch(onError);
    const select=node=>viewCommand(photo?'layer.select':deck?'edit.select':'select.set',photo?{layer:uint64Parameter(node.id)}:{ids:[uint64Parameter(node.id)]});
    return h('aside',{className:'dcStudioInspect','aria-label':'对象属性'},h(PanelHeading,{title:'属性',onClose,icon:'settings'}),
      h('div',{className:'dcStudioInspectTitle'},node?.name||node?.textPreview|| (selected.length>1?'已选 '+selected.length+' 个对象':deck?'当前幻灯片':photo?'整张图片':'当前画板')),
      h('details',{open:true},h('summary',null,frame?'位置与尺寸':'画面尺寸'),
        h('div',{className:'dcStudioMetrics'},...(frame?Object.entries(frame):[['宽',document.width],['高',document.height]])
          .filter(([,value])=>Number.isFinite(value)).map(([label,value])=>h('span',{key:label},label+' '+Number(value.toFixed(1)))))),
      selected.length||document.nativeSelection?.data?.rasterSelection?h('details',{open:true},h('summary',null,photo?'调整与蒙版':'样式与排列'),
        h(ContextTools,{key:selected.map(String).join(','),controller,document,disabled,onError:error=>onError(new Error(error)),onQuote,onImage})):null,
      deck&&document.slides?.length?h('details',null,h('summary',null,'幻灯片 · '+document.slides.length),
        h('div',{className:'dcStudioLayers'},...document.slides.slice(0,80).map(slide=>h('button',{key:String(slide.id),className:'dcNativeMenuItem',disabled,
          'data-current':document.page?.nativePage?.index===slide.index,onClick:viewCommand('slide.go',{id:uint64Parameter(slide.id)})},(slide.index+1)+'  '+(slide.title||'未命名幻灯片'))))):null,
      objects.length?h('details',{open:!deck},h('summary',null,(photo?'图层':'对象')+' · '+objects.length),
        h('div',{className:'dcStudioLayers'},...objects.slice(0,80).map(item=>h('button',{key:String(item.id),className:'dcNativeMenuItem',disabled,
          'data-current':selected.some(id=>String(id)===String(item.id)),onClick:select(item)},h('span',null,item.name||item.textPreview||'未命名对象'))))):null);
  }
  return {Home,PanelHeading,Inspector,CanvasViewControls};
}

export function nativeBounds(node) {
  const bounds=node?.bounds||node?.localTransform;
  if (Array.isArray(bounds)&&bounds.length===4) {
    return {X:bounds[0],Y:bounds[1],宽:bounds[2]-bounds[0],高:bounds[3]-bounds[1]};
  }
  if (!bounds) return null;
  return {X:bounds.x,Y:bounds.y,宽:bounds.width??bounds.w,高:bounds.height??bounds.h};
}

function flattenLayers(items = []) {
  const result=[];
  for(const item of items){
    result.push(item);
    if(item.children?.length)result.push(...flattenLayers(item.children));
  }
  return result;
}
