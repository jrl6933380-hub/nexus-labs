import {friendlyError,showFeedback} from './ux.js';
import {installNexus,nexusInstallState} from './app-install.js';

const node=(tag,text,cls='')=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;el.className=cls;return el;};
const button=(text,run,cls='')=>{const el=node('button',text,cls);el.type='button';el.onclick=run;return el;};
const SYSTEMS=[
  {id:'planner',name:'Schedule',icon:'◷',tone:'schedule',section:'Your Nexus',description:'Plan time and adjust your day'},
  {id:'reminders',name:'Reminders',icon:'✓',tone:'reminders',section:'Your Nexus',description:'Remember things and reserve time'},
  {id:'life',name:'Nexus Life',icon:'✦',tone:'life',section:'Your Nexus',description:'Energy, balance, and what matters'},
  {id:'workbench',name:'Projects',icon:'◫',tone:'projects',section:'Your Nexus',description:'Build, improve, and maintain projects'},
  {id:'legacy',name:'Nexus Legacy',icon:'◇',tone:'legacy',section:'Connected Nexus',description:'Keep memories, people, and lessons close'},
  {id:'teams',name:'Nexus Teams',icon:'⬡',tone:'teams',section:'Connected Nexus',description:'People and agents working together'},
  {id:'deck',name:'Command Deck',icon:'⌁',tone:'operations',section:'Founder operations',description:'See what needs your attention'},
  {id:'approvals',name:'Approvals',icon:'✓',tone:'operations',section:'Founder operations',description:'Review consequential actions before they happen'},
  {id:'forge',name:'Forge',icon:'F',tone:'forge',section:'Founder operations',description:'Run and support the builder'},
  {id:'story',name:'Story Studio',icon:'S',tone:'story',section:'Founder operations',description:'Direct stories, scenes, and characters'},
  {id:'agents',name:'AI Team',icon:'A',tone:'teams',section:'Founder operations',description:'See agents and the work they own'},
  {id:'memory',name:'Memory',icon:'M',tone:'memory',section:'Founder operations',description:'What Nexus knows and carries forward'},
  {id:'ventures',name:'Ventures',icon:'V',tone:'ventures',section:'Founder operations',description:'Shape and manage new businesses'},
  {id:'pod',name:'Pod Room',icon:'P',tone:'pod',section:'Founder operations',description:'Your connected intelligence workspace'},
  {id:'skills',name:'Capabilities',icon:'C',tone:'skills',section:'Founder operations',description:'What Nex knows how to do'},
  {action:'openSecurity',name:'Security',icon:'⌁',tone:'memory',section:'Account',description:'Manage how you unlock Nexus'},
  {action:'lockNex',name:'Lock Nexus',icon:'L',tone:'legacy',section:'Account',description:'Secure this workspace on this device'},
];
const SCOPE_LABELS={conversation:'This conversation',projects:'Projects',schedule:'Schedule',reminders:'Reminders',life:'Nexus Life'};
export function conversationThreadId(conversation){return conversation?.kind==='specialist'||conversation?.kind==='group'?conversation.id:'nex-main';}
export function conversationPreview(thread){return String(thread?.preview || thread?.title || 'Start a conversation').replace(/\s+/gu,' ').trim().slice(0,90);}

