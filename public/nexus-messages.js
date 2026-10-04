import {friendlyError,showFeedback} from './ux.js';

const node=(tag,text,cls='')=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;el.className=cls;return el;};
const button=(text,run,cls='')=>{const el=node('button',text,cls);el.type='button';el.onclick=run;return el;};
const SYSTEMS=[
  {id:'planner',name:'Schedule',icon:'▤',description:'Plan time and adjust your day'},
  {id:'reminders',name:'Reminders',icon:'◉',description:'Remember things and reserve time'},
  {id:'life',name:'Nexus Life',icon:'◇',description:'Energy, balance, and what matters'},
  {id:'workbench',name:'Projects',icon:'▦',description:'Build, improve, and maintain projects'},
];
const SCOPE_LABELS={conversation:'This conversation',projects:'Projects',schedule:'Schedule',reminders:'Reminders',life:'Nexus Life'};
export function conversationThreadId(conversation){return conversation?.kind==='specialist'||conversation?.kind==='group'?conversation.id:'nex-main';}
export function conversationPreview(thread){return String(thread?.preview || thread?.title || 'Start a conversation').replace(/\s+/gu,' ').trim().slice(0,90);}

async function api(action,input={}){
  const response=await fetch('/api/nexus-messages',{credentials:'include',...(action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})}:{})});
  const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error || 'Messages could not save that change');error.status=response.status;throw error;}return data;
}
function avatar(label,tone=''){const el=node('span',String(label || 'N').slice(0,1).toUpperCase(),`messageavatar ${tone}`);return el;}
function row({name,meta,preview,icon='N',tone='',status='',run}){const item=button('',run,'messageitem');item.append(avatar(icon,tone));const copy=node('span',undefined,'messagecopy');const top=node('span',undefined,'messagetop');top.append(node('strong',name),status?node('small',status,'messagestatus'):node('span'));copy.append(top,node('span',meta,'messagemeta'),node('span',preview,'messagepreview'));item.append(copy);return item;}
function heading(root,title,copy){root.replaceChildren(node('p','NEXUS MESSAGES','messageeyebrow'),node('h2',title),node('p',copy,'messageintro'));}

