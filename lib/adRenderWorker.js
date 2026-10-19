// The worker half of render jobs: take a claimed job, prepare its images (originals) and audio, run a renderer, send the
// result files back, and report progress and failures. The renderer is injected: scripts/render-worker.mjs supplies the
// real one (Chromium + ffmpeg through the existing export scripts); tests supply a fake. Cancellation is checked on every
// progress report and stops the renderer.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {imageIdsOf} from './adImages.js';

const MIME={mp4:'video/mp4',png:'image/png',json:'application/json'};
export async function runJob({store,claimed,runner,resolveImages=async()=>({images:{},missing:[]}),media=null,tmp=tmpdir()}){
  const {user,job,project}=claimed;
  const dir=await mkdtemp(join(tmp,'nexus-render-job-'));
  const abort=new AbortController();
  let canceled=false;
  const report=async p=>{const r=await store.progress(user,job.job_id,p);if(r.cancel_requested&&!canceled){canceled=true;abort.abort();}return r;};
  try{
    await report({stage:'preparing'});
    const ids=imageIdsOf(project),{images,missing}=ids.length?await resolveImages(user,ids):{images:{},missing:[]};
    if(missing.length)return await store.fail(user,job.job_id,{code:'MISSING_IMAGES',message:`Images not found: ${missing.join(', ')}. Re-attach them or remove them from the ad.`});
    const projectFile=join(dir,'project.json'),imagesFile=join(dir,'images.json');
    await writeFile(projectFile,JSON.stringify(project));await writeFile(imagesFile,JSON.stringify(images));
    let audioFile=null;
    if(job.kind==='mp4'&&job.options.audio_media_id){
      if(!media)return await store.fail(user,job.job_id,{code:'NO_MEDIA_STORE',message:'This worker cannot read audio files.'});
      const a=await media.bytes(user,job.options.audio_media_id);
      if(a.meta.kind!=='audio')return await store.fail(user,job.job_id,{code:'BAD_AUDIO',message:'audio_media_id must be an audio file.'});
      audioFile=join(dir,'audio.'+(a.meta.mime.split('/')[1]||'bin').replace('mpeg','mp3'));await writeFile(audioFile,a.buffer);
    }
    await report({stage:'rendering'});
    const out=await runner({kind:job.kind,options:job.options,projectFile,imagesFile,audioFile,outDir:dir,signal:abort.signal,onProgress:(done,total,stage)=>report({frames_done:done,frames_total:total,stage:stage||'rendering'})});
    if(canceled)return await store.fail(user,job.job_id,{code:'CANCELED',message:'Canceled.'});
    await report({stage:'saving'});
    for(const f of out.files){
      const ext=f.name.split('.').pop();
      await store.putFile(user,job.job_id,{name:f.name,mime:f.mime||MIME[ext],buffer:f.buffer||await readFile(f.path)});
    }
    return await store.complete(user,job.job_id,out.result||{});
  }catch(error){
    if(canceled||error?.name==='AbortError')return store.fail(user,job.job_id,{code:'CANCELED',message:'Canceled.'});
    return store.fail(user,job.job_id,{code:error?.code&&/^[A-Z_]+$/.test(error.code)?error.code:'RENDER_FAILED',message:error?.message||'The render failed.',details:error?.details});
  }finally{await rm(dir,{recursive:true,force:true});}
}
/** One pass of the worker loop: claim a job if there is one and run it. Returns the finished job or null. */
export async function workOnce({store,workerId,runner,resolveImages,media}){
  const claimed=await store.claim(workerId);
  return claimed?runJob({store,claimed,runner,resolveImages,media}):null;
}
