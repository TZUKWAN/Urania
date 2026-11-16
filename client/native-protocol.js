/** Exact native JSON integers. Shared by browser adapters and the Node host. */
const U64_MAX=18446744073709551615n,SAFE_TEXT=String(Number.MAX_SAFE_INTEGER);
const DECIMAL=/^(0|[1-9][0-9]{0,19})$/;
export function uint64(value){
 if(typeof value==='number'){
  if(!Number.isSafeInteger(value)||value<0)throw new TypeError('原生整数已超出 JS 安全范围；请使用完整十进制字符串');
  return String(value);
 }
 if(typeof value!=='string'||!DECIMAL.test(value)||BigInt(value)>U64_MAX)throw new TypeError('原生身份必须是有效 uint64 十进制值');
 return value;
}
export function isUint64(value){try{uint64(value);return true;}catch{return false;}}
export function sameUint64(a,b){try{return uint64(a)===uint64(b);}catch{return false;}}
export function compareUint64(a,b){const left=BigInt(uint64(a)),right=BigInt(uint64(b));return left<right?-1:left>right?1:0;}
export const uint64Parameter=value=>({$u64:uint64(value)});
export const uint64Schema={anyOf:[{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},{type:'string',pattern:'^(0|[1-9][0-9]{0,19})$'}]};

export function encodeNativeJson(value,{maxBytes=8*1024*1024}={}){
 const seen=new WeakSet();let nodes=0;
 const encode=(value,depth)=>{
  if(++nodes>100000||depth>64)throw new TypeError('原生参数结构超过预算');
  if(value===null)return 'null';
  if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){
   if(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))throw new TypeError('原生数值不能包含已丢精度整数或非有限值');
   return JSON.stringify(value);
  }
  if(typeof value==='bigint')return uint64(value.toString());
  if(typeof value!=='object')throw new TypeError('原生参数必须可序列化');
  if(seen.has(value))throw new TypeError('原生参数不能循环引用');
  const prototype=Object.getPrototypeOf(value);
  if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)throw new TypeError('原生参数只接受普通对象');
  const keys=Object.keys(value);
  if(keys.length===1&&keys[0]==='$u64')return uint64(value.$u64);
  seen.add(value);let result;
  if(Array.isArray(value)){
   const items=[];for(let i=0;i<value.length;i++){if(!Object.hasOwn(value,i))throw new TypeError('原生数组不能包含空洞');items.push(encode(value[i],depth+1));}result='['+items.join(',')+']';
  }else{
   result='{'+keys.filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+':'+encode(value[key],depth+1)).join(',')+'}';
  }
  seen.delete(value);if(result.length>maxBytes)throw new TypeError('原生请求超过预算');return result;
 };
 const text=encode(value,0);if(new TextEncoder().encode(text).length>maxBytes)throw new TypeError('原生请求超过字节预算');return text;
}

export function decodeNativeJson(text,{maxCharacters=512*1024*1024}={}){
 if(typeof text!=='string'||text.length>maxCharacters)throw new TypeError('原生响应无效或超过预算');
 // Only unquoted integer tokens are rewritten. Strings, escaped quotes,
 // decimal/exponent floats and the exact native source text remain untouched.
 const parts=[];let i=0,last=0;
 while(i<text.length){
  const ch=text[i];
  if(ch==='"'){
   i++;
   while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')break;}
   continue;
  }
  if(ch==='-'||ch>='0'&&ch<='9'){
   const start=i++;while(i<text.length&&/[0-9eE+.\-]/.test(text[i]))i++;
   const token=text.slice(start,i);
   if(/^-?(0|[1-9][0-9]*)$/.test(token)){
    const digits=token[0]==='-'?token.slice(1):token;
    if(digits.length>SAFE_TEXT.length||digits.length===SAFE_TEXT.length&&digits>SAFE_TEXT){parts.push(text.slice(last,start),JSON.stringify(token));last=i;}
   }
   continue;
  }
  i++;
 }
 const source=parts.length?(parts.push(text.slice(last)),parts.join('')):text;
 return JSON.parse(source,(_key,value)=>{if(typeof value==='number'&&!Number.isFinite(value))throw new TypeError('原生响应含不可表示数值');return value;});
}

/** Known identity fields are numeric in Rust; arbitrary numeric text is not. */
export function nativeCallParameters(method,payload={}){
 if(method==='host.execute'||method==='host.bundle'||method==='host.node'){
  const base=payload.base;if(!base||base.selection!==undefined&&!Array.isArray(base.selection))throw new TypeError('缺少原生执行基线');
  return {...payload,base:{...base,uid:uint64Parameter(base.uid),revision:uint64Parameter(base.revision),...(base.selection!==undefined?{selection:base.selection.map(uint64Parameter)}:{})}};
 }
 if(method==='host.saved')return {...payload,uid:uint64Parameter(payload.uid),revision:uint64Parameter(payload.revision),...(payload.nativeDocumentId!==undefined?{nativeDocumentId:uint64Parameter(payload.nativeDocumentId)}:{})};
 if(method==='host.file.finish')return {...payload,id:uint64Parameter(payload.id)};
 return payload;
}
