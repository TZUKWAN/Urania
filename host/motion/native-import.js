/** Immutable, verified project material -> motion media with exact source provenance. */
import {NativeSourceStore} from '../native-source-store.js';
import {ProjectGraph} from '../project-graph.js';
import {saveAsset} from './asset-store.js';
import {SchemaError} from './schema.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {workspacePath} from '../safety.js';

/** Trusted compatibility helper for an explicitly saved local output.
 * Registered AI imports use importSavedNativeAsset and its graph proof instead.
 */
export function importNativeAsset(root,nativePath,engine,sourceId,revision) {
 if(!fs.existsSync(nativePath))throw new SchemaError('E_NATIVE_MISSING','Native output file is missing',404);
 const file=workspacePath(root,nativePath,{mustExist:true});
 if(!fs.statSync(file).isFile()||fs.statSync(file).size>30*1024*1024)throw new SchemaError('E_NATIVE_SIZE','Native output exceeds the input budget');
 const ext=path.extname(file).slice(1).toLowerCase();
 if(!['svg','png','jpg','jpeg','html'].includes(ext))throw new SchemaError('E_NATIVE_EXT','Unsupported native output extension');
 const bytes=fs.readFileSync(file),originalSha256=createHash('sha256').update(bytes).digest('hex');
 const saved=saveAsset(root,{name:path.basename(file),kind:'image',bytes,license:'native-import',source:{engine,sourceId,revision,originalSha256,sourceKind:'explicit-local-output'}});
 return {...saved,nativeSource:{engine,sourceId,revision,originalSha256}};
}

export async function importSavedNativeAsset(root, assetId) {
 if(!/^asset-[a-f0-9-]{36}$/.test(assetId||''))throw new SchemaError('E_NATIVE_ASSET','An actual saved project assetId is required');
 const graph=new ProjectGraph(root,new NativeSourceStore(root)),{asset,bytes}=await graph.asset(assetId);
 if(!['svg','png'].includes(asset.format))throw new SchemaError('E_NATIVE_FORMAT','Derive an actual PNG or SVG from the saved native source first');
 const project=await graph.read();
 const nativeSource={projectId:project.manifest.id,projectAssetId:asset.id,engine:asset.engine,sourceId:asset.sourceId,revision:asset.sourceRevision,sourceHash:asset.sourceHash,derivativeSha256:asset.sha256};
 const name=asset.id+'.'+asset.format,saved=saveAsset(root,{name,kind:'image',bytes,license:'native-import',source:{kind:'native-import',...nativeSource}});
 if(saved.sha256!==asset.sha256)throw new SchemaError('E_NATIVE_HASH','Native derivative hash does not match saved material');
 return {...saved,path:'assets/'+name,nativeSource};
}
