import {configureAssets,renderPageToCanvas,api} from './engine.js';
const base=document.createElement('base');base.href=new URL('../../../',location.href).href;document.head.append(base);
const query=new URLSearchParams(location.search),root=query.get('root'),id=query.get('id'),status=document.getElementById('status'),container=document.getElementById('view');
let documentData=null,sequence=0;
async function render(){if(!documentData)return;const ticket=++sequence,doc=documentData.doc,page=doc.pages.find(p=>p.id===documentData.pageId);const scale=Math.min(container.clientWidth/doc.canvas.width,container.clientHeight/doc.canvas.height,1);const canvas=await renderPageToCanvas(page,doc,Math.max(1,Math.round(doc.canvas.width*scale)),Math.max(1,Math.round(doc.canvas.height*scale)));if(ticket!==sequence)return;canvas.dataset.ready='true';canvas.dataset.documentId=doc.id;canvas.dataset.revision=documentData.revision;container.replaceChildren(canvas);status.textContent='';}
try{
 const response=await fetch(api('/designcraft/api/v1/preview/document?root='+encodeURIComponent(root)+'&id='+encodeURIComponent(id)+(query.get('pageId')?'&pageId='+encodeURIComponent(query.get('pageId')):'')),{cache:'no-store'}),data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'作品预览失败');documentData=data;configureAssets(root,id);await document.fonts.ready;await render();new ResizeObserver(()=>render().catch(e=>{status.textContent=e.message;})).observe(container);
}catch(error){status.textContent=error.message;}