async function api(action,input={}){
  const response=await fetch('/api/nexus-messages',{credentials:'include',...(action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})}:{})});
  const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error || 'Messages could not save that change');error.status=response.status;throw error;}return data;
}
function avatar(label,tone=''){const el=node('span',undefined,`messageavatar ${tone}`);el.setAttribute('aria-hidden','true');if(['research','build','life'].includes(tone))el.append(node('i'));else el.textContent=String(label || 'N').slice(0,1).toUpperCase();return el;}
function timeLabel(value){const stamp=Number(value);if(!stamp)return '';const date=new Date(stamp),now=new Date();if(date.toDateString()===now.toDateString())return date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);if(date.toDateString()===yesterday.toDateString())return 'Yesterday';return date.toLocaleDateString([],{month:'short',day:'numeric'});}
function row({name,meta,preview,icon='N',tone='',status='',when='',pinned=false,run}){const item=button('',run,`messageitem tone-${tone || 'plain'}${pinned?' pinned':''}`);item.append(avatar(icon,tone));const copy=node('span',undefined,'messagecopy');const top=node('span',undefined,'messagetop');top.append(node('strong',name));const aside=node('span',undefined,'messageaside');if(status)aside.append(node('small',status,'messagestatus'));if(when)aside.append(node('small',when,'messagetime'));top.append(aside);copy.append(top,node('span',meta,'messagemeta'),node('span',preview,'messagepreview'));item.append(copy);return item;}
function heading(root,title,copy,back){document.body.classList.add('messages-panel');root.replaceChildren();const top=node('div',undefined,'messagepanelhead');if(back)top.append(button('‹',back,'messageback'));top.append(node('h2',title));root.append(top);if(copy)root.append(node('p',copy,'messageintro'));}
function wizardHeading(root,title,step,back){heading(root,title,step,back);const progress=node('span',undefined,'messageprogress');progress.append(node('i'));if(step.includes('2 of 2'))progress.classList.add('complete');root.append(progress);}

