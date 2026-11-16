let database;
function open() {
  if(!globalThis.indexedDB) return Promise.reject(new Error('本地恢复存储不可用'));
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('designcraft-recovery',1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('drafts',{keyPath:'key'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{database=null;reject(request.error);};
  });
  return database;
}
export const recoveryKey=(root,id)=>root+'\0'+id;
async function operation(mode,run) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts',mode),store=tx.objectStore('drafts');let value;
    const request=run(store);
    request.onsuccess=()=>{value=request.result;};
    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('恢复存储事务中止'));
  });
}
export const saveDraft=(key,record)=>operation('readwrite',s=>s.put({...record,key,at:new Date().toISOString()}));
export const readDraft=key=>operation('readonly',s=>s.get(key));
export async function clearDraft(key,match) {
  if(!match)return operation('readwrite',s=>s.delete(key));
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),request=store.get(key);
    request.onsuccess=()=>{const record=request.result;if(record&&(!match.writer||record.writer===match.writer)&&(!match.at||record.at===match.at)&&(match.version==null||record.editVersion<=match.version))store.delete(key);};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
