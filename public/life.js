import {calendarKey,calendarDayItems,renderScheduleCalendar} from './schedule-calendar.js';
const PILLARS=[['work','Work','#6f9ce8'],['sleep','Sleep','#879ade'],['social','Social','#df7fa4'],['health','Health','#65b8b2'],['personal','Personal','#bd91d9']];
const state={tab:'today',date:new Date(),mode:'month',rhythmDate:new Date()};
const node=(tag,text,cls='')=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;el.className=cls;return el;};
const button=(text,run)=>{const el=node('button',text);el.type='button';el.onclick=run;return el;};
const field=(label,input)=>{const el=node('label',label);el.append(input);return el;};
const local=(date)=>`${calendarKey(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
const clock=(date)=>new Date(date).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
function select(values,value){const el=node('select');for(const [key,label] of values){const option=node('option',label);option.value=String(key);el.append(option);}el.value=String(value);return el;}
async function api(action,input={}){const response=await fetch('/api/life',{credentials:'include',...(action ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})} : {})});const data=await response.json();if(!response.ok)throw new Error(data.error || 'Could not save Life');return data;}
export function lifeWeekItems(items,day){const from=new Date(day);from.setHours(0,0,0,0);from.setDate(from.getDate()-((from.getDay()+6)%7));const to=new Date(from);to.setDate(to.getDate()+7);return items.filter(item=>item.starts_at && Date.parse(item.starts_at)<+to && Date.parse(item.ends_at)>+from);}
export async function renderLife(ctx){
  const root=node('section',undefined,'nexuslife');let data={items:[],profile:{focus:[],goals:''}};let drawId=0;
  async function load(){try{data=await api();await draw();}catch(error){root.replaceChildren(node('p',error.message),button('Try again',load));}}
  function heading(){root.replaceChildren();const head=node('div',undefined,'lifehead');head.append(node('div','NEXUS LIFE','lifeeyebrow'),node('h2','Make room for your life.'),node('p','Plan your time. Notice how it feels. Shape what comes next.'));root.append(head);}
  async function draw(){
    const generation=++drawId;heading();
    const tabs=node('nav',undefined,'lifetabs');tabs.setAttribute('aria-label','Life views');
    for(const [key,label] of [['today','Today'],['calendar','Life calendar'],['reminders','Life reminders'],['insights','Your rhythm']]){const tab=button(label,()=>{state.tab=key;return draw();});tab.setAttribute('aria-pressed',String(state.tab===key));tabs.append(tab);}root.append(tabs);
    const actions=node('div',undefined,'lifeactions');actions.append(button('+ Plan an activity',()=>form()),button('+ Remember something',()=>form(null,'reminder')),button('✦ Plan with Nex',()=>askNex('Help me design my Life week around my priorities. Read Life and Nex Schedule. Ask only the decisions you need, using relevant clickable options. Preview each linked change and get my approval.')),button('My priorities',preferences));root.append(actions);
    if(!data.profile.onboarded){const welcome=node('div',undefined,'lifewelcome');welcome.append(node('h3','Start with what matters to you.'),node('p','Choose a few priorities, or jump straight into your day. You can change them anytime.'),button('Choose my priorities',preferences),button('Skip for now',async()=>{await api('profile',{focus:[]});await load();}));root.append(welcome);}
    if(state.tab==='calendar'){
      const calendar=await renderScheduleCalendar({calendarState:state,calendarEndpoint:'/api/life',calendarSubject:'Life plan',detailsLabel:'Check in',balanceLabel:'Your rhythm',weekLabel:'Design next week',
        openScheduleStudio:(_mode,day,minutes)=>_mode==='week' ? askNex('Help me design a balanced Life week. Read my priorities, Life records, and Nex Schedule. Show relevant clickable choices and preview conflicts before linking anything.') : form(null,'activity',day,minutes),
        editScheduleItem:item=>form(item,item.kind==='reminder' ? 'reservation' : 'activity'),editScheduleNotes:item=>form(item),openPlannerItem:item=>item.kind==='reminder' ? form(item) : checkIn(item),detailsLabelFor:item=>item.kind==='reminder' ? 'Reminder' : 'Check in',
        openScheduleOverrun:item=>askNex(`Life activity ${item.id}, ${item.title}, is running over. Ask how much time I need. Read Life and Nex Schedule, preserve protected commitments, and preview any changes before I approve them.`),
        openWeekRollover:()=>askNex('Help me design next week in Life. Suggest keeping routines that worked and adjusting what did not. Read my records before suggesting anything.'),ask:askNex,
      },{balance:()=>rhythm(state.date)});if(generation!==drawId)return;root.append(calendar);
    }else if(state.tab==='reminders')reminders();else if(state.tab==='insights')root.append(rhythm());else today();
    root.append(node('p','Life stays private to your account. Linking to Nex is always your choice.','lifehint'));
  }
  function askNex(prompt){return ctx.ask(`You are helping inside Nexus Life. Use read_life and manage_life for Life-owned records; ordinary Nex Schedule and Reminders are separate until explicitly linked. Never infer actual experience or energy from planned time. ${prompt}`);}
  function row(item){
    const card=node('article',undefined,'lifeactivity');card.style.setProperty('--pillar',PILLARS.find(([key])=>key===item.pillar)?.[2]);
    card.append(node('small',`${PILLARS.find(([key])=>key===item.pillar)?.[1]} · ${item.link_missing ? 'Nex link is missing' : item.link ? 'Linked to Nex' : 'Life only'}`),node('h3',item.title));
    card.append(node('p',item.starts_at ? `${clock(item.starts_at)} – ${clock(item.ends_at)}` : item.due_date || 'No date'));
    if(item.person || item.place)card.append(node('p',[item.person,item.place].filter(Boolean).join(' · ')));
    if(item.reflection)card.append(node('p',item.reflection,'lifereflection'));
    const actions=node('div',undefined,'lifeactions');actions.append(button('Edit plan',()=>form(item)),button(item.kind==='activity' ? 'How was it?' : item.status==='done' ? 'Reopen' : 'Done',()=>item.kind==='activity' ? checkIn(item) : complete(item)));
    if(item.kind==='reminder' && item.status!=='done')actions.append(button(item.starts_at ? 'Change reserved time' : 'Find time in Life',()=>form(item,'reservation')));
    if(item.memory_url){const link=node('a','Open memory');link.href=item.memory_url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}card.append(actions);return card;
  }
  function today(){
    const date=calendarKey(new Date()),activities=calendarDayItems(data.items.filter(item=>item.starts_at && item.status!=='done'),new Date()).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
    root.append(node('h3',new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}),'lifesectiontitle'));
    if(!activities.length)root.append(node('p','Your day has room. Add one activity or ask Nex to help you plan.','lifeempty'));
    for(const item of activities)root.append(row(item));
    const due=data.items.filter(item=>item.kind==='reminder' && item.status!=='done' && item.due_date && item.due_date<=date && !activities.some(activity=>activity.id===item.id));
    if(due.length){root.append(node('h3','Things to remember','lifesectiontitle'));due.forEach(item=>root.append(row(item)));}
    root.append(button('Help me make today feel better',()=>askNex('Read my Life priorities, today’s records, and recent energy check-ins. Offer one or two relevant choices for a more enjoyable or manageable day. Explain what records support your suggestion; if there is too little data, ask me what I want.')));
  }
  function reminders(){
    root.append(node('p','Small things to remember, with a home in your Life plan. Dates are optional.'));
    const active=data.items.filter(item=>item.kind==='reminder' && item.status!=='done');if(!active.length)root.append(node('p','Nothing waiting. Add something you want to remember.','lifeempty'));active.forEach(item=>root.append(row(item)));
    const done=data.items.filter(item=>item.kind==='reminder' && item.status==='done');if(done.length){const details=node('details');details.append(node('summary',`Completed · ${done.length}`));done.forEach(item=>details.append(row(item)));root.append(details);}
    root.append(node('p','Timed reminders appear while Nexus is open. They do not send background phone notifications.','lifehint'));
  }
  async function complete(item){try{await api('check_in',{id:item.id,status:item.status==='done' ? 'planned' : 'done'});await load();}catch(error){errorBox(error);}}
  function rhythm(day=state.rhythmDate){
    const host=node('section',undefined,'liferhythm');host.append(node('h3',`Your rhythm · ${day.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`),node('p','Planned time and confirmed experience are different. Missing check-ins are simply unknown.'));
    const items=lifeWeekItems(data.items,day);let rated=0;
    const from=new Date(day);from.setHours(0,0,0,0);from.setDate(from.getDate()-((from.getDay()+6)%7));const to=new Date(from);to.setDate(to.getDate()+7);
    const hours=(item,actual=false)=>Math.max(0,(Math.min(+to,Date.parse(actual ? item.actual_ends_at : item.ends_at))-Math.max(+from,Date.parse(actual ? item.actual_starts_at : item.starts_at)))/3600000);
    const weeks=node('div',undefined,'lifeactions');
    for(const [label,offset] of [['Previous week',-7],['Next week',7]])weeks.append(button(label,()=>{const next=new Date(day);next.setDate(next.getDate()+offset);state.rhythmDate=next;state.tab='insights';return draw();}));
    weeks.append(button('This week',()=>{state.rhythmDate=new Date();state.tab='insights';return draw();}));host.append(weeks);
    for(const [pillar,label,color] of PILLARS){
      const activities=items.filter(item=>item.pillar===pillar),planned=activities.reduce((sum,item)=>sum+hours(item),0);
      const actual=activities.filter(item=>item.outcome==='happened' && item.actual_starts_at && item.actual_ends_at).reduce((sum,item)=>sum+hours(item,true),0);
      const ratings=activities.filter(item=>item.energy!=null);rated+=ratings.length;
      const card=node('div',undefined,'lifepillarrow');card.style.setProperty('--pillar',color);card.append(node('strong',label),node('p',`${planned.toFixed(1)} hours planned · ${actual.toFixed(1)} hours confirmed`));
      const bar=node('div',undefined,'lifechart');bar.setAttribute('role','img');bar.setAttribute('aria-label',`${label}: ${planned.toFixed(1)} hours planned, ${actual.toFixed(1)} hours confirmed`);
      const fill=node('span');fill.style.width=`${Math.min(100,planned/Math.max(1,...PILLARS.map(([key])=>items.filter(item=>item.pillar===key).reduce((sum,item)=>sum+hours(item),0)))*100)}%`;bar.append(fill);card.append(bar);
      card.append(node('small',ratings.length ? `Reported energy: ${(ratings.reduce((sum,item)=>sum+item.energy,0)/ratings.length).toFixed(1)}/5 · ${ratings.length} check-ins` : 'No energy ratings yet'));host.append(card);
    }
    host.append(node('p',`${items.filter(item=>item.kind==='activity' && item.outcome==='unknown').length} activities have no experience check-in. ${rated} energy ratings recorded.`));
    host.append(button('Explore my week with Nex',()=>askNex(`Read my Life records for the week containing ${calendarKey(day)}. Compare intended time with confirmed experience. Discuss energy only where I supplied ratings, distinguish patterns from causes, and offer clickable choices for next week.`)));
    return host;
  }
  function errorBox(error){const status=node('p',error.message,'lifeerror');status.setAttribute('role','status');root.append(status);}
  function preferences(){
    ++drawId;heading();root.append(node('h3','What would you like more room for?'),node('p','Choose any that matter. You can skip this.'));
    const chosen=new Set(data.profile.focus || []),choices=node('div',undefined,'lifeactions');for(const [key,label] of PILLARS){const choice=button(label,()=>{chosen.has(key) ? chosen.delete(key) : chosen.add(key);choice.setAttribute('aria-pressed',String(chosen.has(key)));});choice.setAttribute('aria-pressed',String(chosen.has(key)));choices.append(choice);}root.append(choices);
    const goals=node('textarea');goals.value=data.profile.goals || '';goals.placeholder='Something you want more of, or a rhythm you want to change…';goals.maxLength=2000;root.append(field('Anything else? (optional)',goals));
    const save=button('Save my priorities',async()=>{save.disabled=true;try{await api('profile',{focus:[...chosen],goals:goals.value});await load();}catch(error){save.disabled=false;errorBox(error);}});root.append(save,button('Back',draw));
  }
  function form(item=null,kind='activity',day,minutes){
    ++drawId;heading();const reservation=kind==='reservation';kind=item?.kind || kind;const timed=kind==='activity' || reservation;const form=document.createElement('form');form.className='lifeform';root.append(node('h3',item ? 'Edit your plan' : timed ? 'Plan an activity' : 'Remember something'),form);
    const title=node('input');title.value=item?.title || '';title.required=true;title.maxLength=160;title.placeholder=timed ? 'A walk, work, dinner with someone…' : 'Call someone, pick something up…';
    const pillar=select(PILLARS.map(([key,label])=>[key,label]),item?.pillar || 'personal');
    const date=node('input');date.type='date';date.value=timed && item?.starts_at ? calendarKey(new Date(item.starts_at)) : item?.due_date || day || calendarKey(new Date());date.required=timed;
    const minuteOptions=Array.from({length:96},(_,i)=>{const minute=i*15,hour=Math.floor(minute/60);return [minute,`${hour%12 || 12}:${String(minute%60).padStart(2,'0')} ${hour<12 ? 'AM' : 'PM'}`];});
    const startDate=item?.starts_at ? new Date(item.starts_at) : item?.due_at ? new Date(item.due_at) : null;
    const selected=startDate ? startDate.getHours()*60+startDate.getMinutes() : minutes ?? 540;if(selected%15)minuteOptions.push([selected,clock(startDate)]);
    const time=select(!timed ? [['','No time'],...minuteOptions] : minuteOptions,!timed && !item?.due_at ? '' : selected);
    const oldDuration=item?.ends_at ? Math.round((Date.parse(item.ends_at)-Date.parse(item.starts_at))/60000) : 60;
    const duration=select([...new Set([...Array.from({length:64},(_,i)=>(i+1)*15),oldDuration])].sort((a,b)=>a-b).map(value=>[value,value<60 ? `${value} minutes` : `${value/60} hours`]),oldDuration);
    if(!item && timed){const suggestions=node('div',undefined,'lifeactions');
      for(const [label,key,length] of [['Work','work',480],['Sleep','sleep',480],['Movement','health',30],['Social time','social',60],['Time for myself','personal',60]])suggestions.append(button(label,()=>{title.value=label;pillar.value=key;duration.value=String(length);refresh();}));form.append(suggestions);
    }
    const notes=node('textarea');notes.value=item?.notes || '';notes.maxLength=4000;notes.placeholder='Details you want to remember';
    form.append(field('What is it?',title),field('Life pillar',pillar),field(timed ? 'Day' : 'Date (optional)',date),field(timed ? 'Start time' : 'Reminder time (optional)',time));
    const end=node('p',undefined,'lifeend');if(timed)form.append(field('Planned duration',duration),end);
    const more=node('details');more.append(node('summary','Optional details'));
    const person=node('input');person.value=item?.person || '';person.maxLength=160;const place=node('input');place.value=item?.place || '';place.maxLength=160;
    const protect=node('input');protect.type='checkbox';protect.checked=item?.protected || false;
    more.append(field('Notes',notes));if(timed)more.append(field('Who with?',person),field('Where?',place),field('Keep this time fixed',protect));form.append(more);
    const preview=node('button','Review my plan');preview.type='submit';const status=node('p');status.setAttribute('role','status');form.append(preview,button('Back',draw),status);
    if(item)form.append(button('Delete',async()=>{if(!confirm(`Delete ${item.title}${item.link ? ' and its linked Nex item' : ''}?`))return;try{await api('delete',{id:item.id});await load();}catch(error){status.textContent=error.message;}}));
    function start(){if(!date.value)return null;const [y,m,d]=date.value.split('-').map(Number);return new Date(y,m-1,d,Math.floor(Number(time.value)/60),Number(time.value)%60);}
    function refresh(){if(timed && start()){const finish=new Date(+start()+Number(duration.value)*60000);end.textContent=`Planned finish: ${clock(finish)}${calendarKey(finish)!==date.value ? ' the next day' : ''}. This is a guide; you can run longer.`;}}
    date.onchange=time.onchange=duration.onchange=refresh;refresh();title.focus();
    form.onsubmit=async(event)=>{event.preventDefault();preview.disabled=true;status.textContent='';try{
      if(!timed && time.value!=='' && !date.value)throw new Error('Choose a date for this reminder time.');
      const payload={id:item?.id,kind,title:title.value,pillar:pillar.value,notes:notes.value,person:person.value,place:place.value,protected:protect.checked,
        ...(timed ? {starts_at:start().toISOString(),ends_at:new Date(+start()+Number(duration.value)*60000).toISOString()} : {due_date:date.value || null,due_at:date.value && time.value!=='' ? start().toISOString() : null})};
      const proposed=await api('preview',payload);review(proposed,item);
    }catch(error){status.textContent=error.message;preview.disabled=false;}};
  }
  function review(proposed,old){
    ++drawId;heading();const {item,conflicts}=proposed;root.append(node('h3','Does this look right?'),node('h3',item.title),node('p',item.starts_at ? `${new Date(item.starts_at).toLocaleDateString('en-US',{dateStyle:'medium'})} · ${clock(item.starts_at)} – ${clock(item.ends_at)}` : item.due_date || 'No date'));
    if(conflicts.length){root.append(node('p','These times overlap. You can change your plan or keep it in Life without linking.','lifeerror'));for(const conflict of conflicts)root.append(node('p',`${conflict.where}: ${conflict.title} · ${clock(conflict.starts_at)} – ${clock(conflict.ends_at)}`));}
    else root.append(node('p',item.starts_at ? 'No conflicts found in Life or Nex Schedule.' : 'Linking adds this to Nex Reminders.'));
    const status=node('p');status.setAttribute('role','status');const actions=node('div',undefined,'lifeactions');
    async function save(destination,control){control.disabled=true;try{await api('save',{...item,baseline:proposed.baseline,destination});await load();}catch(error){status.textContent=error.message;control.disabled=false;}}
    const only=button(old?.link ? 'Save in Life and remove the Nex link' : 'Keep in Life only',()=>save('life',only));actions.append(only);
    const link=button(old?.link ? 'Save and update Nex' : 'Save and link to Nex',()=>save('linked',link));link.disabled=conflicts.length>0;actions.append(link,button('Change plan',()=>form(item,item.kind==='reminder' && item.starts_at ? 'reservation' : item.kind)),button('Ask Nex for another option',()=>askNex(`Help me resolve conflicts for my Life plan: ${JSON.stringify(item)}. Conflicts: ${JSON.stringify(conflicts)}. Suggest open alternatives without moving existing commitments.`)));root.append(actions,status);
  }
  function checkIn(item){
    ++drawId;heading();root.append(node('h3',item.title),node('p','Tell Nex what happened. Every field is optional; unknown is okay.'));
    const form=document.createElement('form');form.className='lifeform';root.append(form);
    const outcome=select([['unknown','Not recorded'],['happened','It happened'],['missed','It did not happen']],item.outcome || 'unknown');
    const energy=select([['','Skip energy rating'],['1','1 · Very draining'],['2','2 · Draining'],['3','3 · Neutral'],['4','4 · Energizing'],['5','5 · Very energizing']],item.energy ?? '');
    const usePlan=node('input');usePlan.type='checkbox';const actualStart=node('input');actualStart.type='datetime-local';actualStart.value=item.actual_starts_at ? local(new Date(item.actual_starts_at)) : '';
    const actualEnd=node('input');actualEnd.type='datetime-local';actualEnd.value=item.actual_ends_at ? local(new Date(item.actual_ends_at)) : '';
    const reflection=node('textarea');reflection.value=item.reflection || '';reflection.maxLength=4000;reflection.placeholder='Something you enjoyed, learned, or want to remember…';
    const memory=node('input');memory.type='url';memory.value=item.memory_url || '';memory.placeholder='https://…';
    form.append(field('What happened?',outcome),field('How did it feel?',energy),field(`Use the planned times (${clock(item.starts_at)} – ${clock(item.ends_at)})`,usePlan),field('Actual start (optional)',actualStart),field('Actual finish (optional)',actualEnd),field('Reflection (optional)',reflection),field('Link to a photo, video, or memory (optional)',memory));
    const save=node('button','Save my check-in');save.type='submit';const status=node('p');status.setAttribute('role','status');form.append(save,button('Skip / Back',draw),status);
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;try{await api('check_in',{id:item.id,outcome:outcome.value,energy:energy.value==='' ? null : Number(energy.value),use_planned_times:usePlan.checked,...(!usePlan.checked ? {actual_starts_at:actualStart.value ? new Date(actualStart.value).toISOString() : null,actual_ends_at:actualEnd.value ? new Date(actualEnd.value).toISOString() : null} : {}),reflection:reflection.value,memory_url:memory.value});await load();}catch(error){status.textContent=error.message;save.disabled=false;}};
  }
  await load();return root;
}
