import {MACRO_CONTROLLERS,VERIFIED_MACROS,MACRO_MODES,filterMacros,reviewSummary} from './nexus-macro-registry.js';

const by=id=>document.getElementById(id);
const create=(tag,{className='',text='',title=''}={})=>{
 const el=document.createElement(tag);
 if(className)el.className=className;
 if(text)el.textContent=text;
 if(title)el.title=title;
 return el;
};
const state={controller:'all',search:'',busy:false};
function showGate(text,{retry=false}={}){
 const gate=by('gate');gate.hidden=false;gate.replaceChildren(create('p',{text}));
 if(retry){const button=create('button',{text:'Try again',className:'utility'});button.type='button';button.addEventListener('click',()=>void load());gate.append(button);}
}
function renderControllers(){
 const root=by('controllers');root.replaceChildren();
 const items=[{id:'all',name:'Everything',icon:'⌘',description:'All verified macros, explained simply.',live:true},...MACRO_CONTROLLERS];
 for(const item of items){
  const button=create('button',{className:'controller'+(state.controller===item.id?' active':'')});
  button.type='button';button.setAttribute('aria-pressed',String(state.controller===item.id));
  button.append(create('span',{className:'symbol',text:item.icon}),create('strong',{text:item.name}),create('small',{text:item.description}));
  if(!item.live)button.append(create('span',{className:'status',text:'Coming later'}));
  button.addEventListener('click',()=>{state.controller=item.id;renderControllers();renderMacros();});
  root.append(button);
 }
}
function details(label,items,{technical=false}={}){
 const d=create('details',{className:technical?'technical':'instructions'}),summary=create('summary',{text:label});d.append(summary);
 if(technical){
  const pre=create('pre');
  pre.textContent=JSON.stringify(items,null,2);
  d.append(pre);
 }else{
  const ol=create('ol');
  for(const item of items)ol.append(create('li',{text:item}));
  d.append(ol);
 }
 return d;
}
function renderMacros(){
 const data=filterMacros({controller:state.controller,search:state.search});
 by('shown').textContent=data.length+' of '+VERIFIED_MACROS.length+' verified macros';
 const root=by('macros');root.replaceChildren();
 if(!data.length){root.append(create('p',{className:'empty',text:'No working macros match yet. Pick Everything or try a different search. We only show tools that really exist.'}));return;}
 for(const macro of data){
  const card=create('article',{className:'macro'});card.id='macro-'+macro.id;
  const head=create('div',{className:'macro-head'}),icon=create('span',{className:'macro-icon',text:macro.icon});
  icon.setAttribute('aria-hidden','true');
  const title=create('div',{className:'macro-title'});title.append(create('h3',{text:macro.name}),create('span',{className:'label',text:MACRO_MODES[macro.mode]}));
  head.append(icon,title);card.append(head,create('p',{text:macro.summary}));
  const need=create('p',{className:'field'}),result=create('p',{className:'field'});
  const needStrong=create('strong',{text:'You need: '}),resultStrong=create('strong',{text:'You get: '});
  need.append(needStrong,create('span',{text:macro.need}));
  result.append(resultStrong,create('span',{text:macro.result}));
  card.append(need,result);
  card.append(details('Show me the easy steps',macro.simple));
  card.append(details('Technical details (for agents)',macro.technical,{technical:true}));
  card.append(create('div',{className:'gate',text:'🔒 '+macro.gate}));
  const actions=create('div',{className:'actions'});
  if(macro.link){
   const link=create('a',{text:macro.linkLabel});link.href=macro.link;actions.append(link);
  }
  if(macro.technical?.tool==='ad_macro'){
   const local=create('a',{className:'secondary',text:'Qwen Console (Ally only)',title:'This opens the console only on your paired Windows Ally, not on an iPhone.'});
   local.href='http://127.0.0.1:9942/deck';actions.append(local);
  }
  const steps=create('button',{className:'secondary',text:'Explain this to me'});
  steps.type='button';
  steps.addEventListener('click',()=>{
   const plain=card.querySelector('.instructions');plain.open=!plain.open;
   if(plain.open)plain.scrollIntoView({behavior:'auto',block:'nearest'});
  });
  actions.append(steps);card.append(actions);root.append(card);
 }
}
function renderReviewStatus(reviews){
 const counts=reviewSummary(reviews);
 const values=[
  [counts.toReview,'Waiting for your review'],
  [counts.changesRunning,'Qwen fixing an ad'],
  [counts.boardWorking,'Moving to your board'],
  [counts.savedToBoard,'Saved on your board'],
  [counts.needsHelp,'Need your attention']
 ];
 const root=by('progress');root.replaceChildren();
 for(const [number,label] of values){
  const card=create('div',{className:'stat'});card.append(create('strong',{text:String(number)}),create('small',{text:label}));root.append(card);
 }
}
async function load(){
 if(state.busy)return;state.busy=true;
 showGate('Checking your Nexus owner access…');by('app').hidden=true;
 try{
  // The private review API verifies that this session really belongs to the owner.
  const response=await fetch('/api/ally-ad-review?action=list',{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});
  const data=await response.json().catch(()=>({}));
  if(response.status===401||response.status===403){showGate('This space is for the signed-in Nexus owner. Open Nexus Home and sign in with your owner account.');return;}
  if(!response.ok||!Array.isArray(data.reviews)){showGate('Could not check your private Nexus review queue. No status information was loaded.',{retry:true});return;}
  by('gate').hidden=true;by('app').hidden=false;
  renderReviewStatus(data.reviews);renderControllers();renderMacros();
  by('ally-state').textContent='Checking paired Ally connection…';
  try{
   const status=await fetch('/api/ally',{method:'POST',credentials:'same-origin',
     headers:{'content-type':'application/json'},body:JSON.stringify({action:'status'}),cache:'no-store'});
   const ally=await status.json().catch(()=>({}));
   by('ally-state').textContent=status.ok?(ally.active?'● Ally connected. Local macros can run while its console is open.':ally.paired?'○ Ally paired but offline. On-device macros need the Ally awake.':'○ No Ally paired yet.'):'Ally connection status unavailable. Your review information above is still current.';
  }catch{by('ally-state').textContent='Ally connection status unavailable. Your reviews are still accessible.';}
 }catch{showGate('Nexus is temporarily unreachable. Check your connection and try again.',{retry:true});}
 finally{state.busy=false;}
}
by('search').addEventListener('input',event=>{state.search=event.target.value;renderMacros();});
by('clear').addEventListener('click',()=>{state.controller='all';state.search='';by('search').value='';renderControllers();renderMacros();});
by('refresh').addEventListener('click',()=>void load());
void load();
