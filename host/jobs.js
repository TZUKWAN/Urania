import {spawn} from 'node:child_process';
import {nativeRunnerExecutable} from './native.js';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertSafeJson, SafetyError} from './safety.js';
const WORKER=fileURLToPath(new URL('./job-worker.js',import.meta.url));

export class JobSupervisor {
  constructor({concurrency=2,timeoutMs=30000,workerPath=WORKER,onChange=()=>{},parameterBudgetBytes=64*1024*1024}={}) {
    this.concurrency=concurrency;this.timeoutMs=timeoutMs;this.workerPath=workerPath;this.onChange=onChange;
    this.queue=[];this.active=new Map();this.records=new Map();this.disposed=false;this.parameterBytes=0;this.parameterBudgetBytes=parameterBudgetBytes;
  }
  list(root) {return [...this.records.values()].filter(job=>job.root===root).map(({root,...job})=>job);}
  emit(record) {try{this.onChange({...record});}catch{}}
  run(kind,payload,{signal}={}) {
    if(this.disposed)return Promise.reject(new SafetyError('计算服务已停止',503));
    assertSafeJson(payload);
    const input=JSON.stringify({kind,payload})+'\n',parameterBytes=Buffer.byteLength(input);
    if(parameterBytes>20*1024*1024)return Promise.reject(new SafetyError('单次计算参数超过20MB预算，请分批或使用文件资产',413));
    if(this.parameterBytes+parameterBytes>this.parameterBudgetBytes)return Promise.reject(new SafetyError('后台任务参数总量超过内存预算，请等待现有任务完成',429));
    if(this.queue.length>=32)return Promise.reject(new SafetyError('后台任务已满，请稍后重试',429));
    const id='job-'+randomUUID(),record={id,root:payload.root,kind,status:'queued',createdAt:new Date().toISOString()};
    return new Promise((resolve,reject)=>{
      const job={id,kind,root:payload.root,input,parameterBytes,record,resolve,reject,signal};
      job.abort=()=>this.cancel(id);
      if(signal?.aborted){reject(new SafetyError('任务已取消',499));return;}
      this.parameterBytes+=parameterBytes;
      signal?.addEventListener('abort',job.abort,{once:true});
      this.records.set(id,record);this.queue.push(job);this.emit(record);this.pump();
    });
  }
  pump() {
    while(!this.disposed&&this.active.size<this.concurrency&&this.queue.length) {
      const job=this.queue.shift();this.start(job);
    }
  }
  async start(job) {
    job.record.status='running';job.record.startedAt=new Date().toISOString();this.active.set(job.id,job);this.emit(job.record);
    let child;
    try{
      const runner=process.platform==='win32'?await nativeRunnerExecutable():null;
      if(job.finished||this.disposed)return;
      const executable=runner||process.execPath;
      const args=[...(runner?['--memory-mb','512','--',process.execPath]:[]),'--max-old-space-size=384',this.workerPath];
      child=spawn(executable,args,{cwd:job.root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,NODE_OPTIONS:'',ELECTRON_RUN_AS_NODE:'1'}});
    }catch(error){this.finish(job,error);return;}
    job.child=child;
    child.stdout.setEncoding('utf8');
    job.timer=setTimeout(()=>{job.failure=new SafetyError('后台任务超时，操作结果可能已提交，请检查作品版本后重试。',504);child.kill();},this.timeoutMs);
    let buffer='';
    child.stdout.on('data',chunk=>{
      try{
        buffer+=chunk.toString('utf8');if(Buffer.byteLength(buffer)>24*1024*1024)throw new SafetyError('后台结果超过24MB预算',413);
        let index;while((index=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line)continue;const message=JSON.parse(line);
          if(message.type==='progress'){job.record.progress=message.progress;this.emit(job.record);}
          else if(message.type==='result')job.result=message.result;
          else if(message.type==='failure'){job.failure=new SafetyError(message.error,message.status);job.failure.current=message.current;}
          else throw new SafetyError('后台响应协议错误',502);
        }
      }catch(error){job.failure=error;child.kill();}
    });
    child.stderr.on('data',chunk=>{job.stderr=(job.stderr||'').slice(-4000)+chunk.toString().slice(-4000);});
    for(const stream of [child.stdin,child.stdout,child.stderr])stream.on('error',error=>{job.failure=error;child.kill();});
    child.once('error',error=>{job.failure=error;});
    child.once('close',(code,signal)=>{
      if(!job.failure&&job.result===undefined)job.failure=new SafetyError('后台进程未返回结果（'+(signal||code)+'），请检查作品版本后重试。',502);
      this.finish(job,job.failure,job.result);
    });
    child.stdin.end(job.input);job.input=null;
  }

  finish(job,error,result) {
    if(job.finished)return;job.finished=true;
    this.parameterBytes-=job.parameterBytes;job.input=null;
    clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);this.active.delete(job.id);
    job.record.status=error?(job.cancelled?'cancelled':'failed'):(result?.results?.some(r=>!r.ok)?'completed-with-errors':'completed');
    job.record.finishedAt=new Date().toISOString();
    if(error)job.record.error=error.message;
    this.emit(job.record);
    if(error){error.jobId=job.id;job.reject(error);}else job.resolve({...result,jobId:job.id});
    if(this.records.size>200)for(const [id,record] of this.records) {if(!['queued','running'].includes(record.status)){this.records.delete(id);if(this.records.size<=160)break;}}
    this.pump();
  }
  cancel(id) {
    const queued=this.queue.findIndex(job=>job.id===id);
    if(queued>=0){const [job]=this.queue.splice(queued,1);job.cancelled=true;this.finish(job,new SafetyError('任务已取消',499));return true;}
    const job=this.active.get(id);if(!job)return false;
    job.cancelled=true;job.failure=new SafetyError('任务已取消，可能已有部分操作提交，请检查作品版本。',499);if(job.child)job.child.kill();else this.finish(job,job.failure);return true;
  }
  dispose() {
    this.disposed=true;
    for(const job of [...this.queue])this.cancel(job.id);
    for(const id of this.active.keys())this.cancel(id);
  }
}
