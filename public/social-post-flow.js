import {PLATFORMS,LABELS,LINKS,groupVideos,videoFields,captionOf,pendingFor,validPostUrl} from './social-post-flow-core.mjs';
const $=id=>document.getElementById(id),state={campaigns:[],videos:[],batch:'',platform:'tiktok',current:'',busy:false};
const blobs=new Map(),dirty=new Set(),drafts=new Map();
const context=new URLSearchParams(location.search),boardId=/^[A-Za-z0-9_-]{1,64}$/.test(context.get('board')||'')?context.get('board'):'',itemId=context.get('item')||'';
if(context.get('embedded')==='1')document.body.classList.add('embedded');
if(/^sf-batch-[A-Za-z0-9_-]{1,91}$/.test(context.get('batch')||''))state.batch=context.get('batch');
window.nexusSocialFlow={hasUnsaved:()=>dirty.size>0||state.busy};
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const uid=()=>crypto.randomUUID();
function message(text,bad=false){$('message').textContent=text;$('message').classList.toggle('error',bad);}
function button(text,fn){const b=node('button',text);b.type='button';b.onclick=()=>work(fn);return b;}
async function request(endpoint,action,input={},write=false){
 const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action,input,...(write?{request_id:uid()}:{})})});
 const d=await r.json();if(!r.ok)throw Error(r.status===401?'Sign in to Nexus in this browser first.':d.error||'Could not save. Reload before retrying.');return endpoint==='/api/nexus-lab'?d:d.data;
}
const plan=(a,i,w)=>request('/api/tiktok-plans',a,i,w),lab=(a,i,w)=>request('/api/nexus-lab',a,i,w),ads=(a,i)=>request('/api/ad-campaigns',a,i);
async function work(fn){if(state.busy)return;state.busy=true;document.querySelectorAll('button,select,input,textarea').forEach(b=>b.disabled=true);try{await fn();}catch(e){message(e.message,true);}finally{state.busy=false;document.querySelectorAll('button,select,input,textarea').forEach(b=>b.disabled=false);document.querySelectorAll('[data-existing]').forEach(b=>b.disabled=true);$('addSaved').disabled=!state.batch;$('upload').disabled=!state.batch;}}
function put(v){const at=state.videos.findIndex(x=>x.id===v.id);if(at<0)state.videos.push(v);else state.videos[at]=v;}
const groups=()=>groupVideos(state.videos,state.batch);
async function save(v,patch={}){const r=await plan('save_video',{id:v.id,...(v.baseline?{baseline:v.baseline}:{}),video:{...videoFields(v),...patch}},true);put(r);return r;}
async function load(){const d=await plan('overview');state.campaigns=d.campaigns.filter(c=>c.id.startsWith('sf-batch-'));state.videos=d.videos;if(!state.campaigns.some(c=>c.id===state.batch))state.batch=boardId?'':state.campaigns[0]?.id||'';render();if(boardId)await readBoardNotes();}
async function newBatch(){if(dirty.size)throw Error('Save your edited branches first.');const name=prompt('Name this posting batch');if(!name?.trim())return;const c=await plan('save_campaign',{id:'sf-batch-'+uid(),campaign:{name:name.trim().slice(0,80),goal:'Social Post Flow batch',status:'planning'}},true);state.campaigns.push(c);state.batch=c.id;render();}
async function addSource(source){if(!state.batch)throw Error('Create a batch first.');const key='sf-'+uid();await save({id:key+'-tiktok',campaign_id:state.batch,title:source.name.slice(0,100),platform:'tiktok',status:'idea',caption:'',hashtags:'',sound:'',video_ref:source.ref,ad_campaign_id:source.ad||'',scope:{ready:false,brief:null}});render();message('Added video branch. Write its caption and choose its socials.');}
function field(parent,label,value,max,multiline=false){const l=node('label',label),n=node(multiline?'textarea':'input');n.value=value||'';n.maxLength=max;l.append(n);parent.append(l);return n;}
function render(){
 const sel=$('batches');sel.replaceChildren();if(!state.batch)sel.append(new Option(state.campaigns.length?'Choose or create a batch':'Create your first batch',''));for(const c of state.campaigns)sel.append(new Option(c.name,c.id));sel.value=state.batch;
 if(boardId&&state.batch&&window.parent!==window)window.parent.postMessage({type:'nexus-social:batch',board:boardId,item:itemId,batch:state.batch},location.origin);
 $('addSaved').disabled=!state.batch;$('upload').disabled=!state.batch;
 const area=$('branches');area.replaceChildren();const all=groups();
 if(!all.length){const empty=node('div','Add saved ads or upload videos to start your flow.');empty.className='empty';area.append(empty);}
 for(const [index,g]of all.entries()){
  const v=g.records.find(r=>r.status!=='posted')||g.records[0],card=node('article');card.className='branch';card.dataset.key=g.key;
  card.append(node('h2',`${index+1} · ${v.title}`),node('p','Video → description + tags'));
  const preview=button('Preview / get video',async()=>{const file=await getFile(v);const player=node('video');player.controls=true;player.playsInline=true;player.src=URL.createObjectURL(file);player.onloadeddata=()=>URL.revokeObjectURL(player.src);preview.replaceWith(player);});card.append(preview);
  const draft=drafts.get(g.key)||{},title=field(card,'Video name',draft.title??v.title,100),caption=field(card,'Description',draft.caption??v.caption,2200,true),tags=field(card,'Hashtags',draft.hashtags??v.hashtags,300),sound=field(card,'Sound / voiceover notes',draft.sound??v.sound,100);
  for(const [name,n] of Object.entries({title,caption,hashtags:tags,sound}))n.oninput=()=>{dirty.add(g.key);draft[name]=n.value;drafts.set(g.key,draft);};
  const checks={};for(const p of PLATFORMS){const l=node('label'),n=node('input');n.type='checkbox';const existing=g.records.find(r=>r.platform===p);n.checked=!!existing||!!draft[p];if(existing){n.disabled=true;n.dataset.existing='true';}n.onchange=()=>{dirty.add(g.key);draft[p]=n.checked;drafts.set(g.key,draft);};checks[p]=n;l.className='check';l.append(n,document.createTextNode(LABELS[p]+(existing?' · '+existing.status:'')));card.append(l);}
  const saveButton=button('Save branch',async()=>{
   if(!title.value.trim())throw Error('Give this video a name.');const patch={title:title.value.trim(),caption:caption.value,hashtags:tags.value,sound:sound.value};
   // Each platform is saved separately. Keep successful writes if a later one fails.
   for(const p of PLATFORMS){if(!checks[p].checked)continue;const old=state.videos.find(r=>r.id===g.key+'-'+p);if(old?.status==='posted')continue;await save(old||{...videoFields(v),id:g.key+'-'+p,platform:p,status:'idea',post_url:'',claimed_by:'',date:''},patch);}
   dirty.delete(g.key);drafts.delete(g.key);render();message('Branch saved for its selected socials.');
  });card.append(saveButton,node('p','Posted copies stay unchanged. Existing destinations remain in the batch.'));area.append(card);
 }
 const total=all.reduce((n,g)=>n+g.records.length,0),done=all.reduce((n,g)=>n+g.records.filter(v=>v.status==='posted').length,0);$('summary').textContent=`${all.length} videos · ${done} / ${total} posts complete`;
 $('destinations').replaceChildren();for(const p of PLATFORMS){const b=button(`${LABELS[p]} · ${pendingFor(all,p).length} left`,()=>{if(dirty.size)throw Error('Save your edited branches first.');state.platform=p;state.current='';renderQueue();renderPlatforms();});b.dataset.platform=p;b.setAttribute('aria-pressed',String(state.platform===p));$('destinations').append(b);}renderQueue();
}
function renderPlatforms(){for(const b of $('destinations').children)b.setAttribute('aria-pressed',String(b.dataset.platform===state.platform));}
async function copyText(text){try{await navigator.clipboard.writeText(text);}catch{throw Error('Clipboard unavailable. Select and copy the caption shown below.');}}
function renderQueue(){
 const q=$('queue'),pending=pendingFor(groups(),state.platform);q.hidden=false;q.replaceChildren(node('h2',LABELS[state.platform]+' posting queue'));
 if(!pending.length){q.append(node('p','No pending videos for this platform. Add it to a video branch above.'));return;}
 const v=pending.find(v=>v.id===state.current)||pending[0];state.current=v.id;
 const select=node('select');select.setAttribute('aria-label','Video to post');for(const r of pending)select.append(new Option(r.title,r.id));select.value=v.id;select.onchange=()=>{state.current=select.value;renderQueue();};q.append(select);
 const title=node('h3',v.title);title.id='queueTitle';const text=node('textarea');text.readOnly=true;text.value=captionOf(v);text.setAttribute('aria-label','Caption and hashtags to copy');q.append(title,text,node('p',v.sound?'Sound: '+v.sound:'Check the video and target account in the social app.'));
 const row=node('div');row.className='row';row.append(button('1. Copy caption + tags',async()=>{await copyText(captionOf(v));message('Caption copied for '+v.title+'.');}),button('2. Get / share video',async()=>{const f=await getFile(v);if(navigator.canShare?.({files:[f]})){await navigator.share({files:[f],title:v.title});message('Share sheet opened. Verify the receiving app and video.');}else{const u=URL.createObjectURL(f),a=node('a','Download '+f.name);a.href=u;a.download=f.name;q.append(a);a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);message('Video download prepared. Select this file in the social app.');}}));
 const open=node('a','3. Open '+LABELS[v.platform]);open.href=LINKS[v.platform];open.target='_blank';open.rel='noopener';row.append(open);q.append(row,node('p','Open launches the platform link; Android may use its app or browser. Sharing and opening do not mark a post published.'));
 const url=field(q,'Live post link (after publishing)',v.post_url,300);url.type='url';q.append(button('Mark posted → next video',async()=>{if(dirty.size)throw Error('Save your edited branches first.');if(!validPostUrl(url.value.trim(),v.platform))throw Error('Paste the live HTTPS '+LABELS[v.platform]+' post link.');if(!v.caption.trim())throw Error('Save a caption on this branch first.');await save(state.videos.find(r=>r.id===v.id),{status:'posted',post_url:url.value.trim(),claimed_by:''});state.current='';render();message('Marked posted. The next video is ready.');}));
}
async function picker(){
 if(dirty.size)throw Error('Save your edited branches first.');const d=$('picker');d.replaceChildren(node('h2','Add saved ads / videos'));const close=node('button','Done');close.onclick=()=>d.close();d.append(close);const list=node('div');list.className='choices';d.append(list);d.showModal();
 const results=await Promise.allSettled([lab('asset_list'),ads('list'),ads('renders')]);
 const media=results[0].status==='fulfilled'?results[0].value.media||[]:[],adList=results[1].status==='fulfilled'?results[1].value.campaigns||[]:[],renders=results[2].status==='fulfilled'?results[2].value.renders||{}:{};
 for(const m of media.filter(m=>m.kind==='video'&&m.status==='ready'))list.append(button('Video · '+m.name,()=>addSource({name:m.name,ref:m.media_id})));
 for(const a of adList){const r=renders[a.campaign_id],ref=r?.media_id||(r?.job_id?'render:'+r.job_id:'ad:'+a.campaign_id);list.append(button('Ad · '+a.name+(r?'':' · needs a rendered video'),()=>addSource({name:a.name,ref,ad:a.campaign_id})));}
 if(!list.children.length)list.append(node('p','No saved videos or ads available. Upload a video instead.'));
 for(const r of results)if(r.status==='rejected')list.append(node('p',r.reason.message));
}
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function getFile(v){
 if(blobs.has(v.video_ref))return blobs.get(v.video_ref);let ref=v.video_ref;
 if(ref.startsWith('ad:')){const r=(await ads('renders')).renders[v.ad_campaign_id];if(!r)throw Error('This saved ad needs an MP4 render first. Render it in Ads Studio, then retry.');ref=r.media_id||(r.job_id?'render:'+r.job_id:'');}
 const parts=[];let mime='video/mp4',name=v.title.replace(/[^a-z0-9_-]/gi,'_')+'.mp4';
 if(ref.startsWith('render:')){const job=ref.slice(7),renders=(await ads('renders')).renders,r=Object.values(renders).find(x=>x.job_id===job);if(!r)throw Error('This temporary render expired. Render the ad again.');for(let i=0;i<r.chunks;i++){const c=await ads('render_chunk',{job_id:job,index:i});parts.push(decode(c.data_base64));}}
 else {if(!ref.startsWith('med-'))throw Error('Choose a saved video file first.');const {asset}=await lab('asset_read',{media_id:ref});if(asset.kind!=='video'||asset.status!=='ready')throw Error('The saved video is not ready.');mime=asset.mime;name=asset.name;for(let i=0;i<asset.chunks;i++){const c=await lab('asset_download',{media_id:ref,index:i});if(c.media_id!==ref||c.index!==i)throw Error('Video download mismatch.');parts.push(decode(c.data_base64));}}
 const f=new File(parts,name,{type:mime});blobs.set(v.video_ref,f);return f;
}
async function upload(file){
 if(!/^video\//.test(file.type))throw Error('Choose a video file.');const {limits}=await lab('asset_list');const bytes=await file.arrayBuffer();
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const {asset}=await lab('asset_begin',{name:file.name.slice(0,80),kind:'video',bytes:bytes.byteLength,sha256:sha,provenance:{role:'original',origin:'uploaded'}},true);
 for(let i=0;i<asset.chunks;i++){const chunk=new Uint8Array(bytes,i*limits.chunkBytes,Math.min(limits.chunkBytes,bytes.byteLength-i*limits.chunkBytes));let raw='';for(let n=0;n<chunk.length;n+=8192)raw+=String.fromCharCode(...chunk.subarray(n,n+8192));await lab('asset_chunk',{media_id:asset.media_id,index:i,data_base64:btoa(raw)});}
 return (await lab('asset_finish',{media_id:asset.media_id})).asset;
}
$('newBatch').onclick=()=>work(newBatch);$('batches').onchange=()=>{if(dirty.size){$('batches').value=state.batch;message('Save your edited branches first.',true);return;}state.batch=$('batches').value;state.current='';render();};
$('addSaved').onclick=()=>work(picker);$('upload').onclick=()=>{if(dirty.size){message('Save your edited branches first.',true);return;}$('files').click();};
$('files').onchange=()=>work(async()=>{for(const f of $('files').files){message('Uploading '+f.name+'…');const a=await upload(f);await addSource({name:a.name,ref:a.media_id});}$('files').value='';message('Videos uploaded and added.');});

async function readBoardNotes(){
 $('boardBriefs').hidden=false;const list=$('briefList');
 try{const {board}=await lab('board_read',{id:boardId});list.replaceChildren();
  const notes=board.items.filter(i=>i.kind==='note');
  if(!notes.length)list.append(node('p','No sticky notes yet. Use + Sticky note above.'));
  for(const note of notes){const card=node('article');card.append(node('h3',note.title||'Ad brief'),node('small','Note '+note.id),node('pre',note.text),button('Copy brief',async()=>{await copyText(note.text);message('Brief copied.');}));list.append(card);}
 }catch(e){list.replaceChildren(node('p',e.message));}
}
$('refreshBriefs').onclick=()=>work(readBoardNotes);
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===window.parent&&e.data?.type==='nexus-board:saved'&&e.data.board===boardId)readBoardNotes();});

window.addEventListener('beforeunload',e=>{if(dirty.size){e.preventDefault();e.returnValue='';}});
work(load);
