import {validateResearchImport,researchUrl} from './forge-research-contract.js';
const $=id=>document.getElementById(id);
const LABELS={no_dedicated_site_found:'No dedicated website found',social_booking_only:'Social / booking only',has_website:'Has a website',needs_checking:'Needs checking'};
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
let batch=null,rows=[],ready=false,busy=false,ownerReady=false;
const tell=(message,error=false)=>{$('message').textContent=message;$('message').classList.toggle('error',error);};
const update=()=>{const n=rows.filter(r=>r.selected.checked&&!r.disabled).length;$('selection-count').textContent=n+' candidate'+(n===1?'':'s')+' selected';$('approve').disabled=!ready||busy||n===0;};
function field(parent,label,value='',type='text'){
 const wrap=el('label',label),input=el('input');input.type=type;input.value=value;wrap.append(input);parent.append(wrap);return input;
}
function check(parent,label){const wrap=el('label'),input=el('input');input.type='checkbox';wrap.append(input,document.createTextNode(label));parent.append(wrap);return input;}
function link(parent,label,url){try{const a=el('a',label);a.href=researchUrl(url);a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}catch{}}
function cleanPackage(raw){
 if(!raw||!/^research-[a-f0-9]{32}$/.test(raw.batch_id||'')||!Array.isArray(raw.candidates)||raw.candidates.length>10)throw Error('Choose the forge-review.json package saved beside an Ally review.');
 if(new TextEncoder().encode(JSON.stringify(raw)).length>40000)throw Error('Review package is too large.');
 for(const c of raw.candidates){
  if(!c||!/^[a-f0-9]{32}$/.test(c.candidate_id||'')||typeof c.name!=='string'||c.name.length>120||!Object.hasOwn(LABELS,c.status))throw Error('Review package has an invalid candidate.');
 }
 return raw;
}
function show(raw){
 batch=cleanPackage(raw);ready=ownerReady;sessionStorage.setItem('forge-review-pending',JSON.stringify(batch));rows=[];$('candidates').replaceChildren();$('result').hidden=true;
 $('batch-note').textContent=String(batch.business||'Businesses')+' · '+String(batch.city||'')+' · Research checked '+String(batch.created_at||'');
 for(const c of batch.candidates){
  const section=el('section');section.className='candidate';const choice=el('label');choice.className='select-row';
  const selected=el('input');selected.type='checkbox';const disabled=c.duplicate===true||c.status==='has_website';selected.disabled=disabled;
  choice.append(selected,document.createTextNode('Select '+c.name));section.append(choice);
  const tag=el('span',c.duplicate?'Previously found — excluded':LABELS[c.status]);tag.className='status-tag';section.append(tag);
  section.append(el('p',String(c.notes||'Review the sources before importing.')));
  const sources=el('div');sources.className='sources';link(sources,'Open Maps',c.map_url);for(const [i,url] of (c.source_urls||[]).slice(0,4).entries())link(sources,'Evidence '+(i+1),url);section.append(sources);
  if(disabled){section.classList.add('disabled');$('candidates').append(section);rows.push({selected,disabled});continue;}
  const fields=el('fieldset');fields.setAttribute('aria-label','Verified details for '+c.name);const grid=el('div');grid.className='grid';
  const name=field(grid,'Business name',c.name);name.maxLength=120;
  const location=field(grid,'Business location',c.location||batch.city||'');location.maxLength=180;
  const phone=field(grid,'Verified business phone',c.phone_suggestion||'','tel');phone.maxLength=40;
  const phoneSource=field(grid,'Phone source link',c.phone_source_url||c.map_url||'','url');
  const statusLabel=el('label','Website check'),status=el('select');
  status.setAttribute('aria-label','Website check');
  for(const [value,label] of [['','Choose after checking'],['no_dedicated_site_found','No dedicated website found'],['social_booking_only','Social / booking only']]){const option=el('option',label);option.value=value;status.append(option);}
  status.value=['no_dedicated_site_found','social_booking_only'].includes(c.status)?c.status:'';statusLabel.append(status);grid.append(statusLabel);fields.append(grid);
  const noteLabel=el('label','Research notes');noteLabel.className='notes-label';const notes=el('textarea');notes.maxLength=1000;notes.value=String(c.notes||'').slice(0,1000);noteLabel.append(notes);fields.append(noteLabel);
  const checks=el('div');checks.className='checks';const identity=check(checks,'I checked that the sources refer to this business and location.');
  const phoneChecked=check(checks,'I verified this phone number at the linked source.');
  const websiteChecked=check(checks,'I reviewed the website search and selected the correct status.');fields.append(checks);section.append(fields);$('candidates').append(section);
  const row={c,selected,disabled,fields,name,location,phone,phoneSource,status,notes,identity,phoneChecked,websiteChecked};rows.push(row);
  for(const input of [name,location,phone,phoneSource,status])input.addEventListener('input',()=>{identity.checked=false;phoneChecked.checked=false;websiteChecked.checked=false;});
 }
 for(const row of rows)row.selected.addEventListener('change',update);update();tell('Select only the businesses you have checked.');
}
async function requestPayload(){
 const candidates=rows.filter(r=>r.selected.checked&&!r.disabled).map(r=>({candidate_id:r.c.candidate_id,businessName:r.name.value,location:r.location.value,
  category:String(batch.business||''),phone:r.phone.value,phone_source_url:r.phoneSource.value,website_status:r.status.value,original_status:r.c.status,
  checked_at:r.c.checked_at||batch.created_at,source_urls:[...(r.c.source_urls||[]),r.c.map_url].filter(Boolean).slice(0,8),notes:r.notes.value,
  identity_confirmed:r.identity.checked,phone_confirmed:r.phoneChecked.checked,website_confirmed:r.websiteChecked.checked}));
 const data=validateResearchImport({batch_id:batch.batch_id,request_id:'review_pending',candidates});
 const bytes=new TextEncoder().encode(JSON.stringify({batch_id:data.batch_id,candidates:data.candidates}));
 const digest=await crypto.subtle.digest('SHA-256',bytes);data.request_id='review_'+Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 return data;
}
$('approve').addEventListener('click',async()=>{
 if(busy||!ready)return;
 try{
  const payload=await requestPayload();busy=true;update();rows.forEach(r=>{r.selected.disabled=true;if(r.fields)r.fields.disabled=true;});tell('Checking existing Forge leads and saving the selected businesses…');
  const response=await fetch('/api/forge-research',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Import failed. Keep this review open and retry.');
  $('result').replaceChildren(el('h2','Import saved'),el('p',data.created_count+' added to your caller queue · '+data.duplicate_count+' existing or suppressed leads skipped.'));
  const list=el('ul');for(const result of data.results){const row=rows.find(r=>r.c?.candidate_id===result.candidate_id);list.append(el('li',(row?.name.value||'Business')+': '+(result.status==='created'?'added':result.suppressed?'suppressed lead — not changed':'already in Forge — not changed')));}
  const caller=el('a','Open caller queue');caller.href='/forge-hub.html#field';$('result').append(list,caller);$('result').hidden=false;
  ready=false;sessionStorage.removeItem('forge-review-pending');tell('Your import receipt is saved. No calls, messages or previews were started.');
 }catch(e){tell(e.message,true);}finally{busy=false;rows.forEach(r=>{r.selected.disabled=r.disabled||!ready;if(r.fields)r.fields.disabled=!ready;});update();}
});
$('package-file').addEventListener('change',async event=>{try{const file=event.target.files?.[0];if(!file)return;if(file.size>40000)throw Error('Review package is too large.');show(JSON.parse(await file.text()));}catch(e){tell(e.message,true);}});
async function init(){
 ready=false;ownerReady=false;$('gate').hidden=false;$('review').hidden=true;$('result').hidden=true;update();
 let pending=null;
 try{
  if(location.hash.startsWith('#batch=')){
   const encoded=location.hash.slice(7);if(encoded.length>55000)throw Error('Review package is too large.');
   pending=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));
   history.replaceState(null,'',location.pathname);cleanPackage(pending);sessionStorage.setItem('forge-review-pending',JSON.stringify(pending));
  }else{const saved=sessionStorage.getItem('forge-review-pending');if(saved)pending=JSON.parse(saved);}
  const response=await fetch('/api/forge-research',{credentials:'include'});
  if(!response.ok){$('gate').replaceChildren(document.createTextNode('Sign in as the Nexus owner to review and import leads. '));const a=el('a','Open owner sign-in');a.href='/nexus-login.html';$('gate').append(a);return;}
  ownerReady=true;ready=true;$('gate').hidden=true;$('review').hidden=false;if(pending)show(pending);
 }catch(e){tell(e.message,true);$('gate').textContent='Review access is unavailable. Keep this page open and try again.';}
}
window.addEventListener('hashchange',()=>{if(!busy&&location.hash.startsWith('#batch='))init();});
init();
