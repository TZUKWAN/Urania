/** Optional pinned source data for the OD-linked canvas-design skill. */
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SafetyError,assertSafeJson} from './safety.js';

const ROOT=fileURLToPath(new URL('../resources/canvas-design/',import.meta.url));
const OD_ID='skills/canvas-design',REV='2c5958ecac7cee2b583967a2c4981d0f4a75c579';
const LOCK_SHA='db254671b6070ca6b090b08897691c289dc2d0b99ff9e1ffb1232ff6943b1ead';
const ARCHIVE_SHA='7c51b4a775bee79e39f0be47b924e1a758a92cf5a5d27084048489a4a31a70d1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function canvasDesignSeed(odId,revision){
 if(odId!==OD_ID||revision&&revision!==REV)return null;
 try{
  const raw=readFileSync(join(ROOT,'source-lock.json'));
  if(raw.length>65536||sha(raw)!==LOCK_SHA)throw new Error('固定索引摘要不一致');
  const lock=JSON.parse(raw.toString('utf8'));assertSafeJson(lock);
  if(lock.schema!==1||lock.repository!=='anthropics/skills'||lock.revision!==REV||lock.archive!=='canvas-design.zip'||lock.archiveSha256!==ARCHIVE_SHA||lock.fileCount!==83||lock.receipt?.odId!==OD_ID||lock.receipt?.revision!==REV||lock.receipt?.sha256!==ARCHIVE_SHA)throw new Error('固定来源身份不一致');
  const path=join(ROOT,lock.archive),size=statSync(path).size;
  if(size!==lock.archiveBytes||size>64*1024*1024)throw new Error('固定原包大小不一致');
  const archive=readFileSync(path);if(sha(archive)!==ARCHIVE_SHA)throw new Error('固定原包摘要不一致');
  return {receipt:lock.receipt,archive};
 }catch(error){if(error instanceof SafetyError)throw error;throw new SafetyError('离线海报设计原包不可用：'+error.message,503);}
}
