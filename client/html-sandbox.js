/** Isolated HTML preview and DOM-to-PPTX capture. No source runs in the DSH origin. */
const MAX_HTML = 8 * 1024 * 1024;
const MAX_PPTX = 64 * 1024 * 1024;
const TAILWIND_SHA256='176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15';
const TAILWIND_SRI='sha256-F26JRmGqnNyaXLpscgBEy797i9gNHJoUKnwksbbFDRU=';
const tailwindTag=()=>/<script\s+src\s*=\s*(["'])https:\/\/cdn\.tailwindcss\.com(?:\/3\.4\.17)?\1\s*>\s*<\/script\s*>/gi;
export const hasSupportedTailwindTag=html=>{if(typeof html!=='string')return false;const pattern=tailwindTag();return pattern.test(html)&&!pattern.test(html);};
const attribute = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const inlineScript = fn => '(' + fn.toString() + ')();';

function previewShell() {
 const params = new URLSearchParams(location.hash.slice(1));
 const token = params.get('token');
 let frame;
 addEventListener('message', event => {
  if (event.source === parent && event.data?.token === token && event.data.type === 'render') {
   frame?.remove();
   frame = document.createElement('iframe');
   frame.setAttribute('sandbox', 'allow-scripts');
   frame.setAttribute('title', '网页设计预览');
   frame.style.cssText = 'display:block;border:0;width:100%;height:100%;background:white';
   frame.srcdoc = event.data.document;
   document.body.append(frame);
  } else if (event.source === parent && event.data?.token === token && event.data.type === 'snapshot') {
   frame?.contentWindow?.postMessage(event.data, '*');
  } else if (event.source === frame?.contentWindow && event.data?.token === token && ['preview-ready','preview-compat-error','snapshot-result'].includes(event.data.type)) {
   parent.postMessage(event.data, '*');
  }
 });
 parent.postMessage({type:'preview-shell-ready', token}, '*');
}

function previewBridge() {
 const token = document.currentScript.dataset.token;
 const tailwindRequested=document.currentScript.dataset.dcTailwindRequested==='1';
 addEventListener('error',event=>{if(event.target?.tagName==='SCRIPT'&&event.target.dataset?.dcTailwind==='1')parent.postMessage({type:'preview-compat-error',token},'*');},true);
 addEventListener('load', () => {
  if(!tailwindRequested){parent.postMessage({type:'preview-ready',token},'*');return;}
  let done=false,observer,timer,quietTimer;
  const finish=ready=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(quietTimer);observer?.disconnect();parent.postMessage({type:ready?'preview-ready':'preview-compat-error',token,...(ready?{}:{reason:'style'})},'*');};
  const check=()=>{clearTimeout(quietTimer);const style=[...document.querySelectorAll('style')].find(node=>/tailwindcss\s+v3\.4\.17/i.test(node.textContent||''));if(style){const current=style.textContent;quietTimer=setTimeout(()=>{if(style.isConnected&&style.textContent===current)finish(true);else check();},750);}};
  observer=new MutationObserver(check);observer.observe(document.head,{childList:true,subtree:true,characterData:true});
  timer=setTimeout(()=>finish(false),12000);check();
 }, {once:true});
 addEventListener('message', event => {
  if (event.source !== parent || event.data?.token !== token || event.data.type !== 'snapshot') return;
  const doctype = document.doctype ? '<!DOCTYPE ' + document.doctype.name + '>\n' : '<!DOCTYPE html>\n';
  const clone = document.documentElement.cloneNode(true), warnings = [];
  const canvases = document.querySelectorAll('canvas'), copies = clone.querySelectorAll('canvas');
  canvases.forEach((canvas, index) => {
   try {
    const data = canvas.toDataURL('image/png');
    if (data.length > 8 * 1024 * 1024 || data === 'data:,') throw new Error('画布无可导出像素');
    const image = document.createElement('img');
    for (const item of [...copies[index].attributes]) if (!/^on/i.test(item.name)) image.setAttribute(item.name, item.value);
    image.src = data;image.setAttribute('data-designcraft-rasterized', 'canvas');copies[index].replaceWith(image);
   } catch { warnings.push('一个画布无法提取当前像素，转换时可能为空。'); }
  });
  if (canvases.length) warnings.push('网页画布按当前画面作为位图导入，原网页保持可运行。');
  if (document.querySelector('video,audio')) warnings.push('网页音视频不会自动转换为可播放的演示媒体。');
  let tailwindCss;
  if(tailwindRequested){
   const styles=[...document.querySelectorAll('style')].filter(node=>/tailwindcss\s+v3\.4\.17/i.test(node.textContent||''));
   if(styles.length===1&&new TextEncoder().encode(styles[0].textContent||'').length<=2*1024*1024)tailwindCss=styles[0].textContent;
   else warnings.push('未找到唯一且不超过 2 MiB 的 Tailwind 预览样式，无法保存静态样式。');
  }
  parent.postMessage({type:'snapshot-result', token, requestId:event.data.requestId, html:doctype + clone.outerHTML, warnings,...(tailwindCss!==undefined?{tailwindCss}:{})}, '*');
 });
}

function converterBridge(token, parentOrigin) {
 let busy = false;
 addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== parentOrigin || event.data?.token !== token || event.data.type !== 'convert' || busy) return;
  busy = true;
  const requestId = event.data.requestId;
  try {
   const parsed = new DOMParser().parseFromString(event.data.html, 'text/html');
   const warnings = [];
   const active = parsed.querySelectorAll('script,iframe,object,embed,applet,portal,base,meta[http-equiv]');
   if (active.length) warnings.push('交互脚本、表单和嵌套页面不会转换为演示行为。');
   active.forEach(node => node.remove());
   for (const form of parsed.querySelectorAll('form')) form.replaceWith(...form.childNodes);
   const css = [...parsed.querySelectorAll('style')].map(node => node.textContent).join('\n');
   if (/@import\s+(?:url\()?\s*['"]?(?:https?:|\/\/)/i.test(css) || /url\(\s*['"]?(?:https?:|\/\/)/i.test(css)) warnings.push('外部样式或资源不会联网加载，可能影响转换外观。');
   if (/@(?:keyframes|font-face)|(?:animation|filter|backdrop-filter|mix-blend-mode)\s*:/i.test(css)) warnings.push('动画、滤镜、混合模式和字体效果可能无法完整保留，请核对转换结果。');
   let external = 0;
   for (const element of parsed.querySelectorAll('*')) {
    for (const item of [...element.attributes]) {
     if (/^on/i.test(item.name) || item.name === 'srcdoc') { element.removeAttribute(item.name); continue; }
     if (!['href','src','poster','action','formaction','xlink:href'].includes(item.name.toLowerCase())) continue;
     const value = item.value.trim();
     if (value.startsWith('#') || value.startsWith('data:') || value.startsWith(event.data.resourcePrefix)) continue;
     if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value)) { external++; element.removeAttribute(item.name); }
    }
   }
   if (external) warnings.push('有 ' + external + ' 个外部引用未导入，原网页保留。');
   const sheetWaits = [];
   for (const child of [...parsed.head.children]) {
    if (child.tagName === 'STYLE') document.head.append(document.importNode(child, true));
    else if (child.tagName === 'LINK' && child.rel.toLowerCase() === 'stylesheet') {
     if (sheetWaits.length >= 256) throw new Error('网页样式表超过转换预算');
     const node = document.importNode(child, true), raw = node.getAttribute('href');
     let href;try { href = new URL(raw, document.baseURI).href; } catch { href = ''; }
     if (!href.startsWith(event.data.resourcePrefix)) { warnings.push('一个外部样式表未载入。');continue; }
     node.setAttribute('crossorigin', 'anonymous');node.setAttribute('href', href);
     const ready = new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 15000);
      node.addEventListener('load', () => { clearTimeout(timer);resolve(true); }, {once:true});
      node.addEventListener('error', () => { clearTimeout(timer);resolve(false); }, {once:true});
     });
     sheetWaits.push(ready);document.head.append(node);
    }
   }
   const sheetResults = await Promise.all(sheetWaits);
   if (sheetResults.some(result => !result)) warnings.push('部分本地样式表未能载入，转换外观可能变化。');
   // CSSOM may serialize a font URL relative to its stylesheet even after a
   // write. Pass resolved scoped URLs explicitly to the upstream embedder.
   const declaredFonts = new Map(), visitedSheets = new WeakSet(), fontWarnings=new Set();let fontRuleCount=0;
   const fontWarning=message=>{if(fontWarnings.has(message))return;if(fontWarnings.size>=100){const omitted='更多字体样式提示已省略。';if(!fontWarnings.has(omitted)){fontWarnings.add(omitted);warnings.push(omitted);}return;}fontWarnings.add(message);warnings.push(message);};
   const firstCssFamily=value=>{
    if(typeof value!=='string'||value.length>16384)return null;
    let quote='',end=value.length;
    for(let i=0;i<value.length;i++){
     const char=value[i];
     if(char==='\\'){if(++i>=value.length)return null;if(value[i]==='\r'&&value[i+1]==='\n')i++;continue;}
     if(quote){if(char===quote)quote='';continue;}
     if(char==='"'||char==="'"){quote=char;continue;}
     if(char===','){end=i;break;}
    }
    if(quote)return null;
    let text=value.slice(0,end).trim();if(!text)return '';
    if(text[0]==='"'||text[0]==="'"){if(text.length<2||text.at(-1)!==text[0])return null;text=text.slice(1,-1);}
    return text.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\r\n\f])|([^\r\n\f]))/gi,(_match,hex,newline,escaped)=>{
     if(newline)return '';if(!hex)return escaped;
     let point=parseInt(hex,16);if(!point||point>0x10ffff||point>=0xd800&&point<=0xdfff)point=0xfffd;return String.fromCodePoint(point);
    });
   };
   const collectFontRules = (rules, base, depth = 0) => {
    if (depth > 12) throw new Error('字体样式嵌套超过转换预算');
    for (const rule of rules) {
     if(++fontRuleCount>50000)throw new Error('字体样式规则超过转换预算');
     if(rule.type===3){
      let href,imported;try{href=new URL(rule.href,base).href;imported=rule.styleSheet;}catch{fontWarning('一个导入样式表无法读取，可能遗漏字体。');continue;}
      if(!href.startsWith(event.data.resourcePrefix)){fontWarning('外部导入样式表不在当前网页资源范围内。');continue;}
      if(!imported){fontWarning('一个本地导入样式表尚未加载，可能遗漏字体。');continue;}
      collectFontSheet(imported,href,depth+1);continue;
     }
     if (rule.type === 5 && rule.style) {
      const name = firstCssFamily(rule.style.getPropertyValue('font-family'));
      const source = rule.style.getPropertyValue('src');
      if(name===null||name.length>400||source.length>16384){fontWarning('一个字体声明无法解析或超过读取预算，可能遗漏字体。');continue;}
      const candidates = [...source.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map(match => match[2]);
      let chosen = null;
      for (const raw of candidates) {
       try {
        const resolved = new URL(raw, base).href;
        if (resolved.startsWith(event.data.resourcePrefix) && /\.(?:ttf|otf|woff2?)(?:[?#]|$)/i.test(resolved)) { chosen = resolved;break; }
       } catch {}
      }
      if (name && chosen) {
       const key = name.toLowerCase(), item = declaredFonts.get(key) || {name, urls:new Set()};
       item.urls.add(chosen);declaredFonts.set(key,item);
      } else if (name && candidates.length) fontWarning('字体 '+name+' 的文件不在当前网页资源范围内，可能使用替代字体。');
     } else {
      let nested;try{nested=rule.cssRules;}catch{fontWarning('一个样式组无法读取，可能遗漏字体。');continue;}
      if(nested)collectFontRules(nested,base,depth+1);
     }
    }
   };
   const collectFontSheet=(sheet,fallbackBase,depth)=>{
    if(depth>12)throw new Error('字体样式嵌套超过转换预算');
    if(visitedSheets.has(sheet))return;visitedSheets.add(sheet);
    let base,rules;try{base=sheet.href?new URL(sheet.href,fallbackBase).href:fallbackBase;if(sheet.href&&!base.startsWith(event.data.resourcePrefix)){fontWarning('外部导入样式表不在当前网页资源范围内。');return;}rules=sheet.cssRules;}
    catch{fontWarning('一个样式表的字体声明无法读取，可能使用替代字体。');return;}
    if(!rules){fontWarning('一个样式表的字体声明不可用，可能使用替代字体。');return;}
    collectFontRules(rules,base,depth);
   };
   for (const sheet of [...document.styleSheets]) {
    collectFontSheet(sheet,document.baseURI,0);
   }
   for (const item of [...parsed.body.attributes]) if (!/^on/i.test(item.name)) document.body.setAttribute(item.name, item.value);
   document.body.replaceChildren(...[...parsed.body.childNodes].map(node => document.importNode(node, true)));
   // SVG exposes className as SVGAnimatedString, while the upstream animation
   // reader expects a string. Shadow only the JS accessor in this disposable
   // document; attributes and serialized vector contents remain unchanged.
   for (const element of document.querySelectorAll('svg,svg *')) {
    if (typeof element.className !== 'string') Object.defineProperty(element, 'className', {
     configurable:true, get() { return element.getAttribute('class') || ''; }
    });
   }
   document.querySelectorAll('.progress-bar,.notes-overlay,aside.notes,.speaker-notes,.deck-nav,.deck-hint,.deck-counter').forEach(node => node.remove());
   const selector = '.slide,[data-screen-label],.deck-slide,.ppt-slide';
   let slides = [...document.querySelectorAll(selector)].filter(node => !node.closest('.mini-slide,.overview,.notes-overlay,.thumb'));
   if (!slides.length) slides = [document.body];
   if (slides.length > 100) throw new Error('网页演示超过 100 页预算');
   const freeze = document.createElement('style');
   freeze.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
   document.head.append(freeze);
   for (const slide of slides) {
    slide.style.setProperty('opacity', '1', 'important');
    slide.style.setProperty('visibility', 'visible', 'important');
    slide.style.setProperty('display', 'block', 'important');
    if (slides.length > 1) {
     slide.style.setProperty('position', 'absolute', 'important');
     slide.style.setProperty('left', '0', 'important');
     slide.style.setProperty('top', '0', 'important');
    }
    for (const name of ['active','visible','is-active','current']) slide.classList.add(name);
   }
   await Promise.race([document.fonts.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('网页字体尚未就绪')), 15000))]);
   // Chromium can suspend animation frames in an off-screen cross-origin
   // sandbox. Force layout and use a bounded timer fallback instead of waiting
   // forever for an animation frame that may never be delivered.
   for (const slide of slides) slide.getBoundingClientRect();
   const rendered = () => new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
    const timer = setTimeout(finish, 150);
    requestAnimationFrame(finish);
   });
   await rendered();await rendered();
   if (typeof window.domToPptx?.exportToPptx !== 'function') throw new Error('网页转演示模块未加载');
   const usedFonts = new Set(), elements = new Set();
   for (const slide of slides) for (const element of [slide, ...slide.querySelectorAll('*')]) {
    if (elements.has(element)) continue;elements.add(element);
    if (elements.size > 20000) throw new Error('网页元素超过转换预算');
    const primary = firstCssFamily(getComputedStyle(element).fontFamily);
    if(primary===null){fontWarning('一个计算字体族无法解析，可能遗漏字体。');continue;}
    if (primary) usedFonts.add(primary.toLowerCase());
   }
   const fonts = [...declaredFonts].filter(([key]) => usedFonts.has(key)).map(([, item]) => ({name:item.name, urls:[...item.urls]}));
   if (fonts.length > 32 || fonts.reduce((sum, item) => sum + item.urls.length, 0) > 64) throw new Error('网页字体依赖超过转换预算');
   const blob = await window.domToPptx.exportToPptx(slides, {fileName:'网页演示.pptx', skipDownload:true, fonts, autoEmbedFonts:false, svgAsVector:true});
   if (!blob || typeof blob.arrayBuffer !== 'function' || blob.size > 64 * 1024 * 1024) throw new Error('网页转换未返回可用的演示文件');
   const bytes = await blob.arrayBuffer();
   const summary = {slides:slides.length, sourceTextElements:document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li').length,
    sourceSvg:document.querySelectorAll('svg,img[src$=".svg"]').length, sourceImages:document.querySelectorAll('img,canvas').length, requestedFonts:fonts.map(item=>item.name), warnings};
   parent.postMessage({type:'converted', token, requestId, bytes, summary}, parentOrigin, [bytes]);
  } catch (error) {
   parent.postMessage({type:'conversion-error', token, requestId, error:String(error?.message || error)}, parentOrigin);
  } finally { busy = false; }
 });
 parent.postMessage({type:'converter-ready', token}, parentOrigin);
}

