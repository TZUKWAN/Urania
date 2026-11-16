import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {SafetyError} from './safety.js';
import * as store from './docstore.js';
const root=join(dirname(dirname(fileURLToPath(import.meta.url))),'resources','open-design');
const lock=JSON.parse(readFileSync(join(root,'lock.json'),'utf8'));
const verified=new Map();
function read(path){
 const record=lock.files.find(item=>item.path===path);if(!record)throw new SafetyError('资源文件未在已校验清单中',404);
 if(!verified.has(path)){
  const bytes=readFileSync(join(root,path));if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw new SafetyError('设计资源校验失败: '+path,503);
  verified.set(path,bytes.toString('utf8'));
 }
 return verified.get(path);
}
function style(id){if(!lock.styles.includes(id))throw new SafetyError('设计资源不存在',404);const path='design-systems/'+id+'/';return {manifest:JSON.parse(read(path+'manifest.json')),tokens:JSON.parse(read(path+'design-tokens.json')),design:read(path+'DESIGN.md'),path};}
export function systemFor(id){
 const resource=style(id),tokens=Object.fromEntries(resource.tokens.tokens.map(item=>[item.name,item.value]));
 const aliases={primary:'--accent',accent:'--accent',ink:'--fg',muted:'--muted',bg:'--bg',surface:'--surface',border:'--border',danger:'--danger',success:'--success',warning:'--warn'};
 const colors=Object.fromEntries(Object.entries(aliases).filter(([,token])=>tokens[token]).map(([name,token])=>[name,tokens[token]]));
 return {name:resource.manifest.name,colors,fonts:{body:tokens['--font-body'],heading:tokens['--font-display'],display:tokens['--font-display'],mono:tokens['--font-mono']},tokens,upstream:{id,repository:lock.repository,revision:lock.revision,license:lock.license,tokenAuthority:'design-tokens.json',files:lock.files.filter(file=>file.path.startsWith(resource.path)).map(({path,sha256,source})=>({path,sha256,source})),note:'完整原始说明与令牌均已保留；画布以 design-tokens.json 为准，DESIGN.md 的示例值不覆盖令牌。'}};
}
export function designResourceCatalog(){return lock.styles.map(id=>{const {manifest,tokens,path}=style(id);return {id,name:manifest.name,description:manifest.description,category:manifest.category,source:'https://github.com/'+lock.repository+'/tree/'+lock.revision+'/'+path,revision:lock.revision,tokens:tokens.tokens.length,colors:systemFor(id).colors,references:lock.files.filter(file=>file.path.startsWith(path+'system/artifacts/')).map(file=>file.path.slice(path.length))};});}
export function readDesignResource(id,file='DESIGN.md'){
 const resource=style(id),path=resource.path+file;
 return {id,file,content:read(path),source:lock.files.find(item=>item.path===path).source,sha256:lock.files.find(item=>item.path===path).sha256};
}
export function applyResourceToDocument(doc,resourceId){
 const system=systemFor(resourceId);
 const old=doc.designSystem||{};doc.designSystem={...old,...system};
 const colors=old.colors||{},reverse=new Map(Object.entries(colors).map(([name,value])=>[value,'var(--color-'+name+')']));
 const rebind=value=>typeof value==='string'&&reverse.has(value)?reverse.get(value):value;
 const update=layers=>{for(const layer of layers||[]){
  if(layer.type==='text'){layer.color=rebind(layer.color);layer.fontFamily='var(--font-body)';}
  if(layer.type==='shape')layer.fill=rebind(layer.fill);
  if(layer.type==='vector')for(const path of layer.paths||[])path.fill=rebind(path.fill);
  if(layer.type==='group')update(layer.children);
 }};
 for(const page of doc.pages){if(page.background?.kind==='solid')page.background.color='var(--color-bg)';update(page.layers);}
 return doc;
}
export function applyDesignResource(root,id,resourceId,baseRevision){
 const current=store.readDoc(root,id),doc=applyResourceToDocument(current.doc,resourceId);
 return {...store.writeDoc(root,id,doc,'open-design',{baseRevision,returnDocument:true}),resource:{id:resourceId,revision:lock.revision}};
}
