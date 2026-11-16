/** Read the complete saved native model, never the bounded live UI summary. */
import {gunzipSync} from 'node:zlib';
import {NativeSourceStore} from './native-source-store.js';
import {readZip} from './zip.js';
import {decodeNativeJson,sameUint64} from '../client/native-protocol.js';
import {auditDocumentColors} from './document-color-audit.js';
import {SafetyError,assertSafeJson} from './safety.js';
const MAX=32*1024*1024;
export async function auditSavedNativeColors(view,{background}={}){
 if(!view?.root||!view.sourceId||!view.sourceRevision||!view.document||!sameUint64(view.savedEngineRevision,view.document.revision))throw new SafetyError('请先保存当前原生作品，再检查完整源文件颜色',409);
 const identity={root:view.root,id:view.sourceId,revision:view.sourceRevision,epoch:view.epoch,engine:view.engine,engineRevision:view.document.revision},saved=await new NativeSourceStore(identity.root).read(identity.id,identity.revision);
 if(saved.meta.engine!==identity.engine)throw new SafetyError('颜色检查的原生源类型不一致',409);
 let raw=saved.bytes,model;
 try{
  if(identity.engine==='vectorcraft'){
   if(raw[0]===31&&raw[1]===139)raw=gunzipSync(raw,{maxOutputLength:64*1024*1024});
   const end=raw.indexOf(Buffer.from('\n\0VCBLOBS\0'));if(end>=0)raw=raw.subarray(0,end);
  }else{
   const entry=identity.engine==='deckcraft'?'presentation.json':identity.engine==='photocraft'?'manifest.json':null;if(!entry)throw new Error();
   const entries=readZip(raw,{includeNames:[entry],maxEntries:65535,maxEntryBytes:256*1024*1024,maxTotalBytes:1024*1024*1024,maxSelectedBytes:MAX});if(entries.length!==1||entries[0].name!==entry)throw new Error();raw=entries[0].data;
  }
  if(raw.length>MAX)throw new SafetyError('完整文档结构超过32MiB颜色检查预算，未使用摘要代替',413);
  const data=decodeNativeJson(new TextDecoder('utf-8',{fatal:true}).decode(raw),{maxCharacters:MAX});assertSafeJson(data);
  model=identity.engine==='deckcraft'?data.presentation:data.document;if(!model||typeof model!=='object')throw new Error();
 }catch(error){if(error instanceof SafetyError)throw error;throw new SafetyError('无法读取完整原生文档结构或超过解压预算；没有以局部摘要冒充整稿检查',422);}
 if(view.root!==identity.root||view.epoch!==identity.epoch||view.sourceId!==identity.id||view.sourceRevision!==identity.revision||!sameUint64(view.document?.revision,identity.engineRevision))throw new SafetyError('颜色检查期间作品已改变，请重新保存检查',409);
 const report=auditDocumentColors(model,{background,sourceId:identity.id,sourceRevision:identity.revision,engine:identity.engine});
 report.source.nativeSourceSha256=saved.meta.sourceHash;report.source.structureSha256=report.source.snapshotSha256;report.source.fullSavedModel=true;report.source.liveSummaryUsed=false;return report;
}
