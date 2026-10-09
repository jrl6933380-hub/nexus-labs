import {NEXUS_INTRO} from './nexus-guide.js';
import {renderAccountControls} from './nexus-controls.js';
import {SPACE_BUNDLES,pinnedBundles} from './nexus-navigation.js';
import {friendlyError,showFeedback} from './ux.js';
import {installNexus,nexusInstallState} from './app-install.js';
import {disableNotifications,enableNotifications,notificationState,notificationError} from './push-notifications.js';

const node=(tag,text,cls='')=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;el.className=cls;return el;};
const button=(text,run,cls='')=>{const el=node('button',text,cls);el.type='button';el.onclick=run;return el;};
const SYSTEMS=[
  {id:'planner',name:'Schedule',icon:'◷',tone:'schedule',section:'Your Nexus',description:'Plan time and adjust your day'},
  {id:'reminders',name:'Reminders',icon:'✓',tone:'reminders',section:'Your Nexus',description:'Remember things and reserve time'},
  {id:'life',name:'Nexus Life',icon:'✦',tone:'life',section:'Your Nexus',description:'Energy, balance, and what matters'},
  {id:'workbench',name:'Projects',icon:'◫',tone:'projects',section:'Your Nexus',description:'Build, improve, and maintain projects'},
  {id:'legacy',name:'Nexus Legacy',icon:'◇',tone:'legacy',section:'Connected Nexus',description:'Planned: a dedicated home for people, memories, and lessons'},
  {id:'teams',name:'Nexus Teams',icon:'⬡',tone:'teams',section:'Connected Nexus',description:'Planned: a workspace for multiple people and agents'},
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
function avatar(label,tone=''){const el=node('span',undefined,`messageavatar ${tone}`);el.setAttribute('aria-hidden','true');if(['research','build','life','review'].includes(tone))el.append(node('i'));else el.textContent=String(label || 'N').slice(0,1).toUpperCase();return el;}
function timeLabel(value){const stamp=Number(value);if(!stamp)return '';const date=new Date(stamp),now=new Date();if(date.toDateString()===now.toDateString())return date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);if(date.toDateString()===yesterday.toDateString())return 'Yesterday';return date.toLocaleDateString([],{month:'short',day:'numeric'});}
function row({name,meta,preview,icon='N',tone='',status='',when='',pinned=false,run}){const item=button('',run,`messageitem tone-${tone || 'plain'}${pinned?' pinned':''}`);item.append(avatar(icon,tone));const copy=node('span',undefined,'messagecopy');const top=node('span',undefined,'messagetop');top.append(node('strong',name));const aside=node('span',undefined,'messageaside');if(status)aside.append(node('small',status,'messagestatus'));if(when)aside.append(node('small',when,'messagetime'));top.append(aside);copy.append(top,node('span',meta,'messagemeta'),node('span',preview,'messagepreview'));item.append(copy);return item;}
function group(label,items=[]){const section=node('section',undefined,'messagechoices cataloggroup');section.append(node('p',label,'messagesection'),...items);return section;}
function heading(root,title,copy,back){document.body.classList.add('messages-panel');root.replaceChildren();const top=node('div',undefined,'messagepanelhead');if(back)top.append(button('‹',back,'messageback'));top.append(node('h2',title));root.append(top);if(copy)root.append(node('p',copy,'messageintro'));}
function wizardHeading(root,title,step,back){heading(root,title,step,back);const progress=node('span',undefined,'messageprogress');progress.append(node('i'));if(step.includes('2 of 2'))progress.classList.add('complete');root.append(progress);}

const CAPABILITY_BUILDERS=Object.freeze({
  tools:{singular:'tool',title:'Add a tool',namePlaceholder:'Tool name, like check_inventory',purposePlaceholder:'What real job should this tool complete?',behaviorPlaceholder:'What should it read or change, and what result should it return?'},
  skills:{singular:'skill',title:'Add a skill',namePlaceholder:'Skill name, like trip-planner',purposePlaceholder:'When should Nex load this operating knowledge?',behaviorPlaceholder:'What procedure, judgment, or rules should the skill teach Nex?'},
  commands:{singular:'command',title:'Add a command',namePlaceholder:'Command phrase, like Plan my launch',purposePlaceholder:'What should happen when you type this command?',behaviorPlaceholder:'List the exact steps, inputs, and finished result.'},
});
export function buildOwnerCapabilityPrompt(section,{name='',purpose='',behavior='',scopes=[]}={}){
  const config=CAPABILITY_BUILDERS[section] || CAPABILITY_BUILDERS.tools;
  return [
    `I want to add a new Nexus ${config.singular} named "${String(name).trim()}".`,
    `Purpose: ${String(purpose).trim()}`,
    `Working scope: ${(Array.isArray(scopes)?scopes:[]).join(', ') || 'this conversation only'}`,
    `Expected behavior: ${String(behavior).trim()}`,
    '',
    `Scope this ${config.singular} with me and ask only for information that is genuinely missing. Then implement it in the real ${config.singular} runtime on a non-live branch, add relevant tests, and open a pull request. Keep credentials server-side and preserve owner approvals for consequential actions. Do not list or describe it as active until the runtime wiring and tests prove it works.`,
  ].join('\n');
}

