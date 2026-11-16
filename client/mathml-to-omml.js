/** Structured conversion of actual MathML recognition output to editable Office Math. */
const NS='http://www.w3.org/1998/Math/MathML',OM='http://schemas.openxmlformats.org/officeDocument/2006/math';
const esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const ENTITIES={InvisibleTimes:'\u2062',ApplyFunction:'\u2061',InvisibleComma:'\u2063',alpha:'α',beta:'β',gamma:'γ',delta:'δ',theta:'θ',lambda:'λ',mu:'μ',pi:'π',sigma:'σ',phi:'φ',omega:'ω',sum:'∑',prod:'∏',int:'∫',infin:'∞',plusmn:'±',minus:'−',times:'×',divide:'÷',le:'≤',ge:'≥',ne:'≠',radic:'√'};
export function mathMLToOfficeMath(markup){
 if(typeof markup!=='string'||!markup.trim()||markup.length>200000||/<!/.test(markup))throw new Error('公式识别返回的 MathML 无效或过大');
 const xml=markup.replace(/&([A-Za-z][A-Za-z0-9]*);/g,(all,name)=>Object.hasOwn(ENTITIES,name)?ENTITIES[name]:all),doc=new DOMParser().parseFromString(xml,'application/xml');
 if(doc.querySelector('parsererror')||doc.doctype||doc.documentElement.localName!=='math')throw new Error('公式识别结果不是完整的 MathML');
 let count=0;
 const run=text=>({omml:'<m:r><m:t xml:space="preserve">'+esc(text)+'</m:t></m:r>',linear:text});
 const group=parts=>({omml:parts.map(p=>p.omml).join(''),linear:parts.map(p=>p.linear).join('')});
 const wrap=(tag,parts)=>'<m:'+tag+'>'+parts+'</m:'+tag+'>';
 const walk=(node,depth=0)=>{
  if(++count>10000||depth>64)throw new Error('公式层级或节点数超过预算');
  if(node.namespaceURI&&node.namespaceURI!==NS)throw new Error('公式包含非 MathML 内容');
  const tag=node.localName,children=[...node.children],parts=()=>children.map(child=>walk(child,depth+1));
  if(['mi','mn','mo','mtext','ms'].includes(tag))return run(node.textContent||'');
  if(['math','mrow','mstyle','mpadded'].includes(tag))return group(parts());
  if(tag==='semantics'){const first=children.find(child=>!['annotation','annotation-xml'].includes(child.localName));if(!first)throw new Error('公式缺少展示结构');return walk(first,depth+1);}
  if(tag==='mspace')return run(' ');
  if(tag==='none')return {omml:'',linear:''};
  const arity=(n)=>{if(children.length!==n)throw new Error('公式 '+tag+' 的子项数量无效');return parts();};
  if(tag==='mfrac'){const [a,b]=arity(2);return {omml:wrap('f',wrap('num',a.omml)+wrap('den',b.omml)),linear:'('+a.linear+')/('+b.linear+')'};}
  if(tag==='msqrt'||tag==='mroot'){
   const p=tag==='msqrt'?parts():arity(2),base=tag==='msqrt'?group(p):p[0],degree=tag==='msqrt'?{omml:'',linear:''}:p[1];
   return {omml:wrap('rad',(tag==='msqrt'?'<m:radPr><m:degHide m:val="1"/></m:radPr>':'')+wrap('deg',degree.omml)+wrap('e',base.omml)),linear:tag==='msqrt'?'√('+base.linear+')':'root('+degree.linear+','+base.linear+')'};
  }
  if(['msup','msub','msubsup'].includes(tag)){
   const p=arity(tag==='msubsup'?3:2),type=tag==='msup'?'sSup':tag==='msub'?'sSub':'sSubSup',sub=tag!=='msup'?p[1]:null,sup=tag==='msup'?p[1]:tag==='msubsup'?p[2]:null;
   return {omml:wrap(type,wrap('e',p[0].omml)+(sub?wrap('sub',sub.omml):'')+(sup?wrap('sup',sup.omml):'')),linear:p[0].linear+(sub?'_('+sub.linear+')':'')+(sup?'^('+sup.linear+')':'')};
  }
  if(['munder','mover','munderover'].includes(tag)){
   const p=arity(tag==='munderover'?3:2);let result=p[0];
   if(tag!=='mover')result={omml:wrap('limLow',wrap('e',result.omml)+wrap('lim',p[1].omml)),linear:result.linear+'_('+p[1].linear+')'};
   if(tag!=='munder'){const top=tag==='munderover'?p[2]:p[1];result={omml:wrap('limUpp',wrap('e',result.omml)+wrap('lim',top.omml)),linear:result.linear+'^('+top.linear+')'};}
   return result;
  }
  if(tag==='mfenced'){
   const p=parts(),open=node.getAttribute('open')??'(',close=node.getAttribute('close')??')',sep=node.getAttribute('separators')??',';
   if(open.length>2||close.length>2||sep.length>8)throw new Error('公式围栏符号过长');
   return {omml:wrap('d','<m:dPr><m:begChr m:val="'+esc(open)+'"/><m:endChr m:val="'+esc(close)+'"/><m:sepChr m:val="'+esc(sep.slice(0,1))+'"/></m:dPr>'+p.map(item=>wrap('e',item.omml)).join('')),linear:open+p.map(item=>item.linear).join(sep)+close};
  }
  if(tag==='mtable'){
   let width=null;const rows=children.map(row=>{
    if(!['mtr','mlabeledtr'].includes(row.localName))throw new Error('矩阵含不支持的行');const cells=[...row.children];if(row.localName==='mlabeledtr')cells.shift();
    if(!cells.length||cells.some(cell=>cell.localName!=='mtd')||width!==null&&cells.length!==width)throw new Error('矩阵行列不完整');width=cells.length;const values=cells.map(cell=>group([...cell.children].map(child=>walk(child,depth+2))));
    return {omml:wrap('mr',values.map(v=>wrap('e',v.omml)).join('')),linear:values.map(v=>v.linear).join(',')};
   });if(!rows.length)throw new Error('矩阵为空');return {omml:wrap('m',rows.map(row=>row.omml).join('')),linear:'['+rows.map(row=>row.linear).join(';')+']'};
  }
  if(tag==='menclose'&&(node.getAttribute('notation')||'longdiv')==='box'){const p=group(parts());return {omml:wrap('borderBox',wrap('e',p.omml)),linear:'box('+p.linear+')'};}
  throw new Error('该识别公式包含尚不能无损转换的 MathML 元素：'+tag+'；原笔迹保留');
 };
 const result=walk(doc.documentElement);if(!result.linear.trim()||!result.omml)throw new Error('识别公式为空');return {linear:result.linear,omml:'<m:oMath xmlns:m="'+OM+'">'+result.omml+'</m:oMath>',sourceMathML:markup};
}
