/** Read a real, pinned OpenDesign design system as data; never execute its code. */
import {createHash} from 'node:crypto';
import {assertSafeJson,SafetyError} from './safety.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const simpleId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
// CSS Color 4: OKLCH -> OKLab -> D65 XYZ -> linear sRGB. Refuse out-of-gamut
// values rather than silently clipping or pretending that gamut mapping ran.
// https://www.w3.org/TR/css-color-4/#color-conversion-code
function oklch(value){
 const match=/^oklch\(\s*([+-]?(?:\d+\.?\d*|\.\d+)%?)\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))(?:deg)?\s*\)$/i.exec(value);
 if(!match)return null;
 const l=Number(match[1].replace('%',''))/(match[1].endsWith('%')?100:1),c=Number(match[2]),h=Number(match[3])*Math.PI/180;
 if(!Number.isFinite(l)||!Number.isFinite(c)||!Number.isFinite(h)||l<0||l>1||c<0||c>0.4)return null;
 const a=c*Math.cos(h),b=c*Math.sin(h),u=(l+0.3963377773761749*a+0.2158037573099136*b)**3,
  v=(l-0.1055613458156586*a-0.0638541728258133*b)**3,w=(l-0.0894841775298119*a-1.2914855480194092*b)**3;
 const x=1.2268798758459243*u-0.5578149944602171*v+0.2813910456659647*w,
  y=-0.0405757452148008*u+1.1122868032803170*v-0.0717110580655164*w,
  z=-0.0763729366746601*u-0.4214933324022432*v+1.5869240198367816*w;
 const linear=[12831/3959*x-329/214*y-1974/3959*z,-851781/878810*x+1648619/878810*y+36519/878810*z,705/12673*x-2585/12673*y+705/667*z];
 if(linear.some(n=>!Number.isFinite(n)||n < -1e-7||n > 1+1e-7))return null;
 return '#'+linear.map(n=>{const value=Math.min(1,Math.max(0,n)),srgb=value<=0.0031308?12.92*value:1.055*value**(1/2.4)-0.055;return Math.round(srgb*255).toString(16).padStart(2,'0');}).join('').toUpperCase();
}
const color=value=>{
 if(typeof value!=='string')return null;
 const text=value.trim();
 if(/^#[a-f0-9]{6}$/i.test(text))return text.toUpperCase();
 if(/^#[a-f0-9]{3}$/i.test(text))return '#'+[...text.slice(1)].map(c=>c+c).join('').toUpperCase();
 if(/^oklch\(/i.test(text))return oklch(text);
 return null;
};
function family(value){
 if(typeof value!=='string'||value.length>1000)return null;
 const match=/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(value);
 const result=(match?.[1]||match?.[2]||match?.[3]||'').trim();
 return result&&result.length<=200&&!/[\x00-\x1f]/.test(result)?result:null;
}
export async function readOpenDesignStyle(library,id,signal,{sourceFiles}={}){
 if(!library||!simpleId(id))throw new SafetyError('设计系统身份无效',422);
 const index=library.index(),pack=index.packages.get('design-systems/'+id);
 if(!pack||pack.kind!=='design-system')throw new SafetyError('设计系统不在固定资源清单中',404);
 const entryFor=file=>{
  const entry=pack.fileMap.get(file);
  if(!entry||entry.mode==='120000'||entry.bytes<1||entry.bytes>1024*1024)throw new SafetyError('设计系统缺少可读取的清单或令牌文件',422);
  return {file,entry};
 };
 const read=async ({file,entry})=>{
  const stored=sourceFiles?.get(file),bytes=stored===undefined?await library.fetchFile(pack.id+'/'+file,entry,signal):library.verify(stored,entry);signal?.throwIfAborted();
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SafetyError('设计系统原件不是有效 UTF-8',422);}
  return {file,bytes,text,gitSha1:entry.gitSha1,sha256:sha(bytes)};
 };
 const manifestRecord=await read(entryFor('manifest.json'));let manifest;
 try{manifest=JSON.parse(manifestRecord.text);assertSafeJson(manifest);}catch{throw new SafetyError('设计系统清单不是有效 JSON',422);}
 if(!manifest||typeof manifest.name!=='string'||!manifest.name.trim()||manifest.name.length>200)throw new SafetyError('设计系统清单结构无效',422);
 const tokenFile=pack.fileMap.has('design-tokens.json')?'design-tokens.json':manifest.files?.tokens;
 if(!['design-tokens.json','tokens.css'].includes(tokenFile))throw new SafetyError('此设计系统没有受支持的令牌文件',422);
 const tokenRecord=await read(entryFor(tokenFile)),records=[manifestRecord,tokenRecord],found=new Map();
 if(tokenFile==='design-tokens.json'){
  let tokens;try{tokens=JSON.parse(tokenRecord.text);assertSafeJson(tokens);}catch{throw new SafetyError('设计系统令牌不是有效 JSON',422);}
  if(!Array.isArray(tokens?.tokens)||tokens.tokens.length>5000)throw new SafetyError('设计系统令牌结构无效',422);
  for(const item of tokens.tokens){
   if(!item||typeof item.name!=='string'||item.name.length>200||found.has(item.name))throw new SafetyError('设计系统令牌身份无效或重复',422);
   found.set(item.name,item.value);
  }
 }else{
  // Only the unambiguous default :root is read; dark/theme overrides remain
  // in the retained CSS and are not silently treated as the default.
  const css=tokenRecord.text.replace(/\/\*[\s\S]*?\*\//g,''),roots=[...css.matchAll(/(?:^|})\s*:root\s*\{([^{}]*)\}/g)];
  if(roots.length!==1)throw new SafetyError('CSS 缺少唯一默认 :root 令牌，不能自动选择主色',422);
  for(const declaration of roots[0][1].split(';')){
   const match=/^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]*?)\s*$/i.exec(declaration);if(!match)continue;
   if(found.has(match[1]))throw new SafetyError('CSS 默认令牌重复，不能自动选择主色',422);
   found.set(match[1],match[2]);
  }
 }
 const originalPrimary=found.get('--accent'),primary=color(originalPrimary);if(!primary)throw new SafetyError('此设计系统主色不能安全转换为不透明 sRGB',422);
 const converted=typeof originalPrimary==='string'&&/^\s*oklch\(/i.test(originalPrimary);
 return {id,name:manifest.name.trim(),primary,primaryOriginal:originalPrimary,tokenFile,font:family(found.get('--font-body')),repository:index.repository,revision:index.revision,
  files:records.map(({file,gitSha1,sha256,bytes})=>({file,gitSha1,sha256,bytes:bytes.length,source:library.source(pack.id+'/'+file)})),
  warning:(converted?'默认主色由 OKLCH 转换并取整为 sRGB；':'')+(tokenFile==='tokens.css'?'只读取 CSS 默认 :root，其他主题保留在原件中；':'')+'字体文件和外部服务需在目标环境另行提供。'};
}
