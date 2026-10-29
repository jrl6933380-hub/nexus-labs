const MAX_BYTES=8*1024*1024;
export function voiceApi(campaign,fetcher=fetch){
 return async(action,input={},write=false)=>{
  const body=JSON.stringify({action,input:{...input,campaign_id:campaign},...(write?{request_id:crypto.randomUUID()}: {})});
  const response=await fetcher('/api/ad-voiceover',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body});
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result?.data)throw new Error(result?.error||'Could not connect to Nexus. Check your connection and reload.');
  return result.data;
 };
}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}
function bytes64(text){const s=atob(text);return Uint8Array.from(s,c=>c.charCodeAt(0));}
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function uploadVoiceover(file,api,progress=()=>{}){
 if(!file||file.size<16||file.size>MAX_BYTES)throw new Error('Choose an audio file up to 8 MB.');
 if(!/\.(mp3|wav|m4a|ogg)$/i.test(file.name))throw new Error('Choose an MP3, WAV, M4A or OGG recording.');
 const data=new Uint8Array(await file.arrayBuffer());
 const begun=await api('begin',{name:file.name.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,80),bytes:data.length,sha256:await digest(data)},true);
 for(let index=0;index<begun.chunks;index++){
  const part=data.subarray(index*begun.chunk_bytes,(index+1)*begun.chunk_bytes);
  await api('chunk',{media_id:begun.media_id,index,data_base64:base64(part)},true);
  progress(Math.round((index+1)/begun.chunks*100));
 }
 return (await api('finish',{media_id:begun.media_id},true)).voiceover;
}
export async function loadVerifiedBlob(api,action,input,info,mime,progress=()=>{}){
 const parts=[];
 for(let index=0;index<info.chunks;index++){
  const part=await api(action,{...input,index});
  parts.push(bytes64(part.data_base64));progress(Math.round((index+1)/info.chunks*100));
 }
 const blob=new Blob(parts,{type:mime});
 if(blob.size!==info.bytes||await digest(await blob.arrayBuffer())!==info.sha256)throw new Error('The download was incomplete. Load the video again.');
 return blob;
}
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id),campaign=new URLSearchParams(location.search).get('ad');
 if(campaign&&$('voiceover'))init();
 async function init(){
  const api=voiceApi(campaign);let baseline,voice=null,render=null,timer=null,audioUrl=null,videoUrl=null,videoFile=null,disposed=false;
  const status=text=>{$('voice-status').textContent=text;};
  const progress=value=>{$('voice-progress').hidden=false;$('voice-progress').value=value;};
  function busy(value){$('voice-file').disabled=value;$('voice-export').disabled=value||!voice;$('voice-load').disabled=value;}
  function clearVideo(){if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=null;videoFile=null;$('voice-video').removeAttribute('src');$('voice-video').hidden=true;$('voice-download').hidden=true;$('voice-share').hidden=true;$('voice-load').hidden=true;}
  function showVoice(){ $('voice-name').textContent=voice?voice.name:'No voiceover attached yet.';$('voice-export').disabled=!voice;$('voice-file').parentElement.firstChild.textContent=voice?'Replace voiceover':'Add voiceover';}
  async function previewVoice(){
   if(!voice)return;
   const selected=voice;
   const blob=await loadVerifiedBlob(api,'audio_chunk',{media_id:selected.media_id},selected,selected.mime);
   if(disposed||voice!==selected)return;
   if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(blob);$('voice-audio').src=audioUrl;$('voice-audio').hidden=false;
  }
  async function showRender(job){
   if(disposed)return;
   render=job;
   if(job.status==='queued'||job.status==='running'){
    busy(true);progress(job.progress?.pct||0);status(job.status==='queued'?'Export queued. You can leave this page and return.':'Exporting video with voiceover… '+(job.progress?.pct||0)+'%');
    clearTimeout(timer);timer=setTimeout(async()=>{try{await showRender(await api('status',{job_id:job.job_id}));}catch(e){busy(false);status(e.message+' Reload to check the saved export.');}},4000);return;
   }
   busy(false);$('voice-progress').hidden=true;
   if(job.status==='succeeded'){
    if(!(job.files||[]).some(f=>f.name==='ad.mp4')){status('The export has no video file. Export again.');return;}
    status('Your video with voiceover is ready. Load it to watch and download.');$('voice-load').hidden=false;
   }else status(job.error?.message||'The export did not finish. You can try exporting again.');
  }
  $('voice-file').addEventListener('change',async()=>{
   const file=$('voice-file').files[0];if(!file)return;
   busy(true);clearVideo();status('Uploading voiceover…');progress(0);
   try{voice=await uploadVoiceover(file,api,progress);showVoice();if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(file);$('voice-audio').src=audioUrl;$('voice-audio').hidden=false;status('Voiceover attached. Listen above, then export the video.');}
   catch(e){status(e.message);}finally{busy(false);$('voice-progress').hidden=true;$('voice-file').value='';}
  });
  $('voice-export').addEventListener('click',async()=>{
   busy(true);clearVideo();status('Starting export…');
   try{await showRender(await api('render',{baseline},true));}catch(e){busy(false);status(e.message);}
  });
  $('voice-load').addEventListener('click',async()=>{
   if(!render)return;busy(true);status('Loading finished video…');
   try{
    const info=render.files.find(f=>f.name==='ad.mp4');
    const blob=await loadVerifiedBlob(api,'video_chunk',{job_id:render.job_id},info,'video/mp4',progress);
    if(disposed)return;
    videoUrl=URL.createObjectURL(blob);videoFile=new File([blob],campaign+'-voiceover.mp4',{type:'video/mp4'});
    $('voice-video').src=videoUrl;$('voice-video').hidden=false;
    $('voice-download').href=videoUrl;$('voice-download').download=videoFile.name;$('voice-download').hidden=false;
    $('voice-share').hidden=!(navigator.canShare&&navigator.canShare({files:[videoFile]}));
    $('voice-load').hidden=true;status('Ready. Watch the export to check speech timing, then download or share it.');
   }catch(e){status(e.message);}finally{busy(false);$('voice-progress').hidden=true;}
  });
  $('voice-share').addEventListener('click',async()=>{if(!videoFile)return;try{await navigator.share({files:[videoFile],title:'Nexus ad with voiceover'});}catch(e){if(e.name!=='AbortError')status('Sharing is unavailable. Use Download video instead.');}});
  addEventListener('pagehide',()=>{disposed=true;clearTimeout(timer);if(audioUrl)URL.revokeObjectURL(audioUrl);if(videoUrl)URL.revokeObjectURL(videoUrl);});
  try{
   const state=await api('state');baseline=state.baseline;voice=state.voiceover;$('voiceover').hidden=false;showVoice();
   if(location.hash==='#voiceover')$('voiceover').scrollIntoView({block:'start'});
   if(voice)previewVoice().catch(e=>status('Voiceover is attached, but its preview could not load: '+e.message));
   if(state.render)await showRender(state.render);
  }catch(e){if(!$('frame').hidden){$('voiceover').hidden=false;status(e.message);}}
 }
}