export async function renderMessages(ctx){
  const root=node('section',undefined,'nexusmessages');let state={specialists:[],groups:[],roles:{},scopes:[]};
  async function load(message){try{state=await api();if(ctx.consumeMessagesNew?.())newConversation();else draw();if(message)showFeedback(root,message);}catch(error){root.replaceChildren(node('p',friendlyError(error,{action:'load',subject:'Messages'})),button('Try again',()=>load()));}}
  function draw(){
    heading(root,'Messages','Talk with Nex, open a part of Nexus, or bring specialists together.');
    const search=node('input');search.type='search';search.placeholder='Search conversations';search.setAttribute('aria-label','Search conversations');root.append(search);
    const list=node('div',undefined,'messagelist');root.append(list);
    const entries=[];
    entries.push({element:row({name:'Nex',meta:'Your main intelligence',preview:'Talk about anything in Nexus.',icon:'N',tone:'nex',run:()=>ctx.openConversation({kind:'nex',name:'Nex'})}),search:'nex main intelligence'});
    for(const system of SYSTEMS)entries.push({element:row({name:system.name,meta:'Nexus system',preview:system.description,icon:system.icon,tone:'system',run:()=>ctx.openSystem(system.id)}),search:`${system.name} ${system.description}`});
    for(const specialist of state.specialists)entries.push({element:row({name:specialist.name,meta:state.roles[specialist.role]?.label || 'Specialist',preview:specialist.job,icon:specialist.name,tone:specialist.role,status:'Ready',run:()=>ctx.openConversation({kind:'specialist',...specialist})}),search:`${specialist.name} ${specialist.job}`});
    for(const group of state.groups){const members=group.member_ids.map(id=>state.specialists.find(item=>item.id===id)?.name).filter(Boolean);entries.push({element:row({name:group.title,meta:['Nex',...members].join(' + '),preview:'A shared conversation coordinated by Nex.',icon:'+',tone:'group',run:()=>ctx.openConversation({kind:'group',...group,members})}),search:`${group.title} ${members.join(' ')}`});}
    for(const thread of ctx.recentThreads().filter(item=>!/^agent-|^group-|^nex-main$/u.test(item.id)))entries.push({element:row({name:thread.title,meta:'Nex conversation',preview:`${thread.message_count || 0} messages`,icon:'N',run:()=>ctx.openThread(thread)}),search:thread.title});
    const paint=(query='')=>{list.replaceChildren();const needle=query.toLowerCase().trim();for(const entry of entries)if(!needle || entry.search.toLowerCase().includes(needle))list.append(entry.element);if(!list.children.length)list.append(node('p','No conversations match that search.','messageempty'));};paint();search.oninput=()=>paint(search.value);
    root.append(button('New conversation',newConversation,'uxprimary messageprimary'));
  }
  function newConversation(){
    heading(root,'New conversation','Choose who—or what—you want to work with.');
    const choices=node('div',undefined,'messagechoices');
    choices.append(row({name:'Talk with Nex',meta:'Open conversation',preview:'Ask anything or start something new.',icon:'N',tone:'nex',run:()=>ctx.openConversation({kind:'nex',name:'Nex'},true)}));
    choices.append(row({name:'Create a specialist',meta:'Give an agent a clear job',preview:'Choose its role, name, and access.',icon:'+',tone:'specialist',run:createSpecialist}));
    if(state.specialists.length)choices.append(row({name:'Start a group',meta:'Nex coordinates the work',preview:'Bring specialists into one shared conversation.',icon:'+',tone:'group',run:createGroup}));
    for(const system of SYSTEMS)choices.append(row({name:system.name,meta:'Open system conversation',preview:system.description,icon:system.icon,tone:'system',run:()=>ctx.openSystem(system.id)}));
    root.append(choices,button('Back to Messages',draw,'messagesecondary'));
  }
  function createSpecialist(){
    let selected='research';heading(root,'Create a specialist','Step 1 of 2 · What should this agent help with?');const choices=node('div',undefined,'rolechoices');
    const selectRole=(role)=>{selected=role;for(const el of choices.children)el.setAttribute('aria-pressed',String(el.dataset.role===role));};
    for(const [role,info] of Object.entries(state.roles)){const choice=button('',()=>selectRole(role),'rolechoice');choice.dataset.role=role;choice.append(node('strong',info.label),node('span',info.description));choices.append(choice);}selectRole(selected);
    root.append(choices,button('Continue',()=>specialistDetails(selected),'uxprimary'),button('Back',newConversation,'messagesecondary'));
  }
  function specialistDetails(role){
    const info=state.roles[role];heading(root,'Name your specialist','Step 2 of 2 · You can change how you use this agent later.');const form=document.createElement('form');form.className='messageform';
    const name=node('input');name.required=true;name.maxLength=40;name.placeholder=role==='research'?'Maya':role==='build'?'Atlas':'Specialist name';
    const job=node('textarea');job.maxLength=240;job.value=info.description;const scope=node('fieldset');scope.append(node('legend','What should this specialist work with?'));
    for(const value of state.scopes){const label=node('label');const input=node('input');input.type='checkbox';input.value=value;input.checked=info.defaultScopes.includes(value);if(value==='conversation'){input.checked=true;input.disabled=true;}label.append(input,node('span',SCOPE_LABELS[value] || value));scope.append(label);}
    const save=button('Create specialist',null,'uxprimary');save.type='submit';const status=node('p',undefined,'messageformstatus');status.setAttribute('role','status');form.append(node('label','Name'),name,node('label','Job'),job,scope,save,status);root.append(form,button('Back',createSpecialist,'messagesecondary'));
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;try{const scopes=[...scope.querySelectorAll('input:checked')].map(input=>input.value);const data=await api('create_specialist',{name:name.value,role,job:job.value,scopes});await load(`${data.specialist.name} is ready.`);ctx.openConversation({kind:'specialist',...data.specialist},true);}catch(error){status.textContent=friendlyError(error,{subject:'this specialist',keepDraft:true});save.disabled=false;}};
  }
  function createGroup(){
    heading(root,'Start a group','Nex will coordinate the specialists you choose.');const form=document.createElement('form');form.className='messageform';const title=node('input');title.required=true;title.maxLength=60;title.placeholder='What is this group working on?';const members=node('fieldset');members.append(node('legend','Choose specialists'));
    for(const specialist of state.specialists){const label=node('label');const input=node('input');input.type='checkbox';input.value=specialist.id;label.append(input,node('span',`${specialist.name} · ${state.roles[specialist.role]?.label || 'Specialist'}`));members.append(label);}
    const save=button('Create group',null,'uxprimary');save.type='submit';const status=node('p',undefined,'messageformstatus');status.setAttribute('role','status');form.append(title,members,save,status);root.append(form,button('Back',newConversation,'messagesecondary'));
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;try{const member_ids=[...members.querySelectorAll('input:checked')].map(input=>input.value);const data=await api('create_group',{title:title.value,member_ids});const names=member_ids.map(id=>state.specialists.find(item=>item.id===id)?.name).filter(Boolean);ctx.openConversation({kind:'group',...data.group,members:names},true);}catch(error){status.textContent=friendlyError(error,{subject:'this group',keepDraft:true});save.disabled=false;}};
  }
  await load();return root;
}
