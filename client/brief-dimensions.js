/** Explicit design-brief options; these controls do not interpret the brief. */
const FIELDS=[
 {key:'palette',label:'配色',options:[['navy_and_white','海军蓝与白色'],['earth_tones','大地色'],['monochrome_dark','深色单色'],['light_clean','浅色简洁']]},
 {key:'accent',label:'强调色',options:[['coral','珊瑚橙'],['electric_blue','亮蓝'],['emerald','翡翠绿'],['muted_sage','柔和鼠尾草绿'],['slate','石板灰']]},
 {key:'typography',label:'正文字体',options:[['inter','Inter'],['system_ui','系统字体'],['dm_sans','DM Sans'],['georgia','Georgia']]},
 {key:'display',label:'标题字体',options:[['space_grotesk','Space Grotesk'],['clash_display','Clash Display'],['same_as_body','与正文相同'],['playfair','Playfair Display']]},
 {key:'layout',label:'布局',options:[['single_column','单列'],['two_column','双列'],['asymmetric','非对称']]},
 {key:'mood',label:'风格',options:[['professional_minimal','专业简约'],['playful','活泼'],['brutalist','粗野'],['editorial','杂志编辑风']]},
 {key:'density',label:'内容密度',options:[['compact','紧凑'],['balanced','均衡'],['spacious','宽松']]},
];
const EXCLUSIONS=[['animations','动画'],['gradients','渐变'],['stock_photos','图库照片'],['carousel','轮播']];
const byKey=new Map(FIELDS.map(field=>[field.key,field]));
const exclusionValues=new Set(EXCLUSIONS.map(([value])=>value));

function readDimensions(raw){
 if(raw!==undefined&&(typeof raw!=='string'||raw.length>16000))throw new Error('维度 JSON 超出预算或格式无效');
 let object;try{object=JSON.parse(raw||'{}');}catch{throw new Error('维度 JSON 尚未写完整');}
 if(!object||typeof object!=='object'||Array.isArray(object))throw new Error('维度 JSON 必须是对象');
 const values={};
 for(const [key,value]of Object.entries(object)){
  if(key==='exclude'){
   const items=Array.isArray(value)?value:typeof value==='string'?value.split(','):null;
   if(!items||items.length>8||items.some(item=>typeof item!=='string'))throw new Error('排除项格式无效');
   const clean=items.map(item=>item.trim().toLowerCase()).filter(Boolean);
   if(clean.length===1&&clean[0]==='none'){values.exclude=[];continue;}
   if(new Set(clean).size!==clean.length||clean.some(item=>!exclusionValues.has(item)))throw new Error('排除项包含未知或重复值');
   values.exclude=clean;continue;
  }
  const field=byKey.get(key),clean=typeof value==='string'?value.trim().toLowerCase():null;
  if(!field||!field.options.some(([option])=>option===clean))throw new Error('维度 JSON 包含未知字段或选项');
  values[key]=clean;
 }
 return {object,values};
}

/** Read the latest draft again when an event occurs so another field is preserved. */
export function updateBriefDimension(raw,key,change){
 const {object,values}=readDimensions(raw),next=Object.assign(Object.create(null),object);
 if(key==='exclude'){
  if(change?.kind==='auto')delete next.exclude;
  else if(change?.kind==='none')next.exclude=[];
  else if(change?.kind==='toggle'&&exclusionValues.has(change.value)&&typeof change.checked==='boolean'){
   const selected=new Set(values.exclude||[]);
   if(change.checked)selected.add(change.value);else selected.delete(change.value);
   next.exclude=EXCLUSIONS.map(([value])=>value).filter(value=>selected.has(value));
  }else throw new Error('排除项操作无效');
 }else{
  const field=byKey.get(key);
  if(!field||change?.kind!=='set'||typeof change.value!=='string')throw new Error('简报维度操作无效');
  if(!change.value)delete next[key];
  else if(field.options.some(([option])=>option===change.value))next[key]=change.value;
  else throw new Error('简报维度选项无效');
 }
 return JSON.stringify(next,null,2);
}

export function createBriefDimensionControls(React){
 const h=React.createElement;
 return function BriefDimensionControls({raw,onChange,disabled}){
  let data,problem;try{data=readDimensions(raw);}catch(error){problem=error.message;data={values:{}};}
  const values=data.values,locked=!!disabled||!!problem,hasExclusions=Object.hasOwn(values,'exclude');
  return h('div',{className:'dcBriefDimensions'},
   h('div',{className:'dcBrandControls'},...FIELDS.map(field=>h('label',{key:field.key},field.label,
    h('select',{'aria-label':'简报'+field.label,value:values[field.key]||'',disabled:locked,onChange:event=>onChange(field.key,{kind:'set',value:event.target.value})},
     h('option',{value:''},'按简报和默认规则'),...field.options.map(([value,label])=>h('option',{key:value,value},label)))))),
   h('fieldset',{disabled:locked},h('legend',null,'排除项'),
    h('small',null,(hasExclusions?(values.exclude.length?'已明确选择排除项':'已明确选择不排除这些项目'):'未明确指定，按简报和默认规则处理')+'；明确选择会覆盖简报中的排除项推断。'),
    h('div',{className:'dcBrandControls'},...EXCLUSIONS.map(([value,label])=>h('label',{key:value},
     h('input',{type:'checkbox',checked:(values.exclude||[]).includes(value),onChange:event=>onChange('exclude',{kind:'toggle',value,checked:event.target.checked})}),label)),
     h('button',{type:'button',className:'dcBtn',onClick:()=>onChange('exclude',{kind:'none'})},'明确不排除'),
     h('button',{type:'button',className:'dcBtn',onClick:()=>onChange('exclude',{kind:'auto'})},'按简报和默认规则'))),
   problem?h('p',{role:'status'},problem+'；请先修正下方高级 JSON，原文仍保留。'):null);
 };
}
