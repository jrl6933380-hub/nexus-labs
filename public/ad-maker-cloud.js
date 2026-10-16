// Campaign records only. This controller never writes the studio's source code.
const $=id=>document.getElementById(id),seed=$('ad-context');
let embedded=null;try{embedded=seed?JSON.parse(seed.textContent):null;}catch{}
let record=embedded?.record||null,busy=false,pendingSave=null;
const player=()=>window.adPlayer;
const status=(text,error=false)=>{ $('cloud-status').textContent=text;$('cloud-status').setAttribute('role',error?'alert':'status');};
async function api(action,input={},request_id){const res=await fetch('/api/ad-campaigns',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input,...(request_id?{request_id}:{})})});const data=await res.json();if(!res.ok)throw Error(res.status===401?'Sign in to Nexus in this browser to open your saved ads.':data.error||'Could not reach your ads.');return data.data;}
const bridgePending=new Map();
function bridgeSave(project,request_id){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{bridgePending.delete(request_id);reject(Error('Save timed out. Reload the ad to check saved state before trying again.'));},30000);bridgePending.set(request_id,{resolve,reject,timer});parent.postMessage({type:'nexus-ad-save',nonce:embedded.nonce,request_id,project},'*');});}
window.addEventListener('message',e=>{if(!embedded||e.source!==parent||e.data?.type!=='nexus-ad-saved'||e.data.nonce!==embedded.nonce)return;const item=bridgePending.get(e.data.request_id);if(!item)return;clearTimeout(item.timer);bridgePending.delete(e.data.request_id);e.data.error?item.reject(Error(e.data.error)):item.resolve(e.data.record);});
async function list(){if(embedded)return;const data=await api('list');const selected=record?.campaign_id;$('cloud-ad').replaceChildren(new Option('Choose a saved ad…',''));for(const ad of data.campaigns)$('cloud-ad').append(new Option(ad.name||'Untitled ad',ad.campaign_id));$('cloud-ad').value=selected||'';}
function apply(next){record=next;player().load(next.project);$('save-state').textContent='Ad loaded';status('Loaded '+next.project.name+'. Changes save to this campaign.');}
async function load(id){if(!id)return;const next=await api('read',{campaign_id:id});apply(next);history.replaceState(null,'','?ad='+encodeURIComponent(id));}
$('cloud-load').onclick=()=>task(async()=>{if($('cloud-ad').value && confirm('Open this saved ad? Unsaved preview changes will be discarded.'))await load($('cloud-ad').value);});$('cloud-refresh').onclick=()=>task(async()=>{await list();status('Saved ads refreshed. Your current preview was kept.');});
$('cloud-new').onclick=()=>task(async()=>{if(!confirm('Start a new ad? Save your current changes first if you want to keep them.'))return;record=null;player().load(window.adFreshPreset());$('cloud-ad').value='';history.replaceState(null,'',location.pathname);status('New ad. Name it, then Save ad to keep it in Nexus.');});
async function task(fn){if(busy)return;busy=true;$('save').disabled=true;try{await fn();}catch(e){status(e.message,true);}finally{busy=false;$('save').disabled=false;}}
$('save').hidden=false;$('save').textContent='Save ad';$('save').onclick=()=>task(async()=>{
 const project=player().project,campaign_id=record?.campaign_id||('ad-'+crypto.randomUUID());
 const signature=JSON.stringify({campaign_id:record?.campaign_id||null,baseline:record?.baseline,project});
 if(pendingSave?.signature!==signature)pendingSave={signature,campaign_id,request_id:crypto.randomUUID()};
 status('Saving ad…');const next=embedded?await bridgeSave(project,pendingSave.request_id):await api('save',{campaign_id:pendingSave.campaign_id,...(record?{baseline:record.baseline}:{}),project},pendingSave.request_id);
 record=next;pendingSave=null;
 const unchanged=JSON.stringify(player().project)===JSON.stringify(project);$('save-state').textContent=unchanged?'Ad saved':'Unsaved changes';status(unchanged?'Saved to Nexus. Open this same ad in the board or studio.':'Saved. You have newer preview changes to save.');
 if(!embedded){history.replaceState(null,'','?ad='+encodeURIComponent(next.campaign_id));await list();}
});
if(embedded){$('cloud-picker').hidden=true;document.querySelector('.board-context').hidden=true;document.querySelector('.privacy').textContent='Save ad stores this campaign in Nexus. Use the board’s ad assistant for changes in chat.';apply(record);}else{status('Open a saved ad or save this campaign to Nexus.');task(async()=>{await list();const q=new URLSearchParams(location.search),id=q.get('ad');if(id){await load(id);if(q.get('record')==='1')player().record();else if(q.get('autoplay')==='1')player().play();}});}