export function bootConverterShell({token, parentOrigin, resourcePrefix}) {
 let started = false;
 addEventListener('message', event => {
  if (started || event.source !== parent || event.origin !== parentOrigin || event.data?.token !== token || event.data.type !== 'boot-converter') return;
  try {
   if (event.data.resourcePrefix !== resourcePrefix || typeof event.data.script !== 'string' || !event.data.script.startsWith('data:text/javascript;base64,') || event.data.script.length > 16 * 1024 * 1024) throw new Error('转换器启动参数无效');
   let parentAccessible = false;try { void parent.document;parentAccessible = true; } catch {}
   if (parentAccessible) throw new Error('转换器来源未与 DSH 隔离，已拒绝运行');
   started = true;const script = document.createElement('script');script.src = event.data.script;
   script.onload = () => converterBridge(token, parentOrigin);
   script.onerror = () => parent.postMessage({type:'conversion-error', token, error:'网页转换模块未能加载'}, parentOrigin);
   document.head.append(script);
  } catch (error) { parent.postMessage({type:'conversion-error', token, error:String(error?.message || error)}, parentOrigin); }
 });
 parent.postMessage({type:'converter-shell-ready', token}, parentOrigin);
}

function shellSource(token, resourcePrefix) {
 // A child inherits every ancestor CSP. Allow only this preview's scoped files
 // here as well, otherwise the outer shell silently blocks CSS/JS/images/base.
 const policy = "default-src 'none'; script-src 'unsafe-inline' data: " + resourcePrefix + "; style-src 'unsafe-inline' " + resourcePrefix +
  "; img-src data: blob: " + resourcePrefix + "; font-src data: " + resourcePrefix + "; media-src data: blob: " + resourcePrefix +
  "; connect-src data: blob: " + resourcePrefix + "; worker-src 'none'; frame-src about:; child-src about:; base-uri " + resourcePrefix + "; form-action 'none'";
 return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + attribute(policy) + '">' +
  '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}</style>' +
  '<script>' + inlineScript(previewShell).replace('location.hash.slice(1)', JSON.stringify('token=' + token)) + '<\/script>';
}

