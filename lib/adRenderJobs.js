// Render jobs: "ask an agent -> receive a finished file". An agent (or the board) asks for an MP4, a still or an evidence
// pack of an ad; a worker (scripts/render-worker.mjs, anywhere with Chromium, ffmpeg and the same KV credentials) claims
// the job, reports progress, and attaches the result files. The job keeps a snapshot of the ad project, so editing the ad
// afterwards does not change a render in flight. Pure state machine plus an injectable store (same shape as the other
// libraries). Result files are chunked, checksummed and expire after a week; keep one by saving it to the media library.
import {randomBytes,createHash} from 'node:crypto';
import {normalizeExportOptions} from './adExport.js';
import {EVIDENCE_LIMITS} from './adEvidence.js';

export const JOB_KINDS=Object.freeze(['mp4','still','evidence']);
export const JOB_STATES=Object.freeze(['queued','running','succeeded','failed','canceled']);
export const JOB_LIMITS=Object.freeze({
  maxJobs:30,            // retained per account (oldest finished ones are dropped)
  maxActive:3,           // queued or running at once, per account
  fileTtlSec:7*24*3600,
  chunkBytes:384*1024,
  maxFileBytes:64*1024*1024,
  staleSec:120,          // a running job with no heartbeat this long is failed as WORKER_LOST
  maxProjectChars:400000,
});
const ID=/^rnd-[a-z0-9]{6,16}$/;
const fail=(message,status=400,code='RENDER_INVALID')=>Object.assign(new Error(message),{status,code});
const jobsKey=u=>{if(typeof u!=='string'||!u)throw fail('Authenticated account required.',401,'UNAUTHORIZED');return 'nexus:ad-render-jobs:v1:'+encodeURIComponent(u);};
const projKey=(u,id)=>`nexus:ad-render-project:v1:${encodeURIComponent(u)}:${id}`;
const fileKey=(u,id)=>`nexus:ad-render-files:v1:${encodeURIComponent(u)}:${id}`;
const QUEUE='nexus:ad-render-queue:v1', CLAIMS='nexus:ad-render-claims:v1';
const sha=b=>createHash('sha256').update(b).digest('hex');

/** Quality presets: "preview" is a light motion preview for people; "final" is the real export. */
export function normalizeRenderOptions(kind,input={}){
  if(!JOB_KINDS.includes(kind))throw fail(`kind must be one of ${JOB_KINDS.join(', ')}.`);
  const o=input||{};
  if(kind==='mp4'){
    const preview=(o.quality||'final')==='preview';
    if(o.quality!==undefined&&!['preview','final'].includes(o.quality))throw fail('quality must be preview or final.');
    const merged={...(preview?{fps:24,scale:1,crf:28}:{}),...(o.fps!==undefined?{fps:o.fps}:{}),...(o.scale!==undefined?{scale:o.scale}:{}),...(o.crf!==undefined?{crf:o.crf}:{})};
    try{const n=normalizeExportOptions({...merged,audio:null});return {quality:preview?'preview':'final',fps:n.fps,scale:n.scale,crf:n.crf,...(typeof o.track_id==='string'?{track_id:o.track_id}:{}),...(typeof o.audio_media_id==='string'?{audio_media_id:o.audio_media_id}:{})};}
    catch(e){throw fail(e.message);}
  }
  if(kind==='still'){
    const out={scale:o.scale===undefined?1:Number(o.scale)};
    if(![1,2,3].includes(out.scale))throw fail('scale must be 1, 2 or 3.');
    if(o.at!==undefined&&o.scene!==undefined)throw fail('Use at or scene, not both.');
    if(o.at!==undefined){if(typeof o.at!=='number'||!(o.at>=0))throw fail('at must be seconds, 0 or more.');out.at=o.at;}
    if(o.scene!==undefined){if(typeof o.scene!=='string')throw fail('scene must be a scene id.');out.scene=o.scene;if(o.progress!==undefined){if(typeof o.progress!=='number'||o.progress<0||o.progress>1)throw fail('progress must be 0 to 1.');out.progress=o.progress;}}
    return out;
  }
  const maxFrames=o.max_frames===undefined?EVIDENCE_LIMITS.defaultFrames:o.max_frames,scale=o.scale===undefined?1:Number(o.scale);
  if(!Number.isInteger(maxFrames)||maxFrames<EVIDENCE_LIMITS.minFrames||maxFrames>EVIDENCE_LIMITS.maxFrames)throw fail(`max_frames must be a whole number from ${EVIDENCE_LIMITS.minFrames} to ${EVIDENCE_LIMITS.maxFrames}.`);
  if(![1,2].includes(scale))throw fail('scale must be 1 or 2.');
  return {max_frames:maxFrames,scale};
}
const view=r=>{const {cancel_requested,worker,...rest}=r;return {...rest,cancel_requested:!!cancel_requested,active:r.status==='queued'||r.status==='running'};};

