/** Explicit Chinese vocabulary, evidence spans and negation; no model or network. */
import {SafetyError} from './safety.js';
const RULES=[
 ['palette','navy_and_white',/海军蓝(?:与|和|配|加)?白|藏蓝(?:与|和|配|加)?白|深蓝(?:与|和|配|加)?白/g],
 ['palette','earth_tones',/大地色(?:系)?|暖色调|泥土色|自然暖色/g],
 ['palette','monochrome_dark',/暗色(?:模式|主题|背景)?|深色(?:模式|主题|背景)|黑色背景|黑底|暗黑风/g],
 ['palette','light_clean',/浅色(?:模式|主题|背景)?|白色背景|白底|明亮背景/g],
 ['accent','coral',/珊瑚(?:色|橙)?|橙色强调|橙色点缀/g],
 ['accent','electric_blue',/电光蓝|亮蓝(?:色)?|蓝色(?:强调|点缀|重点)/g],
 ['accent','emerald',/祖母绿|翡翠绿|绿色(?:强调|点缀|重点)/g],
 ['accent','muted_sage',/鼠尾草绿|灰绿(?:色)?|柔和绿色/g],
 ['accent','slate',/石板灰|灰色(?:强调|点缀|重点)/g],
 ['typography','inter',/\bInter\b/gi],['typography','system_ui',/系统字体|系统默认字(?:体)?/g],
 ['typography','dm_sans',/\bDM\s*Sans\b/gi],['typography','georgia',/衬线正文|正文(?:用|使用)?衬线|传统衬线体|\bGeorgia\b/gi],
 ['display','space_grotesk',/\bSpace\s*Grotesk\b/gi],['display','clash_display',/\bClash\s*Display\b/gi],
 ['display','playfair',/\bPlayfair(?:\s*Display)?\b/gi],['display','same_as_body',/标题(?:与|和|跟)正文(?:相同|一致)|标题正文同字体/g],
 ['layout','single_column',/单栏|单列(?:布局|排版)?|一栏布局/g],['layout','two_column',/双栏|两栏|双列布局|侧边栏布局/g],
 ['layout','asymmetric',/非对称(?:布局|排版)?|不对称(?:布局|排版)?/g],
 ['mood','professional_minimal',/简约|极简|简洁|专业(?:商务)?风|商务风|干净利落/g],
 ['mood','playful',/活泼|俏皮|趣味|童趣|亲切友好/g],['mood','brutalist',/粗野主义|野兽派|粗犷|原始粗粝/g],
 ['mood','editorial',/编辑风|杂志风|报刊风|杂志式/g],
 ['density','compact',/紧凑|高(?:信息)?密度|信息密集|密集排版/g],['density','balanced',/均衡(?:密度|排版)|适中(?:密度|留白)|疏密适中/g],
 ['density','spacious',/宽松|大(?:量|面积)留白|留白(?:多|充足|丰富)|低(?:信息)?密度/g]
];
const EXCLUDE=[['animations',/动画|动效/g],['gradients',/渐变/g],['stock_photos',/图库照片|库存照片|素材照片/g],['carousel',/轮播(?:图)?/g]];
const add=(record,key,value)=>{record[key]||=[];if(!record[key].includes(value))record[key].push(value);};
function prefix(text,index){return text.slice(Math.max(0,index-24),index).split(/[，。；;！!?？\n]/).at(-1)||'';}
const negative=before=>{const match=/(?:不要|不需要|无需|不想要|不希望|不能|不可|避免|禁止|别|去掉|排除|不采用|不使用|不用|不做|不含|没有)([^，。；;！!?？\n]{0,18})$/.exec(before);return !!match&&!/(?:但是|而是|改为|改用|同时要|但要|需要|想要|保留|允许)/.test(match[1]);};
export function inferChineseBrief(text,explicitKeys=[]){
 if(typeof text!=='string'||text.length>40000)throw new SafetyError('简报文本超过解析预算',413);
 const candidates={},forbidden={},matches=[],warnings=[];
 for(const [key,value,pattern]of RULES){
  pattern.lastIndex=0;for(const match of text.matchAll(pattern)){
   if(matches.length>=256)throw new SafetyError('简报包含过多设计维度，请精简或明确填写选项',413);
   const negated=negative(prefix(text,match.index));add(negated?forbidden:candidates,key,value);matches.push({key,value,start:match.index,end:match.index+match[0].length,text:match[0],negated});
  }
 }
 const excluded=[],included=[];
 for(const [value,pattern]of EXCLUDE){pattern.lastIndex=0;for(const match of text.matchAll(pattern)){
  const before=prefix(text,match.index),negated=negative(before),affirmative=/(?:保留|允许|需要|要有|使用|采用|加入|添加)(?:一些|适量|少量|的|\s){0,3}$/.test(before);
  if(!negated&&!affirmative)continue;
  if(matches.length>=256)throw new SafetyError('简报包含过多约束，请精简',413);
  const target=negated?excluded:included;if(!target.includes(value))target.push(value);matches.push({key:'exclude',value,start:match.index,end:match.index+match[0].length,text:match[0],negated});
 }}
 const dimensions={};for(const [key,values]of Object.entries(candidates)){
  const conflict=values.some(value=>forbidden[key]?.includes(value))||values.length>1;
  if(conflict&&explicitKeys.includes(key)){warnings.push(key+' 的中文表达有歧义，采用您明确选择的维度。');continue;}
  if(values.some(value=>forbidden[key]?.includes(value)))throw new SafetyError('简报同时要求并排除了 '+key+'，请明确选择',422);
  if(values.length>1)throw new SafetyError('简报中 '+key+' 存在多个中文候选：'+values.join('、')+'，请明确选择',422);dimensions[key]=values[0];
 }
 if(excluded.some(value=>included.includes(value))&&!explicitKeys.includes('exclude'))throw new SafetyError('简报同时要求保留和去掉相同效果，请明确排除项',422);
 if(excluded.length)dimensions.exclude=excluded;
 if(included.length)forbidden.exclude=included;
 if(/不要|避免|禁止|无需|别用|不需要/.test(text)&&!matches.some(match=>match.negated))warnings.push('简报含未匹配到支持词汇的否定约束；请在明确维度或排除项中补充。');
 return {dimensions,forbidden,matches,warnings};
}
