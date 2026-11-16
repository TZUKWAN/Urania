/** WCAG 2 contrast for two explicitly supplied opaque sRGB colors. */
import {SafetyError} from './safety.js';
import Color from './vendor/colorjs/src/index.js';

const normalize=value=>{
 if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new SafetyError('颜色须为不透明的六位 sRGB 十六进制，例如 #123456',422);
 return value.toUpperCase();
};
const luminance=hex=>{
 const linear=offset=>{const channel=parseInt(hex.slice(offset,offset+2),16)/255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4;};
 return 0.2126*linear(1)+0.7152*linear(3)+0.0722*linear(5);
};
export function colorContrast(foreground,background){
 const fg=normalize(foreground),bg=normalize(background),fgLuminance=luminance(fg),bgLuminance=luminance(bg);
 const ratio=(Math.max(fgLuminance,bgLuminance)+0.05)/(Math.min(fgLuminance,bgLuminance)+0.05);
 const apca=new Color(bg).contrastAPCA(new Color(fg));
 return {foreground:fg,background:bg,ratio,thresholds:{aaNormalText:ratio>=4.5,aaLargeText:ratio>=3,aaaNormalText:ratio>=7,aaaLargeText:ratio>=4.5},apca:{lc:apca,polarity:apca>0?'dark_on_light':apca<0?'light_on_dark':'no_contrast',algorithm:'APCA 0.0.98G',normative:false},oklch:{foreground:convertColor(fg,'oklch'),background:convertColor(bg,'oklch')},method:'WCAG 2.2 contrast ratio for opaque sRGB',note:'APCA为带极性的实验性指标；颜色数值不等同整份作品或WCAG 3合规。'};
}
export function convertColor(value,space='oklch'){
 if(typeof value!=='string'||value.length>200||!['oklch','oklab','srgb','srgb-linear','display-p3'].includes(space))throw new SafetyError('颜色或目标空间无效',422);
 try{const color=new Color(value),converted=color.to(space==='display-p3'?'p3':space),alpha=Number(converted.alpha),coords=converted.coords.map(v=>v===null||Number.isNaN(Number(v))?null:Number(v));if(!Number.isFinite(alpha)||alpha<0||alpha>1||coords.some(v=>v!==null&&!Number.isFinite(v)))throw new Error();return {space,coords,alpha,css:converted.toString({precision:6}),inSrgbGamut:color.inGamut('srgb')};}catch{throw new SafetyError('无法解析该CSS颜色，请使用有效的HEX、rgb、oklch等颜色',422);}
}
export function opaqueColor(value){
 try{if(typeof value!=='string'||value.length>200)return null;const color=new Color(value);if(Number(color.alpha)!==1||!color.inGamut('srgb'))return null;const rgb=color.to('srgb').coords.map(Number);if(rgb.some(n=>!Number.isFinite(n)))return null;return '#'+rgb.map(n=>Math.round(Math.max(0,Math.min(1,n))*255).toString(16).padStart(2,'0')).join('').toUpperCase();}catch{return null;}
}
