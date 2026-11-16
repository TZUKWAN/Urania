import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import * as store from './docstore.js';
import {nativeDeckPackage,nativeSlideIndex,captureDeckSource} from './deck-source.js';
import {createZip} from './zip.js';
import {openNativeSession} from './native.js';
import {WorkspaceNative} from './workspace-native.js';
import {prepareImageCandidate} from './image-jobs.js';
import {mergeDocuments} from '../client/merge.js';
import {assertPortableName,workspacePath,SafetyError} from './safety.js';
import {previewImageSize} from './image-header.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function findShape(list,id){for(const shape of list||[]){if(shape.id===id)return shape;const child=findShape(shape.kind?.children,id);if(child)return child;}return null;}
function pictureSource(doc,root,pageId,objectId){
 if(doc.native?.deck?.mode!=='source')throw new SafetyError('请先启用原生演示编辑',422);if(!Number.isSafeInteger(objectId))throw new SafetyError('原生图片 ID 无效',422);
 const bytes=store.readAsset(root,doc.native.deck.source);if(!bytes)throw new SafetyError('原生演示底稿缺失',404);const parsed=nativeDeckPackage(bytes),{index}=nativeSlideIndex(doc,parsed.model,pageId),shape=findShape(parsed.model.presentation.slides[index].shapes,objectId);
 if(shape?.kind?.type!=='picture')throw new SafetyError('请选择一个真实原生图片对象',422);const media=parsed.model.presentation.media.find(m=>m.id===shape.kind.fill.media),entry=parsed.entries.find(e=>e.name==='media/'+media?.id);if(!media||!entry)throw new SafetyError('原生图片没有内嵌可编辑媒体，未读取外部链接',422);
 return {...parsed,shape,media,bytes:entry.data};
}
// ZIP/model work is dispatched to the supervised worker. No native process here.
export function extractLinkedMedia({root,docId,pageId,nativeObjectId,baseRevision}){
 root=store.validateRoot(root);const current=store.readDoc(root,docId);if(current.revision!==baseRevision)throw new SafetyError('演示已变化，请重新选择图片',409);const picture=pictureSource(current.doc,root,pageId,Number(nativeObjectId)),svg=picture.media.contentType==='image/svg+xml';
 const ext=svg?'svg':picture.bytes[0]===255&&picture.bytes[1]===216?'jpg':picture.bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'png':picture.bytes.subarray(0,4).toString()==='RIFF'?'webp':null;if(!ext)throw new SafetyError('该原生媒体格式尚未接入可编辑图片/矢量源，原文件已保留',422);
 const original=store.saveAsset(root,'linked-media-'+randomUUID()+'.'+ext,picture.bytes);return {ok:true,asset:original.name,editor:svg?'vector':'image',title:current.doc.title+' › '+(picture.shape.name||'图片'),link:{parentDocId:docId,pageId,nativeObjectId:Number(nativeObjectId),originalMediaHash:digest(picture.bytes),parentRevision:current.revision,editor:svg?'vector':'image'}};
}
export function stageLinkedMedia({root,childDocId,childRevision,asset}){
 root=store.validateRoot(root);assertPortableName(asset);const child=store.readDoc(root,childDocId);if(child.revision!==childRevision)throw new SafetyError('源图在准备期间已修改，未应用旧版本',409);const link=child.doc.native?.mediaLink;if(!link||link.parentDocId===childDocId)throw new SafetyError('当前作品没有演示图片关联',422);
 const parent=store.readDoc(root,link.parentDocId),picture=pictureSource(parent.doc,root,link.pageId,link.nativeObjectId),currentHash=digest(picture.bytes),prior=parent.doc.native.deck.mediaEdits?.[childDocId];
 if(currentHash!==link.originalMediaHash&&currentHash!==prior?.mediaHash)throw new SafetyError('演示中的图片已被其他编辑替换，源图保留，未覆盖该图片',409);
 const replacement=store.readAsset(root,asset);if(!replacement)throw new SafetyError('编辑后的媒体不存在',404);const svg=asset.toLowerCase().endsWith('.svg');if(svg&&link.editor!=='vector')throw new SafetyError('当前关联需要位图输出',422);
 let size=svg?child.doc.canvas:previewImageSize(replacement);if(link.originalSize&&Math.abs(size.width/size.height-link.originalSize.width/link.originalSize.height)>.002)throw new SafetyError('源图宽高比已改变，无法同时保留演示裁剪和布局，请恢复原画板比例',422);
 const mediaId=picture.model.presentation.nextId++;if(!Number.isSafeInteger(mediaId))throw new SafetyError('原生媒体 ID 无效',422);picture.shape.kind.fill.media=mediaId;picture.model.presentation.media.push({id:mediaId,name:asset,contentType:svg?'image/svg+xml':replacement[0]===255&&replacement[1]===216?'image/jpeg':'image/png',link:null});
 const entries=picture.entries.filter(e=>e.name!=='presentation.json');entries.push({name:'presentation.json',data:JSON.stringify(picture.model)},{name:'media/'+mediaId,data:replacement});const staged=store.saveAsset(root,'linked-deck-'+randomUUID()+'.deckcraft',createZip(entries));
 return {ok:true,parentDoc:parent.doc,parentRevision:parent.revision,childDocId,childRevision,link,asset:staged.name,mediaHash:digest(replacement)};
}
export async function openLinkedMedia(input,{jobs,signal}){
 const root=store.validateRoot(input.root),extracted=await jobs.run('media-extract',{...input,root},{signal}),child={id:'linked-'+randomUUID(),title:extracted.title,type:extracted.editor==='image'?'photo':'vector',canvas:{width:1280,height:720},pages:[{id:'page-'+randomUUID(),name:'图片源',background:{kind:'solid',color:'transparent'},layers:[]}],native:{mediaLink:extracted.link}};
 if(extracted.editor==='vector'){
  const session=await openNativeSession('vectorcraft',root,{signal}),adapter=new WorkspaceNative();try{const result=await adapter.importVector(session,child,{root,pageId:child.pages[0].id,asset:extracted.asset,fitCanvas:true});if(result.boardSize)child.canvas=result.boardSize;}finally{adapter.dispose();await session.close();}
 }else{
  const bytes=store.readAsset(root,extracted.asset),candidate=await prepareImageCandidate(root,bytes,'linked-image-'+randomUUID(),signal);child.canvas={width:candidate.width,height:candidate.height};child.pages[0].layers=[{id:'image-'+randomUUID(),type:'image',name:'演示图片源',x:0,y:0,w:candidate.width,h:candidate.height,naturalWidth:candidate.width,naturalHeight:candidate.height,opacity:1,asset:candidate.asset,native:candidate.native}];
 }
 child.native.mediaLink.originalSize={...child.canvas};signal?.throwIfAborted();return {ok:true,...store.createDoc(root,child)};
}
export async function commitLinkedMedia(input,{jobs,signal}){
 const root=store.validateRoot(input.root);let asset=input.asset;
 // Canonical vector export strips active/external content through the real engine.
 if(String(asset).toLowerCase().endsWith('.svg')){const session=await openNativeSession('vectorcraft',root,{signal});try{assertPortableName(asset);await session.call('open_file',{path:workspacePath(root,join('design','assets',asset),{mustExist:true})});const output=join(session.directory,'linked-edited.svg');await session.call('export',{path:output,format:'svg',artboard:0});asset=store.saveAsset(root,'linked-vector-'+randomUUID()+'.svg',await readFile(output)).name;}finally{await session.close();}}
 const staged=await jobs.run('media-stage',{...input,root,asset},{signal}),doc=JSON.parse(JSON.stringify(staged.parentDoc)),session=await openNativeSession('deckcraft',root,{signal});
 try{
  await session.call('open_presentation',{path:workspacePath(root,join('design','assets',staged.asset),{mustExist:true})});await captureDeckSource(session,root,doc);doc.native.deck.mediaEdits={...doc.native.deck.mediaEdits,[input.childDocId]:{nativeObjectId:staged.link.nativeObjectId,mediaHash:staged.mediaHash,childRevision:staged.childRevision}};
  if(store.readDoc(root,input.childDocId).revision!==staged.childRevision)throw new SafetyError('图片在应用期间已修改，新内容仍保留，演示未应用旧图',409);const current=store.readDoc(root,doc.id),merged=mergeDocuments(staged.parentDoc,doc,current.doc);if(merged.conflicts.length)throw new SafetyError('演示底稿同时发生修改，双方结果保留，请重新应用',409);signal?.throwIfAborted();return {ok:true,...store.writeDoc(root,doc.id,merged.doc,'linked-media-commit',{baseRevision:current.revision,returnDocument:true}),childDocId:input.childDocId};
 }finally{await session.close();}
}
