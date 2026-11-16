import {selectedObjectIds} from './native-contract.js?v=163';

function find(nodes,id){
 for(const node of nodes||[]){if(String(node.id)===String(id))return node;const nested=find(node.children,id);if(nested)return nested;}
 return null;
}

export function createNativeContextTools(React){
 const h=React.createElement;
 return function NativeContextTools({controller,document,disabled,onError,onQuote,onImage}){
  const [opacity,setOpacity]=React.useState('100');
  const [font,setFont]=React.useState('');
  if(!document)return null;
  const ids=selectedObjectIds(document),engine=document.engine,selected=ids.length===1?find(document.layers,ids[0]):null;
  const kind=String(selected?.kind?.type||selected?.kind||'').toLowerCase(),isPicture=/image|picture|raster|bitmap/.test(kind),isText=/text|type/.test(kind)||selected?.textPreview!=null||selected?.text!=null;
  const label=ids.length>1?'已选择 '+ids.length+' 个对象':ids.length===1?(isText?'文字':isPicture?'图片':kind.includes('path')?'路径':engine==='photocraft'?'图层':'对象'):(document.nativeSelection?.data?.rasterSelection?'图片选区':'');
  if(!label)return null;
  const run=(command,value)=>()=>controller.contextCommand(document,command,value).catch(error=>onError(error.message));
  const btn=(title,command,value)=>h('button',{key:title,className:'dcBtn',disabled,onClick:run(command,value)},title);
  const elements=[h('strong',{key:'label'},label),h('button',{key:'quote',className:'dcBtn',disabled,onClick:onQuote},'引用')];
  if(engine==='photocraft'){
   if(document.nativeSelection?.data?.rasterSelection)elements.push(btn('取消选区','clear-selection'),h('button',{key:'image',className:'dcBtn',disabled,onClick:onImage},'重绘选区'));
   if(ids.length===1){
    if(selected?.hasMask===false)elements.push(btn('添加图层蒙版','photo-mask'));
    elements.push(h('button',{key:'hue',className:'dcBtn',disabled,title:'新建原生色相/饱和度调整层，作用于下方图层',onClick:run('photo-hue-adjustment')},'添加色相调整层'));
    elements.push(h('label',{key:'opacity'},'不透明度 ',h('input',{type:'number',min:0,max:100,value:opacity,onChange:event=>setOpacity(event.target.value),'aria-label':'图层不透明度',disabled}),h('button',{className:'dcBtn',disabled,onClick:run('photo-opacity',Math.min(100,Math.max(0,Number(opacity)))/100)},'应用')));
   }
  }else{
   if(ids.length===1&&!isPicture)elements.push(h('label',{key:'fill'},'填充 ',h('input',{type:'color','aria-label':'设置所选对象填充',disabled,onChange:event=>run('fill',event.target.value)()})));
  }
  if(ids.length>=2)elements.push(...[['左对齐','left'],['水平居中','center'],['右对齐','right'],['顶部对齐','top'],['垂直居中','middle'],['底部对齐','bottom']].map(([title,command])=>btn(title,command)),btn('编组','group'));
  if(ids.length>=3)elements.push(btn('水平等距','distribute-h'),btn('垂直等距','distribute-v'));
  if(ids.length===1&&/group/.test(kind))elements.push(btn('取消编组','ungroup'));
  if(ids.length===1&&isText)elements.push(h('label',{key:'font'},'字体 ',h('input',{value:font,placeholder:'字体名称','aria-label':'所选文字字体',disabled,onChange:event=>setFont(event.target.value)}),h('button',{className:'dcBtn',disabled:disabled||!font.trim(),onClick:run('font',font)},'应用字体'),engine==='deckcraft'&&controller.surface?.capabilities?.fontLatinEastAsian?h('button',{className:'dcBtn',disabled:disabled||!font.trim(),onClick:run('font-latin-ea',font)},'统一中西文字体'):null));
  return h('div',{className:'dcNativeContextTools',role:'toolbar','aria-label':'所选对象工具'},...elements);
 };
}
