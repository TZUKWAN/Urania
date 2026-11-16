import {extractLinkedMedia,stageLinkedMedia} from './media-link.js';
import {previewInfo} from './preview-info.js';
import {listVariants,forkVariant,adoptVariant} from './variants.js';
import {prepareEditMask,composeEditOverlay,verifyOutsideMask} from './image-composite.js';
// One isolated process per computation: a failed decoder cannot take down the DSH host.
import {executeCommands} from './commands.js';
import * as store from './docstore.js';
import {exportPdfFromClientPages} from './pdf.js';
const post=(message,done)=>process.stdout.write(JSON.stringify(message)+'\n',done);
function execute(message){
  try {
    const {kind,payload}=message;let result;
    if(kind==='media-extract')result=extractLinkedMedia(payload);
    else if(kind==='media-stage')result=stageLinkedMedia(payload);
    else if(kind==='preview-info')result=previewInfo(payload);
    else if(kind==='variant-list')result=listVariants(payload);
    else if(kind==='variant-fork')result=forkVariant(payload);
    else if(kind==='variant-adopt')result=adoptVariant(payload);
    else if(kind==='image-mask')result=prepareEditMask(payload);
    else if(kind==='image-overlay')result=composeEditOverlay(payload);
    else if(kind==='image-verify')result=verifyOutsideMask(payload);
    else if(kind==='commands')result=executeCommands(payload.root,payload.commands,{...payload.options,onProgress:progress=>post({type:'progress',progress})});
    else if(kind==='state')result={docs:store.listDocs(payload.root),assets:store.listAssets(payload.root),tasks:store.listTasks(payload.root)};
    else if(kind==='read-doc')result=store.readDoc(payload.root,payload.id);
    else if(kind==='client-pdf') {
      const pages=payload.pages.map(page=>({name:page.name,widthPx:page.widthPx,heightPx:page.heightPx,kind:page.kind||'png',buffer:Buffer.from(page.dataBase64,'base64')}));
      const buffer=exportPdfFromClientPages(pages);result=store.saveExport(payload.root,payload.out||'export.pdf',buffer);
    } else throw new Error('Unknown computation kind: '+kind);
    post({type:'result',result},()=>process.exit(0));
  }catch(error){post({type:'failure',error:String(error?.message||error),status:error.status||500,current:error.current},()=>process.exit(0));}

}
let input='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(Buffer.byteLength(input)>20*1024*1024){post({type:'failure',error:'后台请求超过20MB预算',status:413},()=>process.exit(1));process.stdin.destroy();}});
process.stdin.once('end',()=>{try{execute(JSON.parse(input));}catch(error){post({type:'failure',error:error.message,status:400},()=>process.exit(1));}});