export async function renderMessages(ctx){
  const root=node('section',undefined,'nexusmessages');let state={specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:[]};
  async function load(message){try{state=await api();if(ctx.consumeMessagesNew?.())newConversation();else draw();if(message)showFeedback(root,message);}catch(error){root.replaceChildren(node('p',friendlyError(error,{action:'load',subject:'Messages'})),button('Try again',()=>load()));}}
  function draw(){
    document.body.classList.remove('messages-panel');
    root.replaceChildren();
    const search=node('input');search.type='search';search.placeholder='Search conversations';search.setAttribute('aria-label','Search conversations');root.append(search);
    const list=node('div',undefined,'messagelist');root.append(list);
    const entries=[],threads=new Map(ctx.recentThreads().map(item=>[item.id,item])),main=threads.get('nex-main');
    entries.push({section:'Conversations',element:row({name:'Nex',meta:'Your main intelligence',preview:main?.title || 'Talk about anything—ideas, problems, plans, or life.',icon:'N',tone:'nex',when:timeLabel(main?.updated_at),pinned:true,run:()=>ctx.openConversation({kind:'nex',name:'Nex'})}),search:'nex main intelligence talk anything ideas problems plans life'});
    for(const specialist of state.specialists){const saved=threads.get(specialist.id);entries.push({section:'Conversations',element:row({name:specialist.name,meta:state.roles[specialist.role]?.label || 'Specialist',preview:saved?.title || specialist.job,icon:specialist.name,tone:specialist.role,status:saved?.message_count?'Active':'Ready',when:timeLabel(saved?.updated_at),run:()=>ctx.openConversation({kind:'specialist',...specialist})}),search:`${specialist.name} ${specialist.job}`});}
    for(const group of state.groups){const saved=threads.get(group.id),members=group.member_ids.map(id=>state.specialists.find(item=>item.id===id)?.name).filter(Boolean);entries.push({section:'Conversations',element:row({name:group.title,meta:['Nex',...members].join(' + '),preview:saved?.title || 'A shared conversation coordinated by Nex.',icon:'+',tone:'group',status:saved?.message_count?'Active':'Ready',when:timeLabel(saved?.updated_at),run:()=>ctx.openConversation({kind:'group',...group,members})}),search:`${group.title} ${members.join(' ')}`});}
    const recent=ctx.recentThreads().filter(item=>!/^agent-|^group-|^nex-main$/u.test(item.id));
    for(const thread of recent)entries.push({section:'Recent',element:row({name:thread.title,meta:'Nex conversation',preview:`${thread.message_count || 0} messages`,icon:'N',tone:'recent',when:timeLabel(thread.updated_at || thread.ts),run:()=>ctx.openThread(thread)}),search:thread.title});
    const pinned=new Set(state.pinned_system_ids || []);
    for(const system of SYSTEMS.filter(item=>item.id && pinned.has(item.id))){const run=()=>ctx.openSystem(system.id);entries.push({section:'Nexus spaces',element:row({name:system.name,meta:'Nexus space',preview:system.description,icon:system.icon,tone:system.tone,run}),search:`${system.name} ${system.description}`});}
    entries.push({section:'Nexus spaces',element:row({name:'More',meta:'Customize Messages',preview:'Pin the Nexus spaces you want on this screen.',icon:'…',tone:'more',run:moreView}),search:'more customize pin nexus spaces'});
    const paint=(query='')=>{list.replaceChildren();const needle=query.toLowerCase().trim();let previous='';for(const entry of entries){if(needle && !entry.search.toLowerCase().includes(needle))continue;if(!needle && entry.section!==previous){if(previous && entry.section!=='Conversations')list.append(node('p',entry.section,'messagesection'));previous=entry.section;}list.append(entry.element);}if(!list.querySelector('.messageitem'))list.append(node('p','No conversations match that search.','messageempty'));};paint();search.oninput=()=>paint(search.value);
    root.append(button('New conversation',newConversation,'uxprimary messageprimary'));
    if(recent.length)root.append(button('Clear recent conversations',()=>clearConversations(recent),'messageclear'));
  }
  function moreView(message=''){
    heading(root,'More','Choose which Nexus spaces stay on your Messages screen.',draw);
    const pinned=new Set(state.pinned_system_ids || []),list=node('div',undefined,'pinmanager');
    for(const system of SYSTEMS.filter(item=>item.id)){
      const item=node('div',undefined,`pinmanagerrow${pinned.has(system.id)?' is-pinned':''}`);
      item.append(row({name:system.name,meta:system.section,preview:system.description,icon:system.icon,tone:system.tone,run:()=>ctx.openSystem(system.id)}));
      const toggle=button(pinned.has(system.id)?'Pinned':'Pin',async()=>{
        toggle.disabled=true;
        const next=new Set(state.pinned_system_ids || []);if(next.has(system.id))next.delete(system.id);else next.add(system.id);
        try{const data=await api('set_pinned_systems',{pinned_system_ids:[...next]});state.pinned_system_ids=data.pinned_system_ids;moreView(`${system.name} ${next.has(system.id)?'pinned to':'removed from'} Messages.`);}catch(error){toggle.disabled=false;showFeedback(root,friendlyError(error,{action:'save',subject:'your pinned spaces'}));}
      },'pinbutton');
      toggle.setAttribute('aria-pressed',String(pinned.has(system.id)));toggle.setAttribute('aria-label',`${pinned.has(system.id)?'Unpin':'Pin'} ${system.name}`);item.append(toggle);list.append(item);
    }
    root.append(list);
    const app=node('div',undefined,'messagechoices installchoice');app.append(node('p','Nexus app','messagesection'));
    const installState=nexusInstallState();
    const installCopy=installState==='installed'?'Nexus is installed on this device.':installState==='prompt'?'Add Nexus to this device with one tap.':installState==='ios'?'Put Nexus on your Home Screen and open it like an app.':'Get Nexus on this device for faster access.';
    app.append(row({name:installState==='installed'?'Nexus is installed':'Install Nexus',meta:installState==='installed'?'Ready from your Home Screen':'Nexus app',preview:installCopy,icon:'N',tone:'nex',run:installView}));
    root.append(app);
    const account=node('div',undefined,'messagechoices');account.append(node('p','Account','messagesection'));
    for(const system of SYSTEMS.filter(item=>item.action)){account.append(row({name:system.name,meta:'Nexus account',preview:system.description,icon:system.icon,tone:system.tone,run:()=>ctx[system.action]?.()}));}
    root.append(account);if(message)showFeedback(root,message);
  }
  function installView(){
    const state=nexusInstallState();heading(root,state==='installed'?'Nexus is installed':'Install Nexus',state==='installed'?'Open Nexus from your Home Screen whenever you need it.':'Give Nexus its own icon and full-screen home on this device.',moreView);
    const card=node('section',undefined,'installcard');card.append(avatar('N','nex'));
    if(state==='installed'){
      card.append(node('h3','You’re all set.'),node('p','Nexus already opens as an app on this device. Your projects, schedule, reminders, and Life stay connected to your account.'));
      root.append(card,button('Back to More',moreView,'uxprimary messagecontinue'));return;
    }
    if(state==='prompt'){
      card.append(node('h3','Ready to install.'),node('p','Nexus will get its own icon and open without the browser around it.'));
      const install=button('Install Nexus',async()=>{install.disabled=true;const result=await installNexus();if(result.outcome==='accepted')installView();else{install.disabled=false;showFeedback(root,'Installation was not completed. You can try again whenever you’re ready.');}},'uxprimary messagecontinue');
      root.append(card,install,button('Not now',moreView,'messagesecondary'));return;
    }
    const ios=nexusInstallState()==='ios';
    const steps=node('ol',undefined,'installsteps');
    const instructions=ios
      ? [['1','Tap Share','Use the Share button in Safari.'],['2','Add to Home Screen','Scroll down and choose Add to Home Screen.'],['3','Add Nexus','Keep Open as Web App turned on, then tap Add.']]
      : [['1','Open your browser menu','Look for Install app or Add to Home Screen.'],['2','Choose Install Nexus','Confirm the installation when your browser asks.'],['3','Open Nexus','Use the new Nexus icon on your device.']];
    for(const [number,title,copy] of instructions){const item=node('li');item.append(node('b',number),node('span',undefined,'installstepcopy'));item.lastChild.append(node('strong',title),node('small',copy));steps.append(item);}
    card.append(node('h3',ios?'Install from Safari':'Install from your browser'),steps);root.append(card,button('Got it',moreView,'uxprimary messagecontinue'));
  }
  function clearConversations(recent){
    const kept=new Set();heading(root,'Clear conversations','Saved Memory, projects, schedules, reminders, Life, specialists, and groups stay safe. Choose Keep on any recent chat you still want.',draw);
    const summary=node('p',`${recent.length} recent conversation${recent.length===1?'':'s'} selected to clear.`,'clearsummary');root.append(summary);
    const list=node('div',undefined,'clearlist');
    const update=()=>{const count=recent.length-kept.size;summary.textContent=count?`${count} conversation${count===1?'':'s'} will be cleared. Anything marked Keep will stay.`:'Everything is marked Keep. Nothing will be cleared.';clear.disabled=count===0;clear.textContent=count?`Clear ${count} conversation${count===1?'':'s'}`:'Nothing to clear';};
    for(const thread of recent){const item=node('label',undefined,'clearitem');const input=node('input');input.type='checkbox';input.setAttribute('aria-label',`Keep ${thread.title}`);input.onchange=()=>{if(input.checked)kept.add(thread.id);else kept.delete(thread.id);update();};const copy=node('span',undefined,'clearcopy');copy.append(node('strong',thread.title),node('small',`${thread.message_count || 0} messages`));item.append(copy,input,node('span','Keep','keeplabel'));list.append(item);}root.append(list);
    const status=node('p',undefined,'messageformstatus');status.setAttribute('role','status');
    const clear=button('',async()=>{clear.disabled=true;back.disabled=true;status.textContent='Clearing conversations…';try{const result=await ctx.clearRecentThreads([...kept]);await load(`${result.deleted || 0} conversation${result.deleted===1?'':'s'} cleared.`);}catch(error){status.textContent=friendlyError(error,{action:'clear',subject:'those conversations'});clear.disabled=false;back.disabled=false;}},'uxprimary clearprimary');
    const back=button('Back to Messages',draw,'messagesecondary');root.append(clear,back,status);update();
  }
  function newConversation(){
    heading(root,'New conversation','Choose who—or what—you want to work with.',draw);
    const choices=node('div',undefined,'messagechoices');
    choices.append(row({name:'Talk with Nex',meta:'Open conversation',preview:'Ask anything or start something new.',icon:'N',tone:'nex',run:()=>ctx.openConversation({kind:'nex',name:'Nex'},true)}));
    choices.append(row({name:'Create a specialist',meta:'Give an agent a clear job',preview:'Choose its role, name, and access.',icon:'+',tone:'specialist',run:createSpecialist}));
    if(state.specialists.length)choices.append(row({name:'Start a group',meta:'Nex coordinates the work',preview:'Bring specialists into one shared conversation.',icon:'+',tone:'group',run:createGroup}));
    for(const system of SYSTEMS.filter(item=>item.section==='Your Nexus'||item.section==='Connected Nexus'))choices.append(row({name:system.name,meta:'Open Nexus conversation',preview:system.description,icon:system.icon,tone:system.tone,run:()=>ctx.openSystem(system.id)}));
    root.append(choices,button('Back to Messages',draw,'messagesecondary'));
  }
  function createSpecialist(){
    let selected='research';wizardHeading(root,'Create a specialist','Step 1 of 2',newConversation);root.append(node('h3','What should this agent help with?','messagequestion'));const choices=node('div',undefined,'rolechoices');
    const selectRole=(role)=>{selected=role;for(const el of choices.children)el.setAttribute('aria-pressed',String(el.dataset.role===role));};
    for(const [role,info] of Object.entries(state.roles)){const choice=button('',()=>selectRole(role),`rolechoice${role==='custom'?' optionalrole':''}`);choice.dataset.role=role;const copy=node('span',undefined,'rolecopy');copy.append(node('strong',info.label),node('span',info.description));choice.append(avatar(info.label,role),copy,node('i','', 'rolecheck'));choices.append(choice);}selectRole(selected);
    const different=button('⌄  Choose a different role',()=>choices.classList.toggle('showoptional'),'differentrole');
    root.append(choices,different,button('Continue',()=>specialistDetails(selected),'uxprimary messagecontinue'),node('p','♢  You choose what this agent can access before it starts.','messageprivacy'));
  }
  function specialistDetails(role){
    const info=state.roles[role];wizardHeading(root,'Name your specialist','Step 2 of 2',createSpecialist);root.append(node('h3','Give this specialist a clear identity.','messagequestion'));const form=document.createElement('form');form.className='messageform';
    const name=node('input');name.required=true;name.maxLength=40;name.placeholder=role==='research'?'Maya':role==='build'?'Atlas':'Specialist name';
    const job=node('textarea');job.maxLength=240;job.value=info.description;const scope=node('fieldset');scope.append(node('legend','What should this specialist work with?'));
    for(const value of state.scopes){const label=node('label');const input=node('input');input.type='checkbox';input.value=value;input.checked=info.defaultScopes.includes(value);if(value==='conversation'){input.checked=true;input.disabled=true;}label.append(input,node('span',SCOPE_LABELS[value] || value));scope.append(label);}
    const save=button('Create specialist',null,'uxprimary');save.type='submit';const status=node('p',undefined,'messageformstatus');status.setAttribute('role','status');form.append(node('label','Name'),name,node('label','Job'),job,scope,save,status);root.append(form,button('Back',createSpecialist,'messagesecondary'));
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;try{const scopes=[...scope.querySelectorAll('input:checked')].map(input=>input.value);const data=await api('create_specialist',{name:name.value,role,job:job.value,scopes});await load(`${data.specialist.name} is ready.`);ctx.openConversation({kind:'specialist',...data.specialist},true);}catch(error){status.textContent=friendlyError(error,{subject:'this specialist',keepDraft:true});save.disabled=false;}};
  }
  function createGroup(){
    heading(root,'Start a group','Nex will coordinate the specialists you choose.',newConversation);const form=document.createElement('form');form.className='messageform';const title=node('input');title.required=true;title.maxLength=60;title.placeholder='What is this group working on?';const members=node('fieldset');members.append(node('legend','Choose specialists'));
    for(const specialist of state.specialists){const label=node('label');const input=node('input');input.type='checkbox';input.value=specialist.id;label.append(input,node('span',`${specialist.name} · ${state.roles[specialist.role]?.label || 'Specialist'}`));members.append(label);}
    const save=button('Create group',null,'uxprimary');save.type='submit';const status=node('p',undefined,'messageformstatus');status.setAttribute('role','status');form.append(title,members,save,status);root.append(form,button('Back',newConversation,'messagesecondary'));
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;try{const member_ids=[...members.querySelectorAll('input:checked')].map(input=>input.value);const data=await api('create_group',{title:title.value,member_ids});const names=member_ids.map(id=>state.specialists.find(item=>item.id===id)?.name).filter(Boolean);ctx.openConversation({kind:'group',...data.group,members:names},true);}catch(error){status.textContent=friendlyError(error,{subject:'this group',keepDraft:true});save.disabled=false;}};
  }
  await load();return root;
}
