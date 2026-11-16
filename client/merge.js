// Three-way merge for versioned design documents. ID arrays preserve object identity.
const absent = Symbol('absent');
const unsafe = new Set(['__proto__','constructor','prototype']);
const clone = value => value === absent ? absent : JSON.parse(JSON.stringify(value));
export const documentsEqual = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function mergeDocuments(base,local,remote) {
  const conflicts=[];
  const merge=(b,l,r,path)=>{
    if (documentsEqual(l,r)) return clone(l);
    if (documentsEqual(l,b)) return clone(r);
    if (documentsEqual(r,b)) return clone(l);
    const object=v=>v!==absent && v!==null && typeof v==='object' && !Array.isArray(v);
    if (object(b) && object(l) && object(r)) {
      const out={};
      for (const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])) {
        if(unsafe.has(key)) {conflicts.push(path+'/'+key);continue;}
        if(key==='updatedAt') {if(Object.hasOwn(r,key))out[key]=r[key];continue;}
        const value=merge(Object.hasOwn(b,key)?b[key]:absent,Object.hasOwn(l,key)?l[key]:absent,Object.hasOwn(r,key)?r[key]:absent,path+'/'+key);
        if(value!==absent)out[key]=value;
      }
      return out;
    }
    const keyed=a=>Array.isArray(a)&&a.every(v=>v&&typeof v==='object'&&typeof v.id==='string')&&new Set(a.map(v=>v.id)).size===a.length;
    if(keyed(b)&&keyed(l)&&keyed(r)) {
      const bm=new Map(b.map(v=>[v.id,v])),lm=new Map(l.map(v=>[v.id,v])),rm=new Map(r.map(v=>[v.id,v]));
      const oldOrder=b.map(v=>v.id);
      const order=a=>a.map(v=>v.id).filter(id=>bm.has(id));
      const localOrder=order(l),remoteOrder=order(r);
      const commonOrder=a=>a.filter(id=>lm.has(id)&&rm.has(id));
      const lo=commonOrder(localOrder),ro=commonOrder(remoteOrder),bo=commonOrder(oldOrder);
      if(!documentsEqual(lo,ro)&&!documentsEqual(lo,bo)&&!documentsEqual(ro,bo))conflicts.push(path+'/@order');
      const chosen=!documentsEqual(lo,bo)?l:r;
      const ids=[...new Set([...chosen.map(v=>v.id),...l.map(v=>v.id),...r.map(v=>v.id)])];
      const out=[];
      for(const id of ids) {
        const value=merge(bm.has(id)?bm.get(id):absent,lm.has(id)?lm.get(id):absent,rm.has(id)?rm.get(id):absent,path+'/'+id);
        if(value!==absent)out.push(value);
      }
      return out;
    }
    conflicts.push(path||'/');return clone(l);
  };
  return {doc:merge(base,local,remote,''),conflicts:[...new Set(conflicts)]};
}
