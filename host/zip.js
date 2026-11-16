/**
 * Minimal ZIP writer (deflate) + CRC32 — used by the PPTX exporter.
 * Zero-dependency: Node zlib only. Produces standard archives readable by
 * PowerPoint, Keynote, unzip, and Office Open XML consumers.
 */
import { deflateRawSync,inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
		table[n] = c;
	}
	return table;
})();

export function crc32(buffer) {
	let crc = -1;
	for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xFF];
	return (crc ^ -1) >>> 0;
}

/**
 * Build a zip archive. entries: [{ name: string, data: Buffer|string, dir?: boolean }]
 * Returns Buffer. Dates fixed to a valid DOS timestamp (2026-01-01 00:00:00).
 */
export function createZip(entries) {
	const chunks = [];
	const central = [];
	let offset = 0;
	const dosTime = (12 << 11);          // 12:00:00 (hour<<11 | min<<5 | sec/2)
	const dosDate = (46 << 9) | (1 << 5) | 1; // 2026-01-01
	for (const entry of entries) {
		const nameBytes = Buffer.from(entry.name, 'utf8');
		const data = entry.dir ? Buffer.alloc(0) : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
		const useDeflate = !entry.dir && !entry.store && data.length > 0;
		const compressed = useDeflate ? deflateRawSync(data, { level: 6 }) : data;
		const method = useDeflate ? 8 : 0;
		const crc = entry.dir ? 0 : crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);          // version needed
		local.writeUInt16LE(0x0800, 6);      // UTF-8 flag
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(dosTime, 10);
		local.writeUInt16LE(dosDate, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		local.writeUInt16LE(0, 28);
		chunks.push(local, nameBytes, compressed);
		const record = Buffer.alloc(46);
		record.writeUInt32LE(0x02014b50, 0);
		record.writeUInt16LE(20, 4);
		record.writeUInt16LE(20, 6);
		record.writeUInt16LE(0x0800, 8);
		record.writeUInt16LE(method, 10);
		record.writeUInt16LE(dosTime, 12);
		record.writeUInt16LE(dosDate, 14);
		record.writeUInt32LE(crc, 16);
		record.writeUInt32LE(compressed.length, 20);
		record.writeUInt32LE(data.length, 24);
		record.writeUInt16LE(nameBytes.length, 28);
		record.writeUInt16LE(0, 30); // extra
		record.writeUInt16LE(0, 32); // comment
		record.writeUInt16LE(0, 34); // disk
		record.writeUInt16LE(0, 36); // internal attrs
		record.writeUInt32LE(entry.dir ? 0x10 : 0, 38); // external attrs
		record.writeUInt32LE(offset, 42);
		central.push(Buffer.concat([record, nameBytes]));
		offset += local.length + nameBytes.length + compressed.length;
	}
	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20);
	return Buffer.concat([...chunks, centralBuf, end]);
}

/** Bounded in-memory reader used only for canonical native packages; never extracts paths. */
export function readZip(entriesBuffer,{maxEntries=8192,maxEntryBytes=64*1024*1024,maxTotalBytes=128*1024*1024,includeNames=null,maxSelectedBytes=maxEntryBytes}={}){
  const buffer=Buffer.isBuffer(entriesBuffer)?entriesBuffer:Buffer.from(entriesBuffer);if(buffer.length<22)throw new Error('ZIP header truncated');
  const selected=includeNames===null?null:new Set(includeNames);
  let end=-1;for(let at=buffer.length-22;at>=Math.max(0,buffer.length-65557);at--){if(buffer.readUInt32LE(at)===0x06054b50&&at+22+buffer.readUInt16LE(at+20)===buffer.length){end=at;break;}}
  if(end<0)throw new Error('ZIP end directory missing');
  const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16),length=buffer.readUInt32LE(end+12);
  if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||count!==buffer.readUInt16LE(end+8)||count===65535||offset===0xffffffff)throw new Error('Multi-disk/ZIP64 package unsupported');
  if(count>maxEntries||offset+length>end)throw new Error('ZIP directory exceeds budget');
  const result=[],seen=new Set();let position=offset,total=0;
  for(let index=0;index<count;index++){
    if(position+46>offset+length||buffer.readUInt32LE(position)!==0x02014b50)throw new Error('Invalid ZIP directory record');
    const flags=buffer.readUInt16LE(position+8),method=buffer.readUInt16LE(position+10),crc=buffer.readUInt32LE(position+16),compressed=buffer.readUInt32LE(position+20),size=buffer.readUInt32LE(position+24),nameLength=buffer.readUInt16LE(position+28),extra=buffer.readUInt16LE(position+30),comment=buffer.readUInt16LE(position+32),local=buffer.readUInt32LE(position+42);
    if(flags&1||![0,8].includes(method)||size>maxEntryBytes||(total+=size)>maxTotalBytes||compressed>buffer.length)throw new Error('ZIP entry exceeds supported budget');
    if(position+46+nameLength+extra+comment>offset+length)throw new Error('ZIP entry name truncated');
    const name=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(position+46,position+46+nameLength));
    if(!name||/^[\\/]|^[a-z]:|[\\\x00]/i.test(name)||name.split('/').includes('..')||seen.has(name.toLowerCase()))throw new Error('Invalid/duplicate ZIP entry path');seen.add(name.toLowerCase());
    if(local+30>offset||buffer.readUInt32LE(local)!==0x04034b50||buffer.readUInt16LE(local+8)!==method)throw new Error('Invalid ZIP local record');
    const dataStart=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);if(dataStart+compressed>offset)throw new Error('ZIP payload truncated');
    if(selected&&!selected.has(name)){position+=46+nameLength+extra+comment;continue;}
    if(size>maxSelectedBytes)throw new Error('Selected ZIP entry exceeds budget');
    const bytes=buffer.subarray(dataStart,dataStart+compressed),data=method===0?Buffer.from(bytes):inflateRawSync(bytes,{maxOutputLength:size||1});
    if(data.length!==size||crc32(data)!==crc)throw new Error('ZIP entry size/CRC mismatch');
    result.push({name,data,store:method===0});position+=46+nameLength+extra+comment;
  }
  if(position!==offset+length)throw new Error('ZIP directory length mismatch');return result;
}