function childSource(html, token, resourcePrefix, entry, tailwindPath) {
 if(tailwindPath!==undefined){
  if(!/^__dc-tailwind-[a-f0-9]{24}\.js$/.test(tailwindPath)||!hasSupportedTailwindTag(html))throw new Error('入口缺少唯一受支持的 Tailwind CDN 标签，未启用兼容预览');
  html=html.replace(tailwindTag(),()=>'<script src="'+attribute(resourcePrefix+tailwindPath)+'" crossorigin="anonymous" integrity="'+TAILWIND_SRI+'" data-dc-tailwind="1"><\/script>');
 }
 const directory = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
 const base = resourcePrefix + directory.split('/').map(encodeURIComponent).join('/');
 const policy = "default-src 'none'; script-src 'unsafe-inline' data: " + resourcePrefix + "; style-src 'unsafe-inline' " + resourcePrefix +
  "; img-src data: blob: " + resourcePrefix + "; font-src data: " + resourcePrefix + "; media-src data: blob: " + resourcePrefix +
  "; connect-src data: blob: " + resourcePrefix + "; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri " + resourcePrefix;
 return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + attribute(policy) + '"><base href="' + attribute(base) + '">' +
  '<script data-token="' + attribute(token) + '"'+(tailwindPath!==undefined?' data-dc-tailwind-requested="1"':'')+'>' + inlineScript(previewBridge) + '<\/script>' + html;
}

