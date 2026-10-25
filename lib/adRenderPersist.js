// Keeps a finished ad MP4. The render job store drops its files after a week; this copies each finished MP4 into the
// media library (with a small poster still) and links it to its ad, so the feed can show a thumbnail and play it for as
// long as the person keeps it. One kept render per ad: a new one replaces the old one.
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MEDIA_LIMITS} from './adMedia.js';

const key=user=>{if(typeof user!=='string'||!user)throw Object.assign(new Error('Authenticated account required.'),{status:401});return 'nexus:ad-renders:v1:'+encodeURIComponent(user);};

/** campaign_id -> {campaign_id, media_id, job_id, at, bytes, chunks, width, height, seconds, quality} */
export function createAdRenderLinks({command=async parts=>(await import('./teamRuns.js')).teamCommand(parts)}={}){
  return {
    async list(user){return (await command(['HVALS',key(user)])||[]).map(raw=>JSON.parse(raw));},
    async get(user,campaignId){const raw=await command(['HGET',key(user),campaignId]);return raw?JSON.parse(raw):null;},
    async set(user,record){await command(['HSET',key(user),record.campaign_id,JSON.stringify(record)]);return record;},
    async remove(user,campaignId){return Number(await command(['HDEL',key(user),campaignId]))||0;},
  };
}

/** One frame near the start of the video as a small JPEG data URI, or '' when ffmpeg cannot make one. */
export async function posterFromVideo(path,{ffmpeg='ffmpeg',seconds=1,box=360,quality=7}={}){
  const dir=await mkdtemp(join(tmpdir(),'nexus-poster-')),out=join(dir,'poster.jpg');
  try{
    await new Promise((resolve,reject)=>{
      const child=spawn(ffmpeg,['-y','-loglevel','error','-ss',String(seconds),'-i',path,'-frames:v','1','-vf',`scale=${box}:${box}:force_original_aspect_ratio=decrease`,'-q:v',String(quality),out],{stdio:['ignore','ignore','pipe']});
      let err='';child.stderr.on('data',d=>{err=(err+d).slice(-500);});
      child.on('error',reject);
      child.on('close',code=>code===0?resolve():reject(new Error('ffmpeg poster failed: '+err.trim())));
    });
    const uri='data:image/jpeg;base64,'+(await readFile(out)).toString('base64');
    return uri.length<=MEDIA_LIMITS.maxPosterChars?uri:'';
  }finally{await rm(dir,{recursive:true,force:true});}
}

export function createRenderPersist({media,links,poster=posterFromVideo,log=()=>{}}){
  /** Save one finished MP4. Returns the link record, or null when there is nothing to keep. */
  return async function persist({user,job,project,buffer,path,result={}}){
    if(!job||job.kind!=='mp4'||!job.campaign_id||!Buffer.isBuffer(buffer)||!buffer.length)return null;
    if(buffer.length>MEDIA_LIMITS.maxAssetBytes)return null;
    const quality=job.options?.quality||'final',prev=await links.get(user,job.campaign_id);
    if(quality==='preview'&&prev)return null; // a quick preview never replaces a kept render
    let preview='';
    try{preview=path?await poster(path):'';}catch(e){log('poster failed: '+e.message);}
    const name=('Render: '+(project?.name||job.campaign_id)).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,MEDIA_LIMITS.name);
    const begun=await media.begin(user,{
      name,description:`Render of ad ${job.campaign_id} (job ${job.job_id}, ${quality})`.slice(0,MEDIA_LIMITS.description),
      kind:'video',bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),preview,
      ...(Number.isInteger(result.width)?{width:result.width}:{}),...(Number.isInteger(result.height)?{height:result.height}:{}),
      ...(typeof result.duration_sec==='number'&&result.duration_sec>=0.1?{seconds:result.duration_sec}:{}),
    });
    const size=MEDIA_LIMITS.chunkBytes;
    for(let i=0;i<begun.chunks;i++)await media.putChunk(user,begun.media_id,i,buffer.subarray(i*size,(i+1)*size).toString('base64'));
    await media.finish(user,begun.media_id);
    const record={campaign_id:job.campaign_id,media_id:begun.media_id,job_id:job.job_id,at:Date.now(),bytes:buffer.length,chunks:begun.chunks,
      width:result.width,height:result.height,seconds:result.duration_sec,quality};
    await links.set(user,record);
    if(prev&&prev.media_id!==record.media_id)await media.remove(user,prev.media_id).catch(()=>{}); // the old copy is replaced
    return record;
  };
}
