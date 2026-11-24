/** Native identity/context contract. Engine registration is separate from source formats. */
import {isUint64,sameUint64} from './native-protocol.js?v=169';

export const EDITOR_CONTEXT_PROTOCOL=2;
// File types do not advertise a live editor. Photo/Deck enter the live registry
// only after their actual persistent bridges have been implemented and verified.
export const SOURCE_FORMATS=Object.freeze({vectorcraft:'vectorcraft',photocraft:'pcraft',deckcraft:'deckcraft'});
export const VECTOR_CONTRACT=Object.freeze({engine:'vectorcraft',runtime:'vectorcraft-host',extension:'vectorcraft',sourceFormat:'vectorcraft',exportFormats:['vectorcraft','svg','png','jpg','pdf'],createDefaults:{width:1280,height:720,units:'Pixels'},apiName:'vectorcraft',contextProtocol:2,identityEncoding:'uint64-json-decimal',selectionKind:'vectorcraft'});
// A staged descriptor is not a live registration. The server advertises only installed, gated bridges.
export const PHOTO_CONTRACT=Object.freeze({engine:'photocraft',runtime:'photocraft-host',extension:'pcraft',sourceFormat:'pcraft',exportFormats:['pcraft','png','jpg','psd','webp','tiff'],createDefaults:{width:1024,height:1024,mode:'rgb',depth:8,background:'transparent'},apiName:'photocraft',contextProtocol:2,identityEncoding:'uint64-json-decimal',identityKind:'native-active-document-generation',selectionKind:'photocraft'});
export const DECK_CONTRACT=Object.freeze({engine:'deckcraft',runtime:'deckcraft-host',extension:'deckcraft',sourceFormat:'deckcraft',exportFormats:['deckcraft','pptx','png','jpg','pdf'],createDefaults:{width:960,height:540},apiName:'deckcraft',contextProtocol:2,identityEncoding:'uint64-json-decimal',identityKind:'native-document-instance-uid',selectionKind:'deckcraft',objectIdBits:32});
export function sameNativeDocument(a,b){return !!a&&!!b&&sameUint64(a.uid,b.uid)&&(!(a.nativeDocumentId!==undefined||b.nativeDocumentId!==undefined)||sameUint64(a.nativeDocumentId,b.nativeDocumentId));}
export function sameObjectIds(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((id,index)=>sameUint64(id,b[index]));}
export function validateNativeIdentity(document){
 if(!document||!isUint64(document.uid)||!isUint64(document.revision))throw new TypeError('缺少精确的原生文档身份或修订');
 if(document.nativeDocumentId!==undefined&&!isUint64(document.nativeDocumentId))throw new TypeError('原生文档 ID 不精确');
 return document;
}
export function validateNativeContext(document,engine){
 validateNativeIdentity(document);
 if(!Object.hasOwn(SOURCE_FORMATS,engine)||document.engine!==engine||document.contextProtocol!==EDITOR_CONTEXT_PROTOCOL||!isUint64(document.contextSequence))throw new TypeError('原生引擎、上下文协议或原生序号不匹配');
 if(typeof document.selectionStamp!=='string'||!document.selectionStamp||document.selectionStamp.length>512*1024)throw new TypeError('缺少完整原生选区上下文或上下文超过预算');
 const selection=document.nativeSelection;
 if(selection?.kind!==engine||!selection.data||typeof selection.data!=='object'||Array.isArray(selection.data))throw new TypeError('原生选区类型与编辑引擎不一致');
 if(engine==='vectorcraft'&&(!sameObjectIds(document.selection,selection.data.objects)||!document.selection.every(isUint64)))throw new TypeError('矢量对象列表与实际原生选区不一致');
 if(engine==='photocraft'){
  const data=selection.data;
  if(document.identityKind!=='native-active-document-generation'||!isUint64(document.nativeDocumentId)||!sameUint64(data.documentId,document.nativeDocumentId)||!sameUint64(data.activeGeneration,document.uid)||!Array.isArray(data.selectedLayers)||!data.selectedLayers.every(isUint64))throw new TypeError('图片原生文档、代次或图层身份不匹配');
  if(data.rasterSelection&&(!sameUint64(data.rasterSelection.uid,document.uid)||!sameUint64(data.rasterSelection.revision,document.revision)||data.rasterSelection.kind!=='native-coverage-surface'||data.rasterSelection.nativeRole!=='document.selection'))throw new TypeError('图片选区没有匹配的实际原生覆盖数据引用');
 }
 if(engine==='deckcraft'){
  const data=selection.data.selection,page=document.page,shapeId=id=>isUint64(id)&&BigInt(id)<=4294967295n;
  if(document.identityKind!=='native-document-instance-uid'||!data||!Number.isSafeInteger(data.slide)||data.slide<0||!Array.isArray(data.shapes)||!data.shapes.every(shapeId)||!Array.isArray(data.slides)||!data.slides.every(shapeId)||!['slides','master','layout','handout','notesMaster'].includes(data.target?.kind)||!Array.isArray(document.objectIds)||!document.objectIds.every(shapeId))throw new TypeError('演示原生页面、对象或目标身份不精确');
  if(!Number.isSafeInteger(document.slideCount)||document.slideCount<0||document.slideCount>100||!Array.isArray(document.slides)||document.slides.length!==document.slideCount)throw new TypeError('演示页数与实际原生页面不一致');
  if(!page||page.target?.kind!==data.target.kind||!page.nativePage||!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<=0||page.height<=0)throw new TypeError('演示页面上下文不完整');
  const notes=!!data.text?.notes,expected=notes?[]:data.shapes;
  if(!sameObjectIds(expected,document.objectIds))throw new TypeError('演示对象引用与实际编辑目标不一致');
  if(data.target.kind==='slides'){
   const active=document.slides[data.slide];
   if(!['slide','notesPage','slideNotes'].includes(page.nativePage.kind)||document.slideCount>0&&(!active||!shapeId(active.id)||!sameUint64(active.id,page.nativePage.id))||document.slideCount===0&&page.nativePage.id!=null)throw new TypeError('演示当前页与原生页面身份不匹配');
  }else{
   const kind={master:'master',layout:'layout',handout:'handoutMaster',notesMaster:'notesMaster'}[data.target.kind];
   if(page.nativePage.kind!==kind||['master','layout'].includes(data.target.kind)&&(!Number.isSafeInteger(data.target.master)||data.target.master<0||page.target.master!==data.target.master)||data.target.kind==='layout'&&(!Number.isSafeInteger(data.target.layout)||data.target.layout<0||page.target.layout!==data.target.layout))throw new TypeError('演示母版或版式目标不一致');
  }
 }
 return document;
}
export function nativeBase(document){
 validateNativeContext(document,document?.engine);
 return {uid:document.uid,revision:document.revision,engine:document.engine,selectionStamp:document.selectionStamp,...(Array.isArray(document.selection)?{selection:[...document.selection]}:{})};
}
export function matchesNativeBase(document,base,engine){
 if(!base||document?.engine!==engine||base.engine!==engine||!sameUint64(document.uid,base.uid)||!sameUint64(document.revision,base.revision)||document.selectionStamp!==base.selectionStamp)return false;
 return !Array.isArray(document.selection)||sameObjectIds(document.selection,base.selection);
}
export function selectedObjectIds(document){
 // Preserve full nativeSelection independently. Raster masks/slide ranges must
 // not be recast as a Vector-style list just to populate a reference chip.
 if(Array.isArray(document?.objectIds))return [...document.objectIds];
 if(document?.engine==='vectorcraft'&&Array.isArray(document.selection))return [...document.selection];
 if(document?.engine==='photocraft'&&Array.isArray(document.nativeSelection?.data?.selectedLayers))return [...document.nativeSelection.data.selectedLayers];
 return [];
}
export function canvasMaterialTarget(document){
 const ids=selectedObjectIds(document);
 if(ids.length===1)return String(ids[0]);
 if(ids.length===0&&document?.engine==='vectorcraft'&&isUint64(document.isolation))return String(document.isolation);
 return null;
}