export function conversionWarnings(captured, source, report) {
 const warnings = [...(Array.isArray(captured?.warnings)?captured.warnings:[]), ...(Array.isArray(source?.warnings)?source.warnings:[])];
 const actual = new Set((Array.isArray(report?.embeddedFonts)?report.embeddedFonts:[]).map(name=>String(name).toLowerCase()));
 const missing = (Array.isArray(source?.requestedFonts)?source.requestedFonts:[]).filter(name=>typeof name==='string'&&!actual.has(name.toLowerCase()));
 if (missing.length) warnings.push('以下网页字体未检测到嵌入演示：'+missing.join('、')+'；目标环境可能使用替代字体。');
 if (Number.isInteger(report?.rasterPictures) && report.rasterPictures > (source?.sourceImages || 0)) warnings.push('演示含 '+report.rasterPictures+' 个位图对象；部分网页效果可能已栅格化，不能按原生形状编辑。');
 return [...new Set(warnings)];
}

export function preparePreview(frame, {html, token, resourcePrefix, entry, tailwindPath, tailwindSha256}) {
 if (typeof html !== 'string' || new TextEncoder().encode(html).length > MAX_HTML) throw new Error('网页正文为空或超过 8 MiB');
 if(tailwindPath!==undefined&&tailwindSha256!==TAILWIND_SHA256)throw new Error('Tailwind 预览脚本摘要不一致');
 const nonce = crypto.randomUUID();
 const child = childSource(html, nonce, resourcePrefix, entry, tailwindPath);
 return new Promise((resolve, reject) => {
  let timeout;
  const stop = () => { clearTimeout(timeout); removeEventListener('message', onMessage); };
  const onMessage = event => {
   if (event.source !== frame.contentWindow || event.data?.token !== nonce) return;
   if (event.data.type === 'preview-shell-ready') frame.contentWindow.postMessage({type:'render', token:nonce, document:child}, '*');
   else if (event.data.type === 'preview-compat-error') { stop();reject(new Error(event.data.reason==='style'?'未确认 Tailwind 兼容样式生成，请检查后再转换':'Tailwind 兼容脚本未能在隔离预览中加载')); }
   else if (event.data.type === 'preview-ready') { stop();resolve({nonce, resourceToken:token,tailwindUsed:tailwindPath!==undefined}); }
  };
  addEventListener('message', onMessage);
  timeout = setTimeout(() => { stop();reject(new Error('网页预览未完成启动')); }, 20000);
  frame.srcdoc = shellSource(nonce, resourcePrefix);
 });
}

