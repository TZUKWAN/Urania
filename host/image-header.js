import {assertImageSize,SafetyError} from './safety.js';
// Header admission runs before any browser image decode. Full decoding remains the native engine's job.
export function previewImageSize(buffer){
 let width,height;
 if(buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  if(buffer.toString('ascii',12,16)!=='IHDR')throw new SafetyError('PNG 主头无效',415);width=buffer.readUInt32BE(16);height=buffer.readUInt32BE(20);
 }else if(buffer.length>=4&&buffer[0]===255&&buffer[1]===216){
  for(let position=2;position+4<=buffer.length;){
   if(buffer[position]!==255)throw new SafetyError('JPEG 标记无效',415);while(buffer[position+1]===255)position++;
   const marker=buffer[position+1];position+=2;if(marker===217||marker===218)break;if(marker===216||marker===1||marker>=208&&marker<=215)continue;
   if(position+2>buffer.length)throw new SafetyError('JPEG 段头截断',415);const length=buffer.readUInt16BE(position);if(length<2||position+length>buffer.length)throw new SafetyError('JPEG 段长度无效',415);
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)throw new SafetyError('JPEG 帧头截断',415);height=buffer.readUInt16BE(position+3);width=buffer.readUInt16BE(position+5);break;}
   position+=length;
  }
 }else throw new SafetyError('此源格式请先通过原生图像/矢量导入生成预览；原文件仍可下载',415);
 assertImageSize(width,height);return {width,height};
}
