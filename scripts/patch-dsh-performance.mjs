/** Exact SDK compatibility patch. MIT; upstream fragments retain DeepSeek's notice. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const rootArg=get('--sdk-root');
if(!rootArg)throw Error('An explicit --sdk-root is required; the current user installation is never guessed.');
const root=fs.realpathSync(rootArg),mode=args.includes('--apply')?'apply':args.includes('--restore')?'restore':'check';
const plan=JSON.parse(fs.readFileSync(new URL('./dsh-performance-patch.json',import.meta.url),'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sdkPackage=JSON.parse(fs.readFileSync(path.join(root,'node_modules/@deepseek-ai/dsh/package.json'),'utf8'));
if(sdkPackage.name!=='@deepseek-ai/dsh'||sdkPackage.version!==plan.sdkVersion)throw Error('Unsupported SDK version; no files changed.');
const files=plan.files.map(item=>{
 const target=fs.realpathSync(path.join(root,item.path));
 if(!target.startsWith(root+path.sep))throw Error('SDK target escaped the explicitly selected directory.');
 const bytes=fs.readFileSync(target),digest=hash(bytes);
 if(![item.beforeSha256,item.afterSha256].includes(digest))throw Error('Unknown SDK source: '+item.path+'; no files changed.');
 return {...item,target,bytes,digest};
});
const backupRoot=path.join(root,'.urania-performance-patch'),receiptFile=path.join(backupRoot,'receipt.json');
let receipt=fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile,'utf8')):null;
if(receipt&&receipt.id!==plan.id&&!(receipt.state==='restored'&&files.every(f=>f.digest===f.beforeSha256)))throw Error('Another compatibility patch owns this SDK backup. Restore it before upgrading.');
if(mode==='check'){
 console.log(JSON.stringify({id:plan.id,mode,sdkVersion:sdkPackage.version,allOriginal:files.every(f=>f.digest===f.beforeSha256),allPatched:files.every(f=>f.digest===f.afterSha256),files:files.map(f=>({path:f.path,sha256:f.digest}))}));
 process.exit(0);
}
const pending=files.map(file=>{
 if(mode==='restore'){
  if(file.digest===file.beforeSha256)return {...file,next:file.bytes};
  const backup=path.join(backupRoot,file.path),bytes=fs.readFileSync(backup);
  if(hash(bytes)!==file.beforeSha256)throw Error('Original SDK backup failed verification; no files changed.');
  return {...file,next:bytes};
 }
 if(file.digest===file.afterSha256)return {...file,next:file.bytes};
 let text=file.bytes.toString('utf8');
 for(const change of file.replacements){
  if(text.split(change.before).length-1!==(change.count??1))throw Error('SDK patch context changed; no files changed.');
  text=text.replaceAll(change.before,change.after);
 }
 const next=Buffer.from(text);if(hash(next)!==file.afterSha256)throw Error('Patch output failed verification; no files changed.');
 return {...file,next};
});
// Stage and validate every replacement before changing a single source file.
fs.mkdirSync(backupRoot,{recursive:true});
for(const file of pending){
 if(mode==='apply'&&file.digest===file.beforeSha256){
  const backup=path.join(backupRoot,file.path);fs.mkdirSync(path.dirname(backup),{recursive:true});
  if(fs.existsSync(backup)){if(hash(fs.readFileSync(backup))!==file.beforeSha256)throw Error('Existing backup changed; no sources written.');}
  else fs.writeFileSync(backup,file.bytes,{flag:'wx'});
 }
}
const written=[];
function windowsRetry(operation){
 for(let attempt=0;;attempt++){
  try{return operation();}
  catch(error){
   if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=5)throw error;
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50*(attempt+1));
  }
 }
}
function writeAtomic(target,bytes){
 const temporary=target+'.urania-'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temporary,bytes,{flag:'wx'});windowsRetry(()=>fs.renameSync(temporary,target));}
 finally{if(fs.existsSync(temporary))windowsRetry(()=>fs.unlinkSync(temporary));}
}
try{
 for(const file of pending)if(!file.bytes.equals(file.next)){writeAtomic(file.target,file.next);written.push(file);}
 for(const file of pending)if(hash(fs.readFileSync(file.target))!==hash(file.next))throw Error('Written SDK source failed verification.');
 receipt={schema:1,id:plan.id,sdkVersion:plan.sdkVersion,state:mode==='apply'?'applied':'restored',files:pending.map(f=>({path:f.path,beforeSha256:f.beforeSha256,afterSha256:f.afterSha256,currentSha256:hash(f.next)}))};
 writeAtomic(receiptFile,Buffer.from(JSON.stringify(receipt,null,2)+'\n'));
}catch(error){for(const file of written.reverse())writeAtomic(file.target,file.bytes);throw error;}
console.log(JSON.stringify(receipt));
