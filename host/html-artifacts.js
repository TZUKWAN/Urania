/** Versioned HTML designs. The saved source is never executed by the host. */
import * as fs from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {join, posix} from 'node:path';
import {SafetyError, assertSafeJson, workspacePath} from './safety.js';
import {NativeSourceStore} from './native-source-store.js';
import {createZip, readZip} from './zip.js';
import {validateTailwindPreviewEvidence,TAILWIND_PREVIEW_SHA256,TAILWIND_LICENSE_SHA256} from './tailwind-preview.js';
import {validateHtmlFontOperation} from './html-font-contract.js';

const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024;
const MAX_RECORD = 34 * 1024 * 1024;
const ID = /^html-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REVISION = /^[a-f0-9]{64}$/;
const MIME = new Map(Object.entries({
 html:'text/html', htm:'text/html', css:'text/css', js:'text/javascript', mjs:'text/javascript',
 json:'application/json', svg:'image/svg+xml', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
 webp:'image/webp', gif:'image/gif', avif:'image/avif', ico:'image/x-icon', bmp:'image/bmp', map:'application/json', woff:'font/woff', woff2:'font/woff2',
 ttf:'font/ttf', otf:'font/otf', mp3:'audio/mpeg', mp4:'video/mp4', webm:'video/webm', txt:'text/plain', md:'text/markdown'
}));
const hash = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2));

function pathName(value) {
 if (typeof value !== 'string' || !value || value.length > 300 || value.startsWith('/') || /[\\:\0-\x1f]/.test(value)) {
  throw new SafetyError('网页资源路径无效', 422);
 }
 const parts = value.split('/');
 if (parts.length > 20 || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
  throw new SafetyError('网页资源路径不能越过作品目录', 422);
 }
 return value;
}

function validateFiles(input, entry) {
 if (!Array.isArray(input) || input.length < 1 || input.length > 256) throw new SafetyError('网页需要 1 至 256 个文件', 422);
 const names = new Set();
 let total = 0;
 const files = input.map(item => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new SafetyError('网页资源记录无效', 422);
  const path = pathName(item.path);
  const key = path.toLowerCase();
  if (names.has(key)) throw new SafetyError('网页资源路径重复', 422);
  names.add(key);
  const extension = posix.extname(path).slice(1).toLowerCase();
  // Preserve unfamiliar project files byte-for-byte, but serve them as inert
  // downloads; nosniff and the preview CSP do not grant executable privileges.
  const mime = MIME.get(extension) || 'application/octet-stream';
  if (typeof item.data !== 'string' || item.data.length > Math.ceil(MAX_FILE / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) {
   throw new SafetyError('网页资源必须是规范 Base64', 422);
  }
  const bytes = Buffer.from(item.data, 'base64');
  if (bytes.length > MAX_FILE || (total += bytes.length) > MAX_TOTAL) throw new SafetyError('网页文件超过大小预算', 413);
  if (item.bytes !== undefined && item.bytes !== bytes.length || item.sha256 !== undefined && item.sha256 !== hash(bytes)) {
   throw new SafetyError('网页资源内容与记录不一致', 422);
  }
  return {path, mime, bytes:bytes.length, sha256:hash(bytes), data:item.data};
 });
 const target = files.find(file => file.path === entry);
 if (!target || target.mime !== 'text/html') throw new SafetyError('请选择一个实际存在的 HTML 入口文件', 422);
 try { new TextDecoder('utf-8', {fatal:true}).decode(Buffer.from(target.data, 'base64')); }
 catch { throw new SafetyError('HTML 源必须使用 UTF-8 编码', 422); }
 return files;
}

export function previewFiles(files, entry) { return validateFiles(files, pathName(entry)); }

