/**
 * Motion `.dcmotion` package — safe ZIP export/import of editable projects.
 * Export: manifest + sources + params + asset files + licenses, from an exact revision.
 * Import: strict ZIP inspection (traversal, symlinks, case collisions, budgets,
 * executable extensions, missing assets/hashes), then commit as a NEW local project.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { validateProjectId, validateRevisionManifest, SchemaError } from './schema.js';
import { readHeadRevision, readRevision, readSourceBytes, commitRevision } from './project-store.js';
import { readAssetBytes, saveAsset } from './asset-store.js';
import {assertSafeJson} from '../safety.js';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ---------------- minimal zip (store + deflate) ---------------- */

const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
	return t;
})();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF]; return (c ^ -1) >>> 0; };

export function buildZip(entries) {
	const chunks = [], central = [];
	let offset = 0;
	const dosDate = (46 << 9) | (1 << 5) | 1, dosTime = 12 << 11;
	for (const e of entries) {
		const nameBytes = Buffer.from(e.name, 'utf8');
		const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
		const comp = e.store ? data : deflateRawSync(data);
		const method = e.store ? 0 : 8;
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(method, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
		local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
		chunks.push(local, nameBytes, comp);
		const cen = Buffer.alloc(46);
		cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
		cen.writeUInt16LE(method, 10); cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14);
		cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
		cen.writeUInt16LE(nameBytes.length, 28);
		cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
		central.push(Buffer.concat([cen, nameBytes]));
		offset += local.length + nameBytes.length + comp.length;
	}
	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
	return Buffer.concat([...chunks, centralBuf, end]);
}

export function readZip(buf,{maxEntryBytes=MAX_ENTRY_BYTES,maxTotalBytes=MAX_ZIP_BYTES,maxEntries=MAX_ZIP_ENTRIES}={}) {
	// locate EOCD
	if (buf.length < 22 || buf.readUInt32LE(buf.length - 22) !== 0x06054b50) throw new Error('bad zip: no EOCD');
	const eocd = buf.length - 22;
	const count = buf.readUInt16LE(eocd + 10);
	if(count>maxEntries)throw new Error('too many zip entries');
	let ptr = buf.readUInt32LE(eocd + 16);
	const entries = [];let expanded=0;
	for (let i = 0; i < count; i++) {
		if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('bad zip: central entry');
		const method = buf.readUInt16LE(ptr + 10);
		if(![0,8].includes(method)||buf.readUInt16LE(ptr+8)&1)throw new Error('unsupported zip method/encryption');
		const compSize = buf.readUInt32LE(ptr + 20);
		const size=buf.readUInt32LE(ptr+24),mode=buf.readUInt32LE(ptr+38)>>>16;
		if((mode&0o170000)===0o120000)throw new Error('zip symbolic links refused');
		if(size>maxEntryBytes||(expanded+=size)>maxTotalBytes)throw new Error('zip expansion exceeds budget');
		const nameLen = buf.readUInt16LE(ptr + 28);
		const extraLen = buf.readUInt16LE(ptr + 30);
		const commentLen = buf.readUInt16LE(ptr + 32);
		const localOff = buf.readUInt32LE(ptr + 42);
		const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
		const lPtr = localOff;
		if (buf.readUInt32LE(lPtr) !== 0x04034b50) throw new Error('bad zip: local entry');
		const lNameLen = buf.readUInt16LE(lPtr + 26);
		const lExtraLen = buf.readUInt16LE(lPtr + 28);
		const dataStart = lPtr + 30 + lNameLen + lExtraLen;
		if(dataStart+compSize>buf.length||buf.toString('utf8',lPtr+30,lPtr+30+lNameLen)!==name||buf.readUInt16LE(lPtr+8)!==method)throw new Error('zip local/central mismatch');
		const raw = buf.subarray(dataStart, dataStart + compSize);
		// Limit expansion during decompression, before allocating a hostile
		// entry. Post-inflate length checks alone do not bound memory.
		const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw,{maxOutputLength:Math.min(maxEntryBytes,maxTotalBytes-(expanded-size))+1});
		if(data.length!==size||crc32(data)!==buf.readUInt32LE(ptr+16))throw new Error('zip size/checksum mismatch');
		entries.push({ name, data });
		ptr += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}

/* ---------------- export ---------------- */

export function exportDcmotion(root, projectId) {
	validateProjectId(projectId);
	const head = readHeadRevision(root, projectId);
	const manifest = readRevision(root, projectId, head.revision);
	const entries = [{ name: 'manifest.json', data: JSON.stringify({ ...manifest, format: 'dcmotion', exporter: 'designcraft' }, null, 1) }];
	for (const rel of Object.keys(manifest.sources)) {
		entries.push({ name: 'sources/' + rel, data: readSourceBytes(root, projectId, manifest, rel) });
	}
	const includedAssets=new Set();
	for (const a of manifest.assets || []) {
		if(includedAssets.has(a.sha256))continue;includedAssets.add(a.sha256);
		const { bytes, meta } = readAssetBytes(root, a.sha256);
		entries.push({ name: 'assets/' + a.sha256 + '/' + (meta.name || 'asset'), data: bytes, store: true });
		entries.push({ name: 'assets/' + a.sha256 + '/meta.json', data: JSON.stringify(meta, null, 1) });
	}
	entries.push({ name: 'SHA256SUMS.txt', data: entries.filter(e => e.name !== 'SHA256SUMS.txt').map(e => sha256(e.data) + '  ' + e.name).join('\n') + '\n' });
	const zip = buildZip(entries);
	return { buffer: zip, manifest, fileCount: entries.length };
}

