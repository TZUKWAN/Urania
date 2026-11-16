import {openSync,readSync,closeSync,statSync} from 'node:fs';
import {join} from 'node:path';
import * as store from './docstore.js';
import {workspacePath,assertPortableName,SafetyError} from './safety.js';
import {previewImageSize} from './image-header.js';
export function previewInfo({root,docId,pageId}){
 root=store.validateRoot(root);const current=store.readDoc(root,docId),doc=current.doc,page=doc.pages.find(p=>p.id===pageId)||doc.pages[0];if(doc.canvas.width*doc.canvas.height>4_500_000)throw new SafetyError('作品超过并排预览预算，请单独打开方案查看',413);
 const names=new Set();const visit=list=>{for(const l of list||[]){if(l.hidden)continue;if(l.asset)names.add(typeof l.asset==='string'?l.asset:l.asset.src);if(l.mask?.kind==='luminance')names.add(typeof l.mask.asset==='string'?l.mask.asset:l.mask.asset?.src);visit(l.children);}};visit(page.layers);let pixels=0;
 for(const name of names){assertPortableName(name);const path=workspacePath(root,join('design','assets',name),{mustExist:true}),fd=openSync(path,'r');try{const bytes=Buffer.alloc(Math.min(statSync(path).size,1024*1024));readSync(fd,bytes,0,bytes.length,0);const size=previewImageSize(bytes);pixels+=size.width*size.height;if(pixels>4_500_000)throw new SafetyError('素材总量超过并排预览预算，请单独打开方案查看',413);}finally{closeSync(fd);}}
 return {ok:true,...current,pageId:page.id};
}