export function createRenderJobStore({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts),now=Date.now,newId=()=>'rnd-'+randomBytes(5).toString('hex')}={}){
  const read=async(user,id)=>{
    if(typeof id!=='string'||!ID.test(id))throw fail('A valid job_id is required.');
    const raw=await command(['HGET',jobsKey(user),id]);
    if(!raw)throw fail('Render job not found.',404,'RENDER_NOT_FOUND');
    return JSON.parse(raw);
  };
  const write=(user,r)=>command(['HSET',jobsKey(user),r.job_id,JSON.stringify(r)]);
  const all=async user=>(await command(['HVALS',jobsKey(user)])||[]).map(raw=>JSON.parse(raw));
  const reap=async(user,r)=>{ // a worker that went silent must not leave a job "running" forever
    if(r.status==='running'&&now()-(r.heartbeat_at||r.started_at||0)>JOB_LIMITS.staleSec*1000){
      r.status='failed';r.finished_at=now();r.error={code:'WORKER_LOST',message:'The render worker stopped reporting. Start the render again.'};
      await write(user,r);await command(['HDEL',QUEUE,r.job_id]);
    }
    return r;
  };
  async function create(user,{kind,campaign_id,project,baseline,options}){
    if(!project||typeof project!=='object')throw fail('A project is required.');
    const text=JSON.stringify(project);
    if(text.length>JOB_LIMITS.maxProjectChars)throw fail('That ad is too large to render as a job.',413,'RENDER_TOO_LARGE');
    const opts=normalizeRenderOptions(kind,options);
    const rows=await Promise.all((await all(user)).map(r=>reap(user,r)));
    if(rows.filter(r=>r.status==='queued'||r.status==='running').length>=JOB_LIMITS.maxActive)throw fail(`You already have ${JOB_LIMITS.maxActive} renders in progress. Wait for one to finish or cancel it.`,409,'RENDER_BUSY');
    const finished=rows.filter(r=>!(r.status==='queued'||r.status==='running')).sort((a,b)=>a.created_at-b.created_at);
    while(rows.length>=JOB_LIMITS.maxJobs&&finished.length){const old=finished.shift();rows.splice(rows.indexOf(old),1);await command(['HDEL',jobsKey(user),old.job_id]);await command(['DEL',projKey(user,old.job_id)]);await command(['DEL',fileKey(user,old.job_id)]);}
    const job_id=newId();
    if(!ID.test(job_id))throw fail('Could not create a job id.',500,'RENDER_ID');
    const record={job_id,kind,status:'queued',campaign_id:campaign_id||null,baseline:baseline||null,options:opts,created_at:now(),progress:{stage:'queued',pct:0,frames_done:0,frames_total:0},files:[]};
    await command(['SET',projKey(user,job_id),text,'EX',String(JOB_LIMITS.fileTtlSec)]);
    await write(user,record);
    await command(['HSET',QUEUE,job_id,JSON.stringify({user,created_at:record.created_at})]);
    return view(record);
  }
  async function cancel(user,id){
    const r=await reap(user,await read(user,id));
    if(r.status==='queued'){r.status='canceled';r.finished_at=now();r.progress={...r.progress,stage:'canceled'};await write(user,r);await command(['HDEL',QUEUE,id]);}
    else if(r.status==='running'){r.cancel_requested=true;await write(user,r);}
    else throw fail(`This render is already ${r.status}.`,409,'RENDER_FINISHED');
    return view(r);
  }
  const api={
    create,cancel,
    async get(user,id){return view(await reap(user,await read(user,id)));},
    async list(user){const rows=await Promise.all((await all(user)).map(r=>reap(user,r)));return {jobs:rows.sort((a,b)=>b.created_at-a.created_at).map(view),limit:JOB_LIMITS.maxJobs};},
    async chunk(user,id,name,index){
      const r=await read(user,id),f=r.files.find(x=>x.name===name);
      if(r.status!=='succeeded')throw fail('This render has no files yet.',409,'RENDER_NOT_READY');
      if(!f)throw fail(`No file named ${name}. Files: ${r.files.map(x=>x.name).join(', ')||'none'}.`,404,'RENDER_FILE_NOT_FOUND');
      if(!Number.isInteger(index)||index<0||index>=f.chunks)throw fail(`index must be a whole number from 0 to ${f.chunks-1}.`);
      const data=await command(['HGET',fileKey(user,id),`${name}:${index}`]);
      if(!data)throw fail('This file has expired. Render again.',410,'RENDER_EXPIRED');
      return {job_id:id,name,index,chunks:f.chunks,sha256:f.sha256,bytes:f.bytes,data_base64:data};
    },
    /** A whole result file as a Buffer (chunks joined and checked against the stored SHA-256). */
    async file(user,id,name){
      const r=await read(user,id),f=r.files.find(x=>x.name===name);
      if(r.status!=='succeeded'||!f)throw fail(f?'This render has no files yet.':`No file named ${name}.`,f?409:404,'RENDER_FILE_NOT_FOUND');
      const parts=[];
      for(let i=0;i<f.chunks;i++){const d=await command(['HGET',fileKey(user,id),`${name}:${i}`]);if(!d)throw fail('This file has expired. Render again.',410,'RENDER_EXPIRED');parts.push(Buffer.from(d,'base64'));}
      const buf=Buffer.concat(parts);
      if(sha(buf)!==f.sha256)throw fail('Stored file failed its checksum.',500,'RENDER_CORRUPT');
      return {buffer:buf,file:f};
    },
    // ---- worker side ----
    /** Take the oldest queued job; returns {user,job,project} or null. First writer wins the claim. */
    async claim(workerId){
      const entries=await command(['HGETALL',QUEUE])||[];
      const queued=[];
      for(let i=0;i<entries.length;i+=2){try{queued.push({id:entries[i],...JSON.parse(entries[i+1])});}catch{/* skip */}}
      queued.sort((a,b)=>a.created_at-b.created_at);
      for(const q of queued){
        const won=Number(await command(['HSETNX',CLAIMS,q.id,workerId]));
        if(!won)continue;
        const r=await read(q.user,q.id).catch(()=>null);
        if(!r||r.status!=='queued'){await command(['HDEL',QUEUE,q.id]);continue;}
        r.status='running';r.started_at=now();r.heartbeat_at=now();r.worker=workerId;r.progress={...r.progress,stage:'starting'};
        await write(q.user,r);await command(['HDEL',QUEUE,q.id]);
        const project=JSON.parse(await command(['GET',projKey(q.user,q.id)])||'null');
        if(!project){await api.fail(q.user,q.id,{code:'PROJECT_EXPIRED',message:'The ad snapshot is gone. Start the render again.'});continue;}
        return {user:q.user,job:view(r),project};
      }
      return null;
    },
    /** Worker heartbeat + progress. Returns {cancel_requested}. */
    async progress(user,id,p={}){
      const r=await read(user,id);
      if(r.status!=='running')return {cancel_requested:true,status:r.status};
      const total=Math.max(0,Math.round(p.frames_total??r.progress.frames_total)),done=Math.max(0,Math.min(total||Infinity,Math.round(p.frames_done??r.progress.frames_done)));
      r.progress={stage:String(p.stage||r.progress.stage).slice(0,40),frames_done:done,frames_total:total,pct:total?Math.round(done/total*100):(p.pct??r.progress.pct)};
      r.heartbeat_at=now();
      await write(user,r);
      return {cancel_requested:!!r.cancel_requested,status:r.status};
    },
    async putFile(user,id,{name,mime,buffer}){
      const r=await read(user,id);
      if(r.status!=='running')throw fail('Only a running render can receive files.',409,'RENDER_NOT_RUNNING');
      if(!/^[a-zA-Z0-9._-]{1,80}$/.test(name||''))throw fail('File name must be letters, digits, dot, dash or underscore.');
      if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>JOB_LIMITS.maxFileBytes)throw fail(`File must be 1 byte to ${JOB_LIMITS.maxFileBytes/1048576} MB.`,413,'RENDER_FILE_SIZE');
      const chunks=Math.ceil(buffer.length/JOB_LIMITS.chunkBytes);
      for(let i=0;i<chunks;i++)await command(['HSET',fileKey(user,id),`${name}:${i}`,buffer.subarray(i*JOB_LIMITS.chunkBytes,(i+1)*JOB_LIMITS.chunkBytes).toString('base64')]);
      await command(['EXPIRE',fileKey(user,id),String(JOB_LIMITS.fileTtlSec)]);
      r.files=[...r.files.filter(f=>f.name!==name),{name,mime:String(mime||'application/octet-stream').slice(0,60),bytes:buffer.length,sha256:sha(buffer),chunks}];
      r.heartbeat_at=now();await write(user,r);
      return r.files[r.files.length-1];
    },
    async complete(user,id,result={}){
      const r=await read(user,id);
      if(r.status!=='running')throw fail(`Cannot complete a ${r.status} render.`,409,'RENDER_NOT_RUNNING');
      if(!r.files.length)throw fail('A render must attach at least one file before it completes.');
      r.status='succeeded';r.finished_at=now();r.progress={...r.progress,stage:'done',pct:100};r.result=result;
      await write(user,r);return view(r);
    },
    async fail(user,id,error){
      const r=await read(user,id);
      if(r.status==='succeeded'||r.status==='failed'||r.status==='canceled')return view(r);
      r.status=r.cancel_requested&&error?.code==='CANCELED'?'canceled':'failed';r.finished_at=now();
      r.error={code:String(error?.code||'RENDER_FAILED').slice(0,40),message:String(error?.message||'The render failed.').slice(0,600),...(error?.details?{details:String(error.details).slice(-1500)}:{})};
      await write(user,r);await command(['HDEL',QUEUE,id]);return view(r);
    },
  };
  return api;
}
export const adRenderJobStore=createRenderJobStore();
