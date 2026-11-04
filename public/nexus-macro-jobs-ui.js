// Live private queue for the owner Macro Controller; no shell or remote-control calls.
const by=id=>document.getElementById(id);
const el=(tag,text,className='')=>{const n=document.createElement(tag);n.textContent=text||'';if(className)n.className=className;return n;};
const LABELS={
 queued:'Waiting for your Ally',
 processing:'Qwen working',
 awaiting_review:'Ready for your review',
 needs_help:'Needs your attention',
 canceled:'Canceled'
};
const STAGES={
 waiting_for_ally:'Waiting to be picked up',
 claimed:'Starting the job',
 writing_copy:'Qwen is writing the ad',
 creating_project:'Creating the project',
 updating_project:'Preparing the ad design',
 making_preview:'Making preview frames',
 rendering_video:'Making the MP4',
 sending_for_review:'Sending to your private inbox',
 waiting_for_owner:'Your video is ready to review',
 needs_attention:'Something needs checking',
 interrupted:'Ally stopped mid-job; check before retrying',
 canceled:'Canceled'
};
let initialized=false,busy=false,lastSubmission=null;
async function request(action,input){
 const response=await fetch('/api/macro-jobs',{method:'POST',credentials:'same-origin',cache:'no-store',
  headers:{'content-type':'application/json'},body:JSON.stringify({action,input})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Nexus could not save this job');
 return data;
}
function showJobs(jobs){
 const root=by('jobs');root.replaceChildren();
 if(!jobs.length){root.append(el('p','No jobs yet. Tell Qwen what you want to advertise above.','empty'));return;}
 for(const job of jobs){
  const card=el('article','','job-card');
  const heading=el('h3',job.title||'Untitled ad');
  const label=el('strong',LABELS[job.status]||'Checking status');
  const stage=el('p',STAGES[job.stage]||'Current step unavailable');
  const copy=el('small',String(job.brief||'').slice(0,170));
  card.append(heading,label,stage,copy);
  if(job.cancel_requested)card.append(el('p','Stop requested. The current step may need to finish first.','problem'));
  if(job.error)card.append(el('p','Needs checking: '+job.error,'problem'));
  if(job.status==='awaiting_review'){
   const link=el('a','Watch and approve this video');
   link.href='/ally-ad-review.html'+(job.review_id?'#review-'+encodeURIComponent(job.review_id):'');
   card.append(link);
  }
  if(['queued','processing'].includes(job.status)&&!job.cancel_requested){
   const cancel=el('button',job.status==='queued'?'Cancel job':'Stop after this step');
   cancel.type='button';
   cancel.addEventListener('click',async()=>{
    const question=job.status==='queued'?'Cancel this queued ad?':'Request a stop after the current Ally step? A render already in progress may finish first.';
    if(!confirm(question))return;
    cancel.disabled=true;
    try{await request('cancel',{id:job.id});await refreshMacroJobs();}
    catch(e){by('jobs-message').textContent=e.message;cancel.disabled=false;}
   });
   card.append(cancel);
  }
  root.append(card);
 }
}
export async function refreshMacroJobs(){
 if(busy)return;busy=true;
 try{
  const response=await fetch('/api/macro-jobs',{credentials:'same-origin',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!Array.isArray(data.jobs))throw Error(data.error||'Jobs unavailable');
  showJobs(data.jobs);
  by('jobs-message').textContent='Showing '+data.jobs.length+' recent ad job'+(data.jobs.length===1?'':'s')+'. The status updates while this page is open.';
 }catch(e){by('jobs-message').textContent='Unable to read jobs: '+e.message;}
 finally{busy=false;}
}
async function submit(event){
 event.preventDefault();
 const form=by('new-job'),button=by('submit-job'),message=by('submit-message');
 const title=by('job-title').value.trim(),brief=by('job-brief').value.trim();
 if(!by('job-render-consent').checked){message.textContent='Tick the private render approval first.';return;}
 const fingerprint=title+'\n'+brief;
 if(!lastSubmission||lastSubmission.fingerprint!==fingerprint)
  lastSubmission={fingerprint,id:crypto.randomUUID()};
 button.disabled=true;message.textContent='Sending your request to the Ally queue…';
 try{
  const out=await request('create',{request_id:lastSubmission.id,title,brief,render_approved:true});
  message.textContent='Queued '+(out.job?.title||'your ad')+'. Qwen will pick it up while the Ally Console is running.';
  form.reset();lastSubmission=null;await refreshMacroJobs();
 }catch(e){message.textContent=e.message+'. If the request did not go through, try again without changing the brief.';}
 finally{button.disabled=false;}
}
export function mountMacroJobs(){
 if(!initialized){
  initialized=true;
  by('new-job').addEventListener('submit',event=>void submit(event));
  by('refresh-jobs').addEventListener('click',()=>void refreshMacroJobs());
  setInterval(()=>{if(!document.hidden)void refreshMacroJobs();},15000);
 }
 void refreshMacroJobs();
}
