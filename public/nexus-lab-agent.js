const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const pct=v=>v==null?'no score yet':Math.round(v*100)+'%';
const HELP={
  understand:'Describe what you want to know about the picture(s).',
  detect:'Say what to find, for example: every product and its logo.',
  cutout:'Say which subject to outline for a cutout.',
  video:'Say what the video should show. Your AI returns a scene plan; no footage is generated.',
};
export function renderLabAgent({request,cap,work}){
  const rid=()=>(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2));
  work.append(el('span',cap.status==='ready'?'Ready':'Not ready yet','labstatus'),el('h2','Done by your connected AI'),
    el('p',cap.status==='ready'?`Self-test passed (best score ${pct(cap.score)} over ${cap.runs} run${cap.runs===1?'':'s'}).`:'No outside provider is used. Your connected AI (Claude or ChatGPT) looks at the image and answers; the server checks and scores it. It shows as ready after it passes a self-test (60% or better).'));
  const feedback=el('p');feedback.setAttribute('role','status');
  const test=el('button',`Create ${cap.name} self-test`);test.type='button';
  test.onclick=async()=>{test.disabled=true;feedback.textContent='Creating…';try{await request({action:'agent_selftest',request_id:rid(),input:{capability:cap.id}});feedback.textContent='Self-test created. Tell your AI: run the Nexus Lab self-test for '+cap.id+'.';await load();}catch(e){feedback.textContent=e.message;}finally{test.disabled=false;}};
  const form=el('form'),prompt=el('textarea'),picks=el('div'),go=el('button','Create task for my AI','labprimary');
  prompt.id='lab-agent-prompt';prompt.maxLength=2000;prompt.required=true;prompt.placeholder=HELP[cap.id];
  const lab=el('label','What should your AI do?');lab.htmlFor=prompt.id;go.type='submit';
  form.append(lab,prompt,el('p','Saved images (pick up to 4)'),picks,go);
  const boxes=[];
  request({action:'asset_list',input:{}}).then(r=>{const imgs=(r.assets||r.media||[]).filter(a=>a.kind==='image'&&a.status==='ready');if(!imgs.length)picks.append(el('small',cap.id==='video'?'No images needed for a plan.':'Upload an image in Assets first.'));for(const a of imgs){const row=el('label'),box=document.createElement('input');box.type='checkbox';box.value=a.media_id;boxes.push(box);row.append(box,document.createTextNode(' '+(a.name||a.media_id)));picks.append(row,el('br'));}}).catch(()=>picks.append(el('small','Could not list images.')));
  form.onsubmit=async e=>{e.preventDefault();go.disabled=true;feedback.textContent='Creating…';try{await request({action:'agent_task_create',request_id:rid(),input:{capability:cap.id,prompt:prompt.value,asset_ids:boxes.filter(b=>b.checked).map(b=>b.value)}});prompt.value='';boxes.forEach(b=>{b.checked=false;});feedback.textContent='Task created. Tell your AI: claim the open Nexus Lab task.';await load();}catch(err){feedback.textContent=err.message;}finally{go.disabled=false;}};
  const list=el('div'),refresh=el('button','Refresh');refresh.type='button';
  async function load(){
    try{
      const r=await request({action:'agent_tasks'});list.replaceChildren();
      const mine=r.tasks.filter(t=>t.capability===cap.id);
      if(!mine.length)list.append(el('p','No tasks yet.'));
      for(const t of mine.slice(0,10)){
        const card=el('details'),head=el('summary',`${t.selftest?'Self-test':'Task'} · ${t.status}${t.score!=null?' · score '+pct(t.score):''}`);card.append(head,el('p',t.prompt));
        if(t.last_error&&t.status!=='done')card.append(el('p','Last rejected answer: '+t.last_error));
        if(t.result){const pre=el('pre',JSON.stringify(t.result,null,2));pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';card.append(pre);}
        list.append(card);
      }
    }catch(e){list.replaceChildren(el('p',e.message));}
  }
  refresh.onclick=load;
  work.append(el('h3','Self-test'),test,el('h3','New task'),form,feedback,el('h3','Tasks'),refresh,list);
  load();
}