async function immutable(file, bytes, claim = false) {
 const temporary = file + '.tmp-' + randomUUID();
 let handle;
 try {
  handle = await fs.open(temporary, 'wx');
  await handle.writeFile(bytes);
  await handle.sync();
  await handle.close();
  handle = null;
  try { await fs.link(temporary, file); return true; }
  catch (error) {
   if (error.code !== 'EEXIST') throw error;
   if (claim) return false;
   if (hash(await fs.readFile(file)) !== hash(bytes)) throw new SafetyError('网页历史内容损坏，未覆盖原件', 409);
   return false;
  }
 } finally {
  await handle?.close();
  await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
 }
}

export function validateHtmlAssetOperation(operation,previous){
 assertSafeJson(operation);if(!operation||Object.keys(operation).some(key=>!['action','id','assetId','assetSha256','path','baseRevision'].includes(key))||operation.action!=='project-asset-apply'||!/^htmlassetop-[a-f0-9]{64}$/.test(operation.id||'')||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(operation.assetId||'')||!REVISION.test(operation.assetSha256||'')||!REVISION.test(operation.baseRevision||'')||operation.baseRevision!==previous)throw new SafetyError('网页素材加入操作回执无效',409);pathName(operation.path);return true;
}
export function validateTailwindFreezeOperation(operation,previous){
 assertSafeJson(operation);const allowed=['action','id','baseRevision','cssPath','cssSha256','cssBytes','licensePath','licenseSha256','entrySha256','evidence','scriptSha256'];
 if(!operation||Object.keys(operation).some(key=>!allowed.includes(key))||operation.action!=='tailwind-freeze'||!/^tailwindfreeze-[a-f0-9]{64}$/.test(operation.id||'')||!REVISION.test(operation.baseRevision||'')||operation.baseRevision!==previous||!REVISION.test(operation.cssSha256||'')||operation.cssPath!=='assets/tailwind-'+operation.cssSha256+'.css'||!Number.isSafeInteger(operation.cssBytes)||operation.cssBytes<1||operation.cssBytes>2*1024*1024||operation.licenseSha256!==TAILWIND_LICENSE_SHA256||operation.licensePath!=='assets/tailwind-3.4.17-'+TAILWIND_LICENSE_SHA256.slice(0,16)+'.license.txt'||!REVISION.test(operation.entrySha256||'')||operation.evidence!=='client-reported-css'||operation.scriptSha256!==TAILWIND_PREVIEW_SHA256)throw new SafetyError('Tailwind 样式保存操作回执无效',409);
 pathName(operation.cssPath);pathName(operation.licensePath);return true;
}

function validateRecord(record, id, previous) {
 assertSafeJson(record);
 if (!record || record.schema !== 1 || record.id !== id || record.parentRevision !== previous || typeof record.title !== 'string' || !record.title.trim() || record.title.length > 200) {
  throw new SafetyError('网页历史身份或名称无效', 422);
 }
 pathName(record.entry);
 validateFiles(record.files, record.entry);
 if(record.operation?.action==='project-asset-apply')validateHtmlAssetOperation(record.operation,previous);
 if(record.operation?.action==='tailwind-freeze')validateTailwindFreezeOperation(record.operation,previous);
 if(record.operation?.action==='project-font-attach')validateHtmlFontOperation(record.operation,previous);
 return record;
}

