/** Compact tool-facing fences retain the exact immutable native base issued by state.
 * Resolving an old ticket never refreshes it: the manager/frame still validate that
 * original full base against the current native document, selection, page and tool.
 */
import {createHash} from 'node:crypto';
import {sameUint64} from '../client/native-protocol.js';
import {SafetyError} from './safety.js';
const PREFIX='ctx-v1-';
const clone=value=>JSON.parse(JSON.stringify(value));
const refuse=()=>{throw new SafetyError('执行凭据已变化、缺失或回收；请调用 state 并完整复制新的 view.sourceId、view.epoch、view.base，保留当前编辑器。',409);};
export class EditorFenceTickets{
 constructor({maxEntries=128,maxBytes=4*1024*1024}={}){this.entries=new Map();this.bytes=0;this.maxEntries=maxEntries;this.maxBytes=maxBytes;}
 issue(sessionId,view){
  const record={sessionId,sourceId:view.sourceId,epoch:view.epoch,base:clone(view.base)};
  const serialized=JSON.stringify(record),bytes=Buffer.byteLength(serialized);
  if(bytes>1024*1024||bytes>this.maxBytes)throw new SafetyError('完整执行基线超过预算，未签发凭据',413);
  const ticket=PREFIX+createHash('sha256').update(serialized).digest('hex');
  if(this.entries.has(ticket)){this.bytes-=this.entries.get(ticket).bytes;this.entries.delete(ticket);}
  this.entries.set(ticket,{record,bytes});this.bytes+=bytes;
  while(this.entries.size>this.maxEntries||this.bytes>this.maxBytes){const oldest=this.entries.keys().next().value;this.bytes-=this.entries.get(oldest).bytes;this.entries.delete(oldest);}
  return {...clone(record.base),selectionStamp:ticket};
 }
 resolve(sessionId,args){
  const requested=args.base;if(typeof requested?.selectionStamp!=='string'||!requested.selectionStamp.startsWith(PREFIX))return args;
  const entry=this.entries.get(requested.selectionStamp),record=entry?.record;if(!record||record.sessionId!==sessionId||record.sourceId!==args.sourceId||record.epoch!==args.epoch)refuse();
  const expected=record.base;
  if(JSON.stringify(Object.keys(requested).sort())!==JSON.stringify(Object.keys(expected).sort())||!sameUint64(requested.uid,expected.uid)||!sameUint64(requested.revision,expected.revision)||requested.engine!==expected.engine)refuse();
  if(expected.selection!==undefined&&(!Array.isArray(requested.selection)||requested.selection.length!==expected.selection.length||requested.selection.some((id,i)=>!sameUint64(id,expected.selection[i]))))refuse();
  return {...args,base:clone(expected)};
 }
}