export function capturePreview(frame, nonce) {
 const requestId = crypto.randomUUID();
 return new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { removeEventListener('message', receive);reject(new Error('网页没有返回当前渲染状态')); }, 15000);
  const receive = event => {
   if (event.source !== frame.contentWindow || event.data?.token !== nonce || event.data?.requestId !== requestId || event.data.type !== 'snapshot-result') return;
   clearTimeout(timeout);removeEventListener('message', receive);
   if (typeof event.data.html !== 'string' || new TextEncoder().encode(event.data.html).length > MAX_HTML) reject(new Error('网页渲染状态超过预算'));
   else resolve({html:event.data.html, warnings:Array.isArray(event.data.warnings)?event.data.warnings:[],...(typeof event.data.tailwindCss==='string'&&new TextEncoder().encode(event.data.tailwindCss).length<=2*1024*1024?{tailwindCss:event.data.tailwindCss}:{})});
  };
  addEventListener('message', receive);
  frame.contentWindow.postMessage({type:'snapshot', token:nonce, requestId}, '*');
 });
}

export async function convertPreview({html, resourcePrefix, entry, converter, converterOrigin}) {
 if (typeof converter !== 'string' || !converter || typeof html !== 'string' || new TextEncoder().encode(html).length > MAX_HTML) throw new Error('网页或转换器内容无效');
 const nonce = crypto.randomUUID(), requestId = crypto.randomUUID();
 const converterBytes = new TextEncoder().encode(converter), chunks = [];
 for (let i=0;i<converterBytes.length;i+=0x8000) chunks.push(String.fromCharCode(...converterBytes.subarray(i,i+0x8000)));
 const script = 'data:text/javascript;base64,' + btoa(chunks.join(''));
 const frame = document.createElement('iframe');
 frame.title = '网页演示转换';
 frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
 frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1600px;height:900px;opacity:0;pointer-events:none;border:0';
 const resource = new URL(resourcePrefix), isolated = new URL(converterOrigin);
 const match = /^\/designcraft\/html-content\/([a-f0-9]{48})\/$/.exec(resource.pathname);
 if (!match || resource.origin !== location.origin || resource.search || resource.hash || isolated.origin === location.origin || !/^https?:$/.test(isolated.protocol)) throw new Error('网页转换隔离来源无效');
 const url = new URL('/designcraft/html-converter-shell', isolated.origin);
 url.searchParams.set('preview', match[1]);url.searchParams.set('nonce', nonce);url.searchParams.set('entry', entry);
 frame.src = url.href;document.body.append(frame);
 try {
  return await new Promise((resolve, reject) => {
   const timeout = setTimeout(() => { removeEventListener('message', receive);reject(new Error('网页转演示超时，原稿已保留')); }, 120000);
   const finish = () => { clearTimeout(timeout);removeEventListener('message', receive); };
   const receive = event => {
    if (event.source !== frame.contentWindow || event.origin !== isolated.origin || event.data?.token !== nonce) return;
    if (event.data.type === 'converter-shell-ready') frame.contentWindow.postMessage({type:'boot-converter', token:nonce, script, resourcePrefix}, isolated.origin);
    else if (event.data.type === 'converter-ready') frame.contentWindow.postMessage({type:'convert', token:nonce, requestId, html, resourcePrefix}, isolated.origin);
    else if ((event.data.requestId === requestId || !event.data.requestId) && event.data.type === 'conversion-error') { finish();reject(new Error(event.data.error)); }
    else if (event.data.requestId === requestId && event.data.type === 'converted') {
     finish();
     if (!(event.data.bytes instanceof ArrayBuffer) || event.data.bytes.byteLength > MAX_PPTX) reject(new Error('网页转换结果超过预算'));
     else resolve({bytes:event.data.bytes, summary:event.data.summary});
    }
   };
   addEventListener('message', receive);
  });
 } finally { frame.remove(); }
}