export class HtmlArtifacts {
 constructor(root) { this.root = root; }
 directory(id) {
  if (!ID.test(id || '')) throw new SafetyError('网页作品身份无效', 422);
  return workspacePath(this.root, join('design', '.designcraft', 'v2', 'html', id));
 }
 file(id, ...parts) { return workspacePath(this.root, join(this.directory(id), ...parts)); }
 async pointer(path) {
  try {
   const stat = await fs.stat(path);
   if (stat.size > 1024) throw new SafetyError('网页版本指针超过预算', 413);
   const value = JSON.parse(await fs.readFile(path, 'utf8'));
   if (!REVISION.test(value.revision || '')) throw new SafetyError('网页版本指针损坏', 422);
   return value.revision;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
 }
 async lineage(id) {
  const directory = this.directory(id), rows = [], seen = new Set();
  let revision = await this.pointer(this.file(id, 'root.json')), previous = null;
  while (revision) {
   if (seen.has(revision) || rows.length >= 10000) throw new SafetyError('网页版本链损坏或过长', 422);
   seen.add(revision);
   const file = workspacePath(this.root, join(directory, 'history', revision + '.json'), {mustExist:true});
   if ((await fs.stat(file)).size > MAX_RECORD) throw new SafetyError('网页版本超过预算', 413);
   const bytes = await fs.readFile(file);
   if (hash(bytes) !== revision) throw new SafetyError('网页版本完整性校验失败', 409);
   const value = validateRecord(JSON.parse(bytes), id, previous);
   rows.push({revision, value});
   previous = revision;
   revision = await this.pointer(this.file(id, 'next', revision + '.json'));
  }
  return rows;
 }
 async read(id, revision) {
  if (revision !== undefined && !REVISION.test(revision)) throw new SafetyError('网页修订无效', 422);
  const rows = await this.lineage(id);
  const item = revision ? rows.find(row => row.revision === revision) : rows.at(-1);
  if (!item) throw new SafetyError('网页作品或版本不存在', 404);
  return {revision:item.revision, document:item.value, historical:item.revision !== rows.at(-1).revision};
 }
 async list() {
  const directory = workspacePath(this.root, join('design', '.designcraft', 'v2', 'html'));
  let entries;
  try { entries = await fs.readdir(directory, {withFileTypes:true}); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (entries.length > 1000) throw new SafetyError('网页作品超过数量预算', 413);
  const result = [];
  for (const item of entries) {
   if (!item.isDirectory() || !ID.test(item.name)) continue;
   try {
    const {revision, document} = await this.read(item.name);
    result.push({id:item.name, revision, title:document.title, entry:document.entry, files:document.files.length, updatedAt:document.at});
   } catch (error) { result.push({id:item.name, error:String(error.message || error)}); }
  }
  return result.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
 }
 async create({title, entry, files, provenance}) {
  return this.save({id:'html-' + randomUUID(), baseRevision:null, title, entry, files, provenance});
 }
 async save({id, baseRevision, title, entry, files, provenance, operation}) {
  const directory = this.directory(id), rows = await this.lineage(id), head = rows.at(-1);
  if ((head?.revision || null) !== baseRevision) throw new SafetyError('网页已有新版本，请重新读取后保存；原稿未覆盖', 409);
  if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new SafetyError('网页名称无效', 422);
  pathName(entry);
  const value = {schema:1, id, parentRevision:baseRevision, title:title.trim(), entry, files:validateFiles(files, entry), at:new Date().toISOString()};
  if(operation!==undefined){if(operation?.action==='tailwind-freeze')validateTailwindFreezeOperation(operation,baseRevision);else if(operation?.action==='project-font-attach')validateHtmlFontOperation(operation,baseRevision);else validateHtmlAssetOperation(operation,baseRevision);value.operation=operation;}
  if (provenance !== undefined) {
   assertSafeJson(provenance);
   if (Buffer.byteLength(JSON.stringify(provenance)) > 8192) throw new SafetyError('网页来源记录超过预算', 413);
   value.provenance = provenance;
  } else if (head?.value.provenance) value.provenance = head.value.provenance;
  const body = encode(value);
  if (body.length > MAX_RECORD) throw new SafetyError('网页版本超过保存预算', 413);
  const revision = hash(body);
  await fs.mkdir(this.file(id, 'history'), {recursive:true});
  await fs.mkdir(this.file(id, 'next'), {recursive:true});
  await immutable(this.file(id, 'history', revision + '.json'), body);
  const pointer = head ? this.file(id, 'next', head.revision + '.json') : this.file(id, 'root.json');
  if (!await immutable(pointer, encode({revision}), true)) throw new SafetyError('另一窗口已保存网页，当前稿件仍在编辑器中', 409);
  return {id, revision, document:value};
 }
 async archive(id, revision) {
  const {document} = await this.read(id, revision);
  return createZip(document.files.map(file => ({name:file.path, data:Buffer.from(file.data, 'base64')})));
 }
 async conversions(id) {
  const directory = this.file(id, 'conversions');
  let names;
  try { names = await fs.readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (names.length > 5000) throw new SafetyError('网页转换记录超过预算', 413);
  const result = [];
  for (const name of names) {
   const match = /^([a-f0-9]{64})-([a-f0-9]{64})\.json$/.exec(name);
   if (!match) continue;
   const path = this.file(id, 'conversions', name);
   if ((await fs.stat(path)).size > 32768) throw new SafetyError('网页转换记录超过预算', 413);
   const value = JSON.parse(await fs.readFile(path, 'utf8'));
   if (value.id !== id || value.sourceRevision !== match[1] || value.sha256 !== match[2]) throw new SafetyError('网页转换记录损坏', 409);
   if(value.compatibility!==undefined)validateTailwindPreviewEvidence(value.compatibility);
   result.push(value);
  }
  return result.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
 }
 async conversion(id, revision, sha256) {
  if (!REVISION.test(revision || '') || !REVISION.test(sha256 || '')) throw new SafetyError('网页转换身份无效', 422);
  const metadata = (await this.conversions(id)).find(item => item.sourceRevision === revision && item.sha256 === sha256);
  if (!metadata) throw new SafetyError('网页转换记录不存在', 404);
  const path = this.file(id, 'conversions', sha256 + '.pptx');
  if ((await fs.stat(path)).size > 64 * 1024 * 1024) throw new SafetyError('转换文件超过预算', 413);
  const bytes = await fs.readFile(path);
  if (bytes.length !== metadata.bytes || hash(bytes) !== sha256) throw new SafetyError('网页转换文件完整性失败', 409);
  return {metadata, bytes};
 }
 async conversionCandidates({id, revision, sha256}) {
  await this.conversion(id, revision, sha256);
  const sources = new NativeSourceStore(this.root), matches = [];
  for (const source of await sources.list()) {
   if (source.error || source.engine !== 'deckcraft') continue;
   const file = workspacePath(this.root, join(sources.directory(source.id), 'originals', sha256 + '.pptx'));
   try {
    if ((await fs.stat(file)).size > 64 * 1024 * 1024) continue;
    if (hash(await fs.readFile(file)) === sha256) matches.push({sourceId:source.id, revision:source.revision, title:source.title});
   } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return matches;
 }
 async stageConversion({id, revision, bytes, compatibility}) {
  const current = await this.read(id);
  if (current.revision !== revision) throw new SafetyError('网页在转换期间已改变，请重新转换当前版本', 409);
  if(compatibility!==undefined)validateTailwindPreviewEvidence(compatibility);
  const report = inspectEditablePptx(bytes);
  const directory = this.file(id, 'conversions');
  await fs.mkdir(directory, {recursive:true});
  const digest = hash(bytes), value = {schema:1, id, sourceRevision:revision, sha256:digest, bytes:bytes.length, report, at:new Date().toISOString(),...(compatibility?{compatibility}:{})};
  await immutable(this.file(id, 'conversions', digest + '.pptx'), bytes);
  const metadata = this.file(id, 'conversions', revision + '-' + digest + '.json');
  try {
   const previous = JSON.parse(await fs.readFile(metadata, 'utf8'));
   if (previous.id !== id || previous.sourceRevision !== revision || previous.sha256 !== digest) throw new SafetyError('网页转换回执身份不一致', 409);
   if(previous.compatibility!==undefined)validateTailwindPreviewEvidence(previous.compatibility);
   const compatibilityConflict=JSON.stringify(previous.compatibility||null)!==JSON.stringify(compatibility||null);
   return {...previous,...(compatibilityConflict?{compatibilityConflict:true}:{})};
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await immutable(metadata, encode(value));
  return value;
 }
 async linkConversion({id, revision, sha256, sourceId}) {
  if (!REVISION.test(sha256 || '')) throw new SafetyError('转换文件摘要无效', 422);
  await this.read(id, revision);
  const directory = this.file(id, 'conversions');
  const metadata = JSON.parse(await fs.readFile(this.file(id, 'conversions', revision + '-' + sha256 + '.json'), 'utf8'));
  if (metadata.id !== id || metadata.sourceRevision !== revision || metadata.sha256 !== sha256) throw new SafetyError('网页转换来源不匹配', 409);
  if(metadata.compatibility!==undefined)validateTailwindPreviewEvidence(metadata.compatibility);
  const sources = new NativeSourceStore(this.root), source = await sources.read(sourceId);
  if (source.meta.engine !== 'deckcraft') throw new SafetyError('转换结果没有保存为演示原生源', 409);
  const original = workspacePath(this.root, join(sources.directory(sourceId), 'originals', sha256 + '.pptx'), {mustExist:true});
  if (hash(await fs.readFile(original)) !== sha256) throw new SafetyError('演示导入原件与网页转换结果不一致', 409);
  const link = {...metadata, deckSourceId:sourceId, deckRevision:source.revision, linkedAt:new Date().toISOString()};
  const linkPath = this.file(id, 'conversions', revision + '-' + sha256 + '-' + sourceId + '.json');
  try {
   const previous = JSON.parse(await fs.readFile(linkPath, 'utf8'));
   if (previous.sourceRevision !== revision || previous.sha256 !== sha256 || previous.deckSourceId !== sourceId) throw new SafetyError('演示导入回执身份不一致', 409);
   return previous;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await immutable(linkPath, encode(link));
  return link;
 }
}

/** Inspect actual OPC entries before accepting a browser-generated PPTX. */
export function inspectEditablePptx(bytes) {
 if (!Buffer.isBuffer(bytes) || bytes.length < 100 || bytes.length > 64 * 1024 * 1024) throw new SafetyError('转换后的演示文件为空或过大', 413);
 let entries;
 try { entries = readZip(bytes, {maxEntries:10000, maxEntryBytes:32 * 1024 * 1024, maxTotalBytes:128 * 1024 * 1024, maxSelectedBytes:32 * 1024 * 1024}); }
 catch (error) { throw new SafetyError('转换文件不是受支持的 PowerPoint 包：' + error.message, 422); }
 const names = new Set(entries.map(entry => entry.name));
 if (!names.has('[Content_Types].xml') || !names.has('ppt/presentation.xml')) throw new SafetyError('转换结果缺少演示结构', 422);
 const slides = entries.filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name));
 if (!slides.length || slides.length > 100) throw new SafetyError('转换结果没有有效幻灯片或页数超过预算', 422);
 let shapes = 0, pictures = 0, svgPictures = 0, texts = 0, vectors = 0;
 const embeddedFontCandidates = [], fontRelations = new Set();
 const fontParts = new Set(entries.filter(entry => /^ppt\/fonts\/[^/]+\.fntdata$/i.test(entry.name) && entry.data.length > 0).map(entry => entry.name));
 const decodeAttribute = value => value.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, entity => {
  const named = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
  if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
  const number = entity[2]?.toLowerCase()==='x' ? parseInt(entity.slice(3,-1),16) : parseInt(entity.slice(2,-1),10);
  return Number.isInteger(number)&&number>0&&number<=0x10ffff?String.fromCodePoint(number):'';
 });
 for (const entry of entries) {
  const name = entry.name;
  // ZIP writers commonly include empty folder entries such as ppt/embeddings/.
  // They are not embedded objects; non-empty or actual files stay restricted.
  if (name.endsWith('/')) {
   if (entry.data.length) throw new SafetyError('转换结果含非空目录条目，未导入', 422);
   continue;
  }
  if (/\.(?:bin|exe|dll|js|html?|vbs)$/i.test(name) || /(?:^|\/)(?:activeX|embeddings|oleObjects|externalLinks)(?:\/|$)/i.test(name)) throw new SafetyError('转换结果含活动或嵌入式外部对象，未导入', 422);
  if (/\.svg$/i.test(name)) vectors++;
  if (!/\.(?:xml|rels)$/i.test(name)) continue;
  let xml;
  try { xml = new TextDecoder('utf-8', {fatal:true}).decode(entry.data); }
  catch { throw new SafetyError('转换结果包含无效 XML 编码', 422); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new SafetyError('转换结果 XML 含文档类型或实体', 422);
  if (name === 'ppt/presentation.xml') {
   const list = xml.match(/<(?:[\w.-]+:)?embeddedFontLst(?=\s|>)[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?embeddedFontLst\s*>/i)?.[1] || '';
   for (const block of list.matchAll(/<(?:[\w.-]+:)?embeddedFont(?=\s|>)[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?embeddedFont\s*>/gi)) {
    const font = block[1].match(/<(?:[\w.-]+:)?font(?=\s|>)[^>]*\btypeface\s*=\s*(["'])(.*?)\1/i)?.[2];
    const ids = [...block[1].matchAll(/<(?:[\w.-]+:)?(?:regular|bold|italic|boldItalic)(?=\s|>)[^>]*\b(?:[\w.-]+:)?id\s*=\s*(["'])(.*?)\1/gi)].map(match=>match[2]);
    if (font && font.length<=400 && embeddedFontCandidates.length<256) embeddedFontCandidates.push({name:decodeAttribute(font), ids});
   }
  }
  if (name.endsWith('.rels')) {
   // Entity-encoded relationship targets are rejected rather than interpreted.
   if (/&/.test(xml) || /\bTargetMode\s*=\s*['"]\s*external\s*['"]/i.test(xml) || /\bTarget\s*=\s*['"]\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(xml)) throw new SafetyError('转换结果引用外部文件或网络资源，未导入', 422);
   if (name === 'ppt/_rels/presentation.xml.rels') for (const match of xml.matchAll(/<(?:[\w.-]+:)?Relationship(?=\s|>)[^>]*>/gi)) {
    const tag=match[0], attribute=key=>tag.match(new RegExp(`\\b${key}\\s*=\\s*(["'])(.*?)\\1`,'i'))?.[2];
    const id=attribute('Id'), target=attribute('Target'), type=attribute('Type');
    if (id && target && type?.endsWith('/font')) {
     const resolved=posix.normalize(posix.join('ppt',target));
     if (resolved.startsWith('ppt/fonts/') && fontParts.has(resolved)) fontRelations.add(id);
    }
   }
  }
  if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
   shapes += (xml.match(/<(?:[\w.-]+:)?sp(?=\s|>)/g) || []).length;
   const pictureBlocks = [...xml.matchAll(/<(?:[\w.-]+:)?pic(?=\s|>)[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?pic\s*>/g)];
   pictures += pictureBlocks.length;
   svgPictures += pictureBlocks.filter(block=>/<(?:[\w.-]+:)?svgBlip(?=\s|>)/i.test(block[0])).length;
   texts += (xml.match(/<(?:[\w.-]+:)?t(?=\s|>)/g) || []).length;
  }
 }
 if (!shapes) throw new SafetyError('转换结果没有可编辑的原生形状或文字，原网页已保留', 422);
 const embeddedFonts = [...new Set(embeddedFontCandidates.filter(item=>item.ids.some(id=>fontRelations.has(id))).map(item=>item.name))];
 return {slides:slides.length, nativeShapes:shapes, textRuns:texts, pictures, svgPictures, rasterPictures:pictures-svgPictures, svgMedia:vectors, embeddedFonts, fontParts:fontParts.size, note:'图片和 SVG 保留为媒体；网页脚本、动画和交互不会成为原生演示行为。'+(embeddedFonts.length?'已内嵌字体：'+embeddedFonts.join('、')+'。':'未检测到内嵌字体，目标环境可能需要提供字体。')};
}