export async function renderMessages(ctx){
  const root=node('section',undefined,'nexusmessages');let state={specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:[]};
  let ownerCatalog=null;
  async function load(message){try{state=await api();if(ctx.consumeMessagesNew?.())newConversation();else {const destination=ctx.consumeMessagesDestination?.();if(destination==='settings')accountControls();else if(SPACE_BUNDLES.some(bundle=>bundle.id===destination))bundleView(destination);else draw();}if(typeof message==='string' && message.trim())showFeedback(root,message);}catch(error){root.replaceChildren(node('p',friendlyError(error,{action:'load',subject:'Messages'})),button('Try again',()=>load()),button('Explore Nexus',()=>ctx.go('guide'),'guideopen'));}}
  function draw(){
    document.body.classList.remove('messages-panel');
    root.replaceChildren();
    const intro=node('header',undefined,'messagespurpose');intro.append(node('h2',NEXUS_INTRO.title),node('p','Recipes, reminders, notes, ideas, and things you want to make. Start with a conversation.'));root.append(intro);
    const search=node('input');search.type='search';search.placeholder='Search conversations';search.setAttribute('aria-label','Search conversations');root.append(search);
    const list=node('div',undefined,'messagelist');root.append(list);
    const entries=[],threads=new Map(ctx.recentThreads().map(item=>[item.id,item])),main=threads.get('nex-main');
    entries.push({section:'Conversations',element:row({name:'Nex',meta:'Your main intelligence',preview:main?.title || 'Talk about anything—ideas, problems, plans, or life.',icon:'N',tone:'nex',when:timeLabel(main?.updated_at),pinned:true,run:()=>ctx.openConversation({kind:'nex',name:'Nex'})}),search:'nex main intelligence talk anything ideas problems plans life'});
    entries.push({section:'Conversations',element:row({name:'Explore Nexus',meta:'Everyday life, projects, and work',preview:'See what each feature does and try a practical example.',icon:'?',tone:'more',run:()=>ctx.go('guide')}),search:'explore nexus guide help what can I do recipes notes reminders sleep birthdays research builder agents'});
    for(const specialist of state.specialists){const saved=threads.get(specialist.id);entries.push({section:'Conversations',element:row({name:specialist.name,meta:state.roles[specialist.role]?.label || 'Specialist',preview:saved?.title || specialist.job,icon:specialist.name,tone:specialist.role,status:state.specialist_status?.[specialist.id] || (saved?.message_count?'Active':'Ready'),when:timeLabel(saved?.updated_at),run:()=>ctx.openConversation({kind:'specialist',...specialist})}),search:`${specialist.name} ${specialist.job}`});}
    for(const group of state.groups){const saved=threads.get(group.id),members=group.member_ids.map(id=>state.specialists.find(item=>item.id===id)).filter(Boolean),names=members.map(member=>member.name);entries.push({section:'Conversations',element:row({name:group.title,meta:[...(group.include_nex===false?[]:['Nex']),...names].join(' + '),preview:saved?.title || 'Use @mentions to give your team a mission.',icon:'+',tone:'group',status:state.team_status?.[group.id] || (saved?.message_count?'Active':'Ready'),when:timeLabel(saved?.updated_at),run:()=>ctx.openConversation({kind:'group',...group,members})}),search:`${group.title} ${names.join(' ')}`});}
    const recent=ctx.recentThreads().filter(item=>!/^agent-|^group-|^nex-main$/u.test(item.id));
    for(const thread of recent)entries.push({section:'Recent',element:row({name:thread.title,meta:'Nex conversation',preview:`${thread.message_count || 0} messages`,icon:'N',tone:'recent',when:timeLabel(thread.updated_at || thread.ts),run:()=>ctx.openThread(thread)}),search:thread.title});
    const pinned=new Set(pinnedBundles(state.pinned_system_ids || []));
    for(const system of SPACE_BUNDLES.filter(item=>pinned.has(item.id))){const run=()=>bundleView(system.id);entries.push({section:'Nexus spaces',element:row({name:system.name,meta:'Nexus space',preview:system.description,icon:system.icon,tone:system.tone,run}),search:`${system.name} ${system.description}`});}
    entries.push({section:'Nexus spaces',element:row({name:'More',meta:'Customize Messages',preview:'Pin the Nexus spaces you want on this screen.',icon:'…',tone:'more',run:moreView}),search:'more customize pin nexus spaces'});
    const paint=(query='')=>{list.replaceChildren();const needle=query.toLowerCase().trim();let previous='';for(const entry of entries){if(needle && !entry.search.toLowerCase().includes(needle))continue;if(!needle && entry.section!==previous){if(previous && entry.section!=='Conversations')list.append(node('p',entry.section,'messagesection'));previous=entry.section;}list.append(entry.element);}if(!list.querySelector('.messageitem'))list.append(node('p','No conversations match that search.','messageempty'));};paint();search.oninput=()=>paint(search.value);
    root.append(button('New conversation',newConversation,'uxprimary messageprimary'));
    if(recent.length)root.append(button('Clear recent conversations',()=>clearConversations(recent),'messageclear'));
  }
  function moreView(message=''){
    heading(root,'More','Choose which Nexus spaces stay on your Messages screen.',draw);
    root.append(row({name:'Account & Controls',meta:'Settings and live usage',preview:'Usage, reply preferences, appearance, notifications, security, and data.',icon:'⌁',tone:'more',run:accountControls}));
    const pinned=new Set(pinnedBundles(state.pinned_system_ids || [])),list=node('div',undefined,'pinmanager');
    for(const system of SPACE_BUNDLES){
      const item=node('div',undefined,`pinmanagerrow${pinned.has(system.id)?' is-pinned':''}`);
      item.append(row({name:system.name,meta:'Connected spaces',preview:system.description,icon:system.icon,tone:system.tone,run:()=>bundleView(system.id)}));
      const toggle=button(pinned.has(system.id)?'Pinned':'Pin',async()=>{
        toggle.disabled=true;
        const next=new Set(pinnedBundles(state.pinned_system_ids || []));if(next.has(system.id))next.delete(system.id);else next.add(system.id);
        try{const data=await api('set_pinned_systems',{pinned_system_ids:[...next]});state.pinned_system_ids=data.pinned_system_ids;moreView(`${system.name} ${next.has(system.id)?'pinned to':'removed from'} Messages.`);}catch(error){toggle.disabled=false;showFeedback(root,friendlyError(error,{action:'save',subject:'your pinned spaces'}));}
      },'pinbutton');
      toggle.setAttribute('aria-pressed',String(pinned.has(system.id)));toggle.setAttribute('aria-label',`${pinned.has(system.id)?'Unpin':'Pin'} ${system.name}`);item.append(toggle);list.append(item);
    }
    root.append(list);
    if(typeof message==='string' && message.trim())showFeedback(root,message);
  }
  function bundleView(id){
    const bundle=SPACE_BUNDLES.find(item=>item.id===id);if(!bundle)return moreView();
    heading(root,bundle.name,bundle.description,moreView);
    const choices=node('div',undefined,'messagechoices');
    for(const member of bundle.members){const system=SYSTEMS.find(item=>item.id===member);if(system)choices.append(row({name:system.name,meta:bundle.name,preview:system.description,icon:system.icon,tone:system.tone,run:()=>ctx.openSystem(system.id)}));}
    root.append(choices);
  }
  function capabilitySettings(){
    heading(root,'Capabilities','Owner controls for Nex’s tools, skills, and commands.',accountControls);
    const choices=node('div',undefined,'messagechoices ownercontrols');
    for(const [section,name,copy] of [['tools','Tools','Callable abilities and access'],['skills','Skills','Installed operating knowledge'],['commands','Commands','Saved instructions and tool chains']])choices.append(row({name,meta:'Owner controls',preview:copy,icon:name[0],tone:'skills',run:()=>ownerCatalogView(section)}));
    root.append(choices);
  }
  function accountControls(){
    document.body.classList.add('messages-panel');
    return renderAccountControls(root,ctx,moreView,{
      notifications:notificationView,install:installView,feedback:feedbackView,capabilities:capabilitySettings,
      clearChats:()=>clearConversations(ctx.recentThreads().filter(item=>!/^agent-|^group-|^nex-main$/u.test(item.id))),
    });
  }
  async function readOwnerCatalog(){
    if(ownerCatalog)return ownerCatalog;
    const response=await fetch('/api/owner-capabilities',{credentials:'include',headers:{Accept:'application/json'},cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.error || 'Owner controls could not be loaded');error.status=response.status;throw error;}
    ownerCatalog=data;return data;
  }
  async function changeOwnerCatalog(action,input={}){
    const response=await fetch('/api/owner-capabilities',{method:action==='delete_command'?'DELETE':'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})});
    const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error || 'Owner controls could not be updated');error.status=response.status;throw error;}ownerCatalog=null;return data;
  }
  async function ownerCatalogView(section){
    const titles={tools:['Tools','Every callable ability Nex can load or use.'],skills:['Skills','Installed procedures that shape how Nex works.'],commands:['Commands','Exact shortcuts you can type in a conversation.']};
    const [title,copy]=titles[section] || titles.tools;heading(root,title,copy,capabilitySettings);root.append(node('p','Loading…','messageempty'));
    try{
      const data=await readOwnerCatalog();root.querySelector('.messageempty')?.remove();const items=Array.isArray(data[section])?data[section]:[];
      const config=CAPABILITY_BUILDERS[section] || CAPABILITY_BUILDERS.tools;
      root.append(button(config.title,()=>section==='commands'?commandBuilder(items):ownerCapabilityBuilder(section),'uxprimary messagecontinue'));
      root.append(node('p',section==='commands'?'Save a reusable instruction or arrange real tools into an ordered chain Nex can select.':`Scope it here, then Nex will wire and test the real ${config.singular} before it appears as active.`,'guidedraftnote'));
      if(section==='tools'){
        const grouped=new Map();for(const tool of items){const label=tool.category_label || 'Other';if(!grouped.has(label))grouped.set(label,[]);grouped.get(label).push(tool);}
        for(const [label,tools] of grouped)root.append(group(label,tools.map(tool=>row({name:tool.name,meta:[tool.core?'always loaded':tool.category,tool.sideEffect,`${tool.risk} risk`].filter(Boolean).join(' · '),preview:String(tool.description || '').slice(0,150),icon:tool.sideEffect==='write'?'W':'R',tone:tool.risk==='high'?'operations':'skills',run:()=>ownerCatalogDetail('tools',tool)}))));
      }else if(section==='skills'){
        root.append(group('Installed skills',items.map(skill=>row({name:skill.name,meta:Array.isArray(skill.triggers)&&skill.triggers.length?`Triggers: ${skill.triggers.slice(0,4).join(', ')}`:'Loaded when relevant',preview:String(skill.description || '').slice(0,150),icon:'S',tone:'skills',run:()=>ownerCatalogDetail('skills',skill)}))));
      }else{
        const builtIn=items.filter(command=>command.type!=='saved'),saved=items.filter(command=>command.type==='saved');
        if(saved.length)root.append(group('Your commands & tool chains',saved.map(command=>row({name:command.name,meta:command.tool_names?.length?`${command.tool_names.length} tools · ${command.scopes?.join(', ')}`:'Saved command',preview:command.description || command.instructions,icon:'⌘',tone:'pod',run:()=>ownerCatalogDetail('commands',command)}))));
        root.append(group('Built-in commands',builtIn.map(command=>row({name:command.name,meta:command.description,preview:`Example: ${command.example}`,icon:'›',tone:'pod',run:()=>ownerCatalogDetail('commands',command)}))));
      }
      if(!items.length)root.append(node('p',`No ${section} are registered yet.`,'messageempty'));
      root.append(button('Back to Settings',accountControls,'messagesecondary'));
    }catch(error){root.replaceChildren();heading(root,title,copy,capabilitySettings);root.append(node('p',friendlyError(error,{action:'load',subject:section}),'messageempty'),button('Try again',()=>{ownerCatalog=null;ownerCatalogView(section);},'uxprimary messagecontinue'),button('Back to Settings',accountControls,'messagesecondary'));}
  }
  function ownerCatalogDetail(section,item){
    heading(root,item.name,section==='tools'?'Callable tool details':section==='skills'?'Installed skill instructions':item.type==='saved'?'Saved command and tool chain':'Built-in command',()=>ownerCatalogView(section));
    const card=node('section',undefined,'installcard capabilitydetail');card.append(node('p',item.description || item.trigger || 'No description saved.'));
    if(section==='tools'){
      card.append(node('h3','Access'),node('p',[item.category_label,item.core?'Always loaded':'Loaded when relevant',`${item.sideEffect} access`,`${item.risk} risk`].filter(Boolean).join(' · ')));
      const fields=Object.entries(item.input_schema?.properties || {});card.append(node('h3','Inputs'));
      if(fields.length){const list=node('ul',undefined,'capabilityfields');for(const [name,definition] of fields){const field=node('li');field.append(node('strong',name),node('span',definition.description || definition.type || 'Input'));list.append(field);}card.append(list);}else card.append(node('p','This tool does not require inputs.'));
    }else if(section==='skills'){
      card.append(node('h3','Triggers'),node('p',item.triggers?.length?item.triggers.join(', '):'Nex loads this when its purpose matches the request.'),node('h3','Full instructions'),node('pre',item.instructions || 'No instructions available.','capabilityinstructions'));
    }else if(item.type==='saved'){
      card.append(node('h3','When Nex should use it'),node('p',item.trigger || 'When you explicitly choose it.'),node('h3','Instructions'),node('p',item.instructions),node('h3','Ordered tool chain'),node('p',item.tool_names?.length?item.tool_names.join(' → '):'Instruction-only command; no fixed tools.'),node('h3','Available in'),node('p',item.scopes?.join(', ') || 'conversation'));
    }else card.append(node('h3','Example'),node('p',item.example || ''));
    root.append(card);
    if(section==='commands'&&item.type==='saved'){
      root.append(button('Run with Nex',()=>ctx.draftPrompt?.(`Use my saved command "${item.name}" (${item.id}) for this request. Load it with use_saved_command, follow its ordered tool chain, and keep every normal approval and verification step.`),'uxprimary messagecontinue'));
      root.append(button('Delete saved command',async()=>{try{await changeOwnerCatalog('delete_command',{command_id:item.id});ownerCatalogView('commands');}catch(error){showFeedback(root,friendlyError(error,{action:'delete',subject:'this command'}));}},'messagesecondary'));
    }
    root.append(button(`Back to ${section[0].toUpperCase()+section.slice(1)}`,()=>ownerCatalogView(section),'messagesecondary'));
  }
  function commandBuilder(items){
    const tools=(ownerCatalog?.tools || []).slice().sort((a,b)=>a.name.localeCompare(b.name)),selected=[];
    heading(root,'Add a command','Save reusable instructions, or add tools in the order Nex should use them.',()=>ownerCatalogView('commands'));
    const form=node('form',undefined,'messageform'),name=node('input'),description=node('textarea'),trigger=node('textarea'),instructions=node('textarea'),scope=node('fieldset'),status=node('p',undefined,'messageformstatus');
    name.required=true;name.maxLength=80;name.placeholder='Command name, like Check and repair deployment';description.maxLength=400;description.placeholder='What this command accomplishes';trigger.maxLength=300;trigger.placeholder='When should Nex choose it?';instructions.required=true;instructions.maxLength=2400;instructions.placeholder='What should Nex do, check, and return?';
    const chain=node('fieldset');chain.append(node('legend','Tool chain (optional, ordered)'));const picker=node('select');picker.append(node('option','Choose a tool to add'));for(const tool of tools){const option=node('option',tool.name);option.value=tool.name;picker.append(option);}const steps=node('div',undefined,'commandsteps');
    const paintSteps=()=>{steps.replaceChildren();if(!selected.length)steps.append(node('p','No fixed tools. Nex will follow the saved instructions.','guidedraftnote'));for(const [index,tool] of selected.entries())steps.append(button(`${index+1}. ${tool}  ×`,()=>{selected.splice(index,1);paintSteps();},'commandstep'));};paintSteps();
    chain.append(picker,button('Add tool to chain',()=>{if(picker.value&&!selected.includes(picker.value)){selected.push(picker.value);paintSteps();picker.value='';}},'messagesecondary'),steps);
    scope.append(node('legend','Where should Nex use it?'));for(const [value,label,checked] of [['conversation','Nex conversations',true],['specialists','Specialist agents',false],['groups','Agent groups',false],['projects','Projects and Builder',false],['life','Nexus Life',false]]){const option=node('label'),input=node('input');input.type='checkbox';input.value=value;input.checked=checked;option.append(input,node('span',label));scope.append(option);}
    const save=button('Save command',null,'uxprimary');save.type='submit';status.setAttribute('role','status');form.append(node('label','Name'),name,node('label','Description'),description,node('label','When to use it'),trigger,node('label','Instructions'),instructions,chain,scope,save,status);root.append(form,button('Back to Commands',()=>ownerCatalogView('commands'),'messagesecondary'));
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await changeOwnerCatalog('create_command',{name:name.value,description:description.value,trigger:trigger.value,instructions:instructions.value,tool_names:selected,scopes:[...scope.querySelectorAll('input:checked')].map(input=>input.value)});ownerCatalogView('commands');}catch(error){status.textContent=friendlyError(error,{action:'save',subject:'this command',keepDraft:true});save.disabled=false;}};
  }
  function ownerCapabilityBuilder(section){
    const config=CAPABILITY_BUILDERS[section] || CAPABILITY_BUILDERS.tools;
    heading(root,config.title,`Define the ${config.singular}. Nex will ask anything missing, build it, test it, and open a PR before it becomes active.`,()=>ownerCatalogView(section));
    const form=node('form',undefined,'messageform'),name=node('input'),purpose=node('textarea'),behavior=node('textarea'),scope=node('fieldset'),status=node('p',undefined,'messageformstatus');
    name.required=true;name.maxLength=80;name.placeholder=config.namePlaceholder;
    purpose.required=true;purpose.maxLength=600;purpose.placeholder=config.purposePlaceholder;
    behavior.required=true;behavior.maxLength=1200;behavior.placeholder=config.behaviorPlaceholder;
    scope.append(node('legend','Where should it be available?'));
    for(const [value,label,checked] of [['conversation','Nex conversations',true],['specialists','Specialist agents',false],['groups','Agent groups',false],['projects','Projects and Builder',false],['life','Nexus Life',false]]){
      const option=node('label'),input=node('input');input.type='checkbox';input.value=value;input.checked=checked;option.append(input,node('span',label));scope.append(option);
    }
    const create=button('Scope with Nex',null,'uxprimary');create.type='submit';status.setAttribute('role','status');
    form.append(node('label','Name'),name,node('label','Purpose'),purpose,node('label','What should it do?'),behavior,scope,create,status);
    root.append(form,button(`Back to ${config.title.replace('Add a ','')}`,()=>ownerCatalogView(section),'messagesecondary'));
    form.onsubmit=async(event)=>{event.preventDefault();create.disabled=true;status.textContent=`Opening Nex to scope this ${config.singular}…`;const scopes=[...scope.querySelectorAll('input:checked')].map(input=>input.value);const prompt=buildOwnerCapabilityPrompt(section,{name:name.value,purpose:purpose.value,behavior:behavior.value,scopes});try{if(ctx.draftPrompt)await ctx.draftPrompt(prompt);else{window.dispatchEvent(new CustomEvent('nexus:nex-prompt',{detail:{text:prompt}}));ctx.openConversation?.({kind:'nex',name:'Nex'});}}catch(error){status.textContent=friendlyError(error,{action:'save',subject:`this ${config.singular}`,keepDraft:true});create.disabled=false;}};
  }
  function feedbackView(){
    heading(root,'Report a problem','Tell us what happened or what would make Nexus better.',accountControls);
    const form=node('form',undefined,'messageform'),category=node('select'),message=node('textarea'),status=node('p',undefined,'messageformstatus');
    for(const [value,label] of [['problem','Something went wrong'],['idea','I have an idea'],['other','Something else']]){const option=node('option',label);option.value=value;category.append(option);}
    message.required=true;message.maxLength=4000;message.placeholder='What happened? What did you expect?';status.setAttribute('role','status');
    const send=button('Send feedback',null,'uxprimary messagecontinue');send.type='submit';form.append(node('label','What kind of feedback?'),category,node('label','Tell us about it'),message,send,status);root.append(form,button('Back to Settings',accountControls,'messagesecondary'));
    form.onsubmit=async(event)=>{event.preventDefault();send.disabled=true;try{const response=await fetch('/api/feedback',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:category.value,message:message.value,page:location.pathname+location.search})}),data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error || 'Feedback could not be sent');moreView('Thanks—your feedback was sent.');}catch(error){status.textContent=friendlyError(error,{action:'send',subject:'your feedback',keepDraft:true});send.disabled=false;}};
    message.focus();
  }
  async function notificationView(message=''){
    heading(root,'Phone notifications','Let Schedule and Reminders reach you when Nexus is closed.',accountControls);
    const card=node('section',undefined,'installcard');card.append(avatar('✓','reminders'));
    const status=node('p','Checking this device…','messageformstatus');card.append(node('h3','Stay ahead of your day.'),node('p','Nexus only sends alerts you asked for. Tap one to open the right Schedule or Reminder.'),status);root.append(card);
    try{
      const state=await notificationState();
      if(state.support==='install-required'){status.textContent='On iPhone and iPad, add Nexus to your Home Screen first. Open the Nexus icon, then return here to turn on alerts.';root.append(button('Install Nexus',installView,'uxprimary messagecontinue'),button('Back to Settings',accountControls,'messagesecondary'));return;}
      if(state.support!=='supported'){status.textContent=state.support==='insecure'?'Open the secure Nexus app to turn on alerts.':'This device or browser does not support Nexus phone alerts yet.';root.append(button('Back to Settings',accountControls,'uxprimary messagecontinue'));return;}
      if(!state.configured){status.textContent='Phone alerts are being connected. Everything else in Nexus still works.';root.append(button('Back to Settings',accountControls,'uxprimary messagecontinue'));return;}
      status.textContent=state.enabled?'Notifications are on for this device.':'Notifications are off for this device.';
      const toggle=button(state.enabled?'Turn off notifications':'Turn on notifications',async()=>{toggle.disabled=true;try{if(state.enabled)await disableNotifications();else await enableNotifications();notificationView(state.enabled?'Notifications turned off.':'Notifications are on. A test alert was sent.');}catch(error){toggle.disabled=false;showFeedback(root,notificationError(error));}},'uxprimary messagecontinue');
      root.append(toggle,button('Back to Settings',accountControls,'messagesecondary'));if(typeof message==='string' && message.trim())showFeedback(root,message);
    }catch(error){status.textContent=notificationError(error);root.append(button('Try again',notificationView,'uxprimary messagecontinue'),button('Back to Settings',accountControls,'messagesecondary'));}
  }
  function installView(){
    const state=nexusInstallState();heading(root,state==='installed'?'Nexus is installed':'Install Nexus',state==='installed'?'Open Nexus from your Home Screen whenever you need it.':'Give Nexus its own icon and full-screen home on this device.',accountControls);
    const card=node('section',undefined,'installcard');card.append(avatar('N','nex'));
    if(state==='installed'){
      card.append(node('h3','You’re all set.'),node('p','Nexus already opens as an app on this device. Your projects, schedule, reminders, and Life stay connected to your account.'));
      root.append(card,button('Back to Settings',accountControls,'uxprimary messagecontinue'));return;
    }
    if(state==='prompt'){
      card.append(node('h3','Ready to install.'),node('p','Nexus will get its own icon and open without the browser around it.'));
      const install=button('Install Nexus',async()=>{install.disabled=true;const result=await installNexus();if(result.outcome==='accepted')installView();else{install.disabled=false;showFeedback(root,'Installation was not completed. You can try again whenever you’re ready.');}},'uxprimary messagecontinue');
      root.append(card,install,button('Not now',accountControls,'messagesecondary'));return;
    }
    const ios=nexusInstallState()==='ios';
    const steps=node('ol',undefined,'installsteps');
    const instructions=ios
      ? [['1','Tap Share','Use the Share button in Safari.'],['2','Add to Home Screen','Scroll down and choose Add to Home Screen.'],['3','Add Nexus','Keep Open as Web App turned on, then tap Add.']]
      : [['1','Open your browser menu','Look for Install app or Add to Home Screen.'],['2','Choose Install Nexus','Confirm the installation when your browser asks.'],['3','Open Nexus','Use the new Nexus icon on your device.']];
    for(const [number,title,copy] of instructions){const item=node('li');item.append(node('b',number),node('span',undefined,'installstepcopy'));item.lastChild.append(node('strong',title),node('small',copy));steps.append(item);}
    card.append(node('h3',ios?'Install from Safari':'Install from your browser'),steps);root.append(card,button('Got it',accountControls,'uxprimary messagecontinue'));
  }
  function clearConversations(recent){
    const kept=new Set();heading(root,'Clear conversations','Keep useful facts, preferences, decisions, and project details in Memory, then clear the chats. Chats with nothing important save nothing. Projects, schedules, reminders, and your agents stay safe. Choose Keep on any recent chat you still want.',draw);
    const summary=node('p',`${recent.length} recent conversation${recent.length===1?'':'s'} selected to clear.`,'clearsummary');root.append(summary);
    const list=node('div',undefined,'clearlist');
    const update=()=>{const count=recent.length-kept.size;summary.textContent=count?`${count} conversation${count===1?'':'s'} will be cleared. Anything marked Keep will stay.`:'Everything is marked Keep. Nothing will be cleared.';clear.disabled=count===0;clear.textContent=count?`Clear ${count} conversation${count===1?'':'s'}`:'Nothing to clear';};
    for(const thread of recent){const item=node('label',undefined,'clearitem');const input=node('input');input.type='checkbox';input.setAttribute('aria-label',`Keep ${thread.title}`);input.onchange=()=>{if(input.checked)kept.add(thread.id);else kept.delete(thread.id);update();};const copy=node('span',undefined,'clearcopy');copy.append(node('strong',thread.title),node('small',`${thread.message_count || 0} messages`));item.append(copy,input,node('span','Keep','keeplabel'));list.append(item);}root.append(list);
    const status=node('p',undefined,'messageformstatus');status.setAttribute('role','status');
    const clear=button('',async()=>{clear.disabled=true;back.disabled=true;status.textContent='Checking key details, then clearing conversations…';try{const result=await ctx.clearRecentThreads([...kept]);await load(`${result.deleted || 0} conversation${result.deleted===1?'':'s'} cleared. ${result.memoriesSaved || 0} new key detail${result.memoriesSaved===1?'':'s'} remembered.`);}catch(error){status.textContent=friendlyError(error,{action:'clear',subject:'those conversations'});clear.disabled=false;back.disabled=false;}},'uxprimary clearprimary');
    const back=button('Back to Messages',draw,'messagesecondary');root.append(clear,back,status);update();
  }
  function newConversation(){
    heading(root,'New conversation','Talk with Nex or bring a team together.',draw);
    const choices=node('div',undefined,'messagechoices');
    choices.append(row({name:'Nex',meta:'Talk with Nex',preview:'Ask anything or start something new.',icon:'N',tone:'nex',run:()=>ctx.openConversation({kind:'nex',name:'Nex'},true)}));
    choices.append(row({name:'Team',meta:'Choose your team',preview:'Bring agents into one shared conversation.',icon:'+',tone:'group',run:createGroup}));
    root.append(choices,button('Back to Messages',draw,'messagesecondary'));
  }
  function createSpecialist(){
    let selected='research';wizardHeading(root,'Create a specialist','Step 1 of 2',createGroup);root.append(node('h3','What should this agent help with?','messagequestion'));const choices=node('div',undefined,'rolechoices');
    const selectRole=(role)=>{selected=role;for(const el of choices.children)el.setAttribute('aria-pressed',String(el.dataset.role===role));};
    for(const [role,info] of Object.entries(state.roles)){const choice=button('',()=>selectRole(role),`rolechoice${role==='custom'?' optionalrole':''}`);choice.dataset.role=role;const copy=node('span',undefined,'rolecopy');copy.append(node('strong',info.label),node('span',info.description));choice.append(avatar(info.label,role),copy,node('i','', 'rolecheck'));choices.append(choice);}selectRole(selected);
    const different=button('⌄  Choose a different role',()=>choices.classList.toggle('showoptional'),'differentrole');
    root.append(choices,different,button('Continue',()=>specialistDetails(selected),'uxprimary messagecontinue'),node('p','♢  You choose what this agent can access before it starts.','messageprivacy'));
  }
  function specialistDetails(role){
    const info=state.roles[role];wizardHeading(root,'Name your specialist','Step 2 of 2',createSpecialist);root.append(node('h3','Give this specialist a clear identity.','messagequestion'));const form=document.createElement('form');form.className='messageform';
    const name=node('input');name.required=true;name.maxLength=40;name.placeholder=role==='research'?'Atlas':role==='build'?'Mason':role==='life'?'Vida':role==='review'?'Vera':'Specialist name';
    const job=node('textarea');job.maxLength=240;job.value=info.description;const scope=node('fieldset');scope.append(node('legend','What should this specialist work with?'));
    for(const value of state.scopes){const label=node('label');const input=node('input');input.type='checkbox';input.value=value;input.checked=info.defaultScopes.includes(value);if(value==='conversation'){input.checked=true;input.disabled=true;}label.append(input,node('span',SCOPE_LABELS[value] || value));scope.append(label);}
    const save=button('Create specialist',null,'uxprimary');save.type='submit';const status=node('p',undefined,'messageformstatus');status.setAttribute('role','status');form.append(node('label','Name'),name,node('label','Job'),job,scope,save,status);root.append(form,button('Back',createSpecialist,'messagesecondary'));
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;try{const scopes=[...scope.querySelectorAll('input:checked')].map(input=>input.value);const data=await api('create_specialist',{name:name.value,role,job:job.value,scopes});state=await api();createGroup();showFeedback(root,`${data.specialist.name} is ready. Choose them for your team.`);}catch(error){status.textContent=friendlyError(error,{subject:'this specialist',keepDraft:true});save.disabled=false;}};
  }
  function createGroup(){
    heading(root,'Start a team','Name your team and choose who belongs. You can decide what it works on later.',newConversation);const form=document.createElement('form');form.className='messageform';const title=node('input');title.required=true;title.maxLength=60;title.placeholder='Team name';const members=node('fieldset');members.append(node('legend','Choose agents'));if(!state.specialists.length)members.append(node('p','Add an agent to create your first team.'));
    for(const specialist of state.specialists){const label=node('label');const input=node('input');input.type='checkbox';input.value=specialist.id;label.append(input,node('span',`${specialist.name} · ${state.roles[specialist.role]?.label || 'Specialist'}`));members.append(label);}
    const save=button('Create team',null,'uxprimary');save.disabled=!state.specialists.length;save.type='submit';const status=node('p',undefined,'messageformstatus');status.setAttribute('role','status');const nex=node('label'),include=node('input');include.type='checkbox';nex.append(include,node('span','Include Nex for a final review'));form.append(node('label','Team name'),title,members,button('Add an agent',createSpecialist,'messagesecondary'),nex,save,status);root.append(form,button('Back',newConversation,'messagesecondary'));
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;try{const member_ids=[...members.querySelectorAll('input:checked')].map(input=>input.value);const data=await api('create_group',{title:title.value,member_ids,include_nex:include.checked});const names=member_ids.map(id=>state.specialists.find(item=>item.id===id)?.name).filter(Boolean);ctx.openConversation({kind:'group',...data.group,members:names},true);}catch(error){status.textContent=friendlyError(error,{subject:'this team',keepDraft:true});save.disabled=false;}};
  }
  await load();return root;
}