/* ---------------- import ---------------- */

const MAX_ZIP_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2048;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const EXE_EXT = /\.(exe|bat|cmd|ps1|sh|dll|so|msi|scr|com|vbs|node)$/i;

export function inspectDcmotion(buf) {
	if (!Buffer.isBuffer(buf) || buf.length === 0) throw new SchemaError('E_EMPTY', 'empty package');
	if (buf.length > MAX_ZIP_BYTES) throw new SchemaError('E_TOO_BIG', 'package exceeds budget');
	let raw;
	try { raw = readZip(buf); } catch (e) { throw new SchemaError('E_ZIP', 'not a valid zip: ' + e.message); }
	if (raw.length > MAX_ZIP_ENTRIES) throw new SchemaError('E_COUNT', 'too many entries');
	const seen = new Map();
	for (const e of raw) {
		if (e.name.includes('\\')) throw new SchemaError('E_SEP', 'backslash entry: ' + e.name);
		if (e.name.startsWith('/') || /^[a-zA-Z]:/.test(e.name)) throw new SchemaError('E_ABS', 'absolute entry: ' + e.name);
		const parts = e.name.split('/');
		if (parts.some(p => p === '..' || p === '.' || p === '')) throw new SchemaError('E_TRAVERSAL', 'traversal entry: ' + e.name);
		if (EXE_EXT.test(e.name)) throw new SchemaError('E_EXEC', 'executable entry: ' + e.name);
		if (/(^|\/)\.env/i.test(e.name)) throw new SchemaError('E_ENV', '.env entry refused: ' + e.name);
		if (e.data.length > MAX_ENTRY_BYTES) throw new SchemaError('E_ENTRY_BIG', 'entry exceeds budget: ' + e.name);
		const key = e.name.toLowerCase();
		if (seen.has(key)) throw new SchemaError('E_CASE', 'case-insensitive collision: ' + e.name);
		seen.set(key, e);
	}
	const manifestEntry = seen.get('manifest.json');
	if (!manifestEntry) throw new SchemaError('E_NO_MANIFEST', 'manifest.json missing');
	if(manifestEntry.data.length>8*1024*1024)throw new SchemaError('E_MANIFEST_BUDGET','manifest exceeds budget');
	const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
	if (manifest.format !== 'dcmotion') throw new SchemaError('E_FORMAT', 'not a dcmotion package');
	// secret scan
	const scan = manifestEntry.data.toString('utf8');
	for (const pattern of [/session-[0-9a-f-]{36}/i, /DC_[A-Z_]+KEY/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/]) {
		if (pattern.test(scan)) throw new SchemaError('E_SECRET', 'possible DSH identity/credential in manifest: ' + pattern);
	}
	assertSafeJson(manifest);validateRevisionManifest(manifest);
	for(const [rel,expected] of Object.entries(manifest.sources)){
		const entry=seen.get(('sources/'+rel).toLowerCase());
		if(!entry||entry.data.length!==expected.bytes||sha256(entry.data)!==expected.sha256)throw new SchemaError('E_SOURCE_HASH','source missing or hash mismatch: '+rel);
	}
	for(const asset of manifest.assets||[]){
		const matches=[...seen.values()].filter(e=>e.name.toLowerCase().startsWith('assets/'+asset.sha256+'/')&&!e.name.toLowerCase().endsWith('/meta.json'));
		if(matches.length!==1||sha256(matches[0].data)!==asset.sha256||asset.bytes!==undefined&&asset.bytes!==matches[0].data.length)throw new SchemaError('E_ASSET_HASH','asset missing or hash mismatch: '+asset.sha256);
	}
	return { raw: seen, manifest };
}

/** Import a dcmotion buffer into root as a NEW local project. Returns new {projectId, revision}. */
export function importDcmotion(root, buf) {
	const { raw, manifest } = inspectDcmotion(buf);
	// allocate a fresh local projectId
	const newId = 'motion-' + crypto.randomUUID();
	// re-stage assets into local asset store (content-addressed, idempotent)
	for (const a of manifest.assets || []) {
		const entry=[...raw.values()].find(e=>e.name.toLowerCase().startsWith('assets/'+a.sha256+'/')&&!e.name.toLowerCase().endsWith('/meta.json'));
		const saved=saveAsset(root, { name: a.name || path.basename(entry.name), kind: a.kind, bytes: entry.data, license: a.license, source: {kind:'dcmotion-import',...(a.nativeSource?{nativeSource:a.nativeSource}:{})} });
		if(saved.sha256!==a.sha256)throw new SchemaError('E_ASSET_HASH','imported asset hash mismatch');
	}
	// rebuild sources map (strip sources/ prefix)
	const sources = {};
	for (const [rel, expected] of Object.entries(manifest.sources)) {
		const entry=raw.get(('sources/'+rel).toLowerCase());
		sources[rel]=expected.encoding==='binary'?entry.data:entry.data.toString('utf8');
	}
	if (!Object.keys(sources).length) throw new SchemaError('E_NO_SOURCES', 'package has no sources/');
	const committed = commitRevision(root, newId, {
		baseRevision: null, title: manifest.title + ' (imported)',
		entryFile: manifest.entryFile, render: manifest.render, sources,
		parameters: manifest.parameters, assets: manifest.assets
	});
	// verify package asset hashes match committed manifest
	for (const a of committed.assets || []) {
		const { bytes } = readAssetBytes(root, a.sha256);
		if (sha256(bytes) !== a.sha256) throw new SchemaError('E_ASSET_HASH', 'imported asset hash mismatch');
	}
	return { projectId: newId, revision: committed.revision, title: committed.title };
}
