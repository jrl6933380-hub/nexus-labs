import { friendlyError, showFeedback } from './ux.js';
import {calendarKey,calendarDayItems,renderScheduleCalendar} from './schedule-calendar.js';
const PILLARS=[['work','Work','#6f9ce8'],['sleep','Sleep','#879ade'],['social','Social','#df7fa4'],['health','Health','#65b8b2'],['personal','Personal','#bd91d9']];
const state={tab:'today',date:new Date(),mode:'month',rhythmDate:new Date(),historyDate:calendarKey(new Date())};
const node=(tag,text,cls='')=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;el.className=cls;return el;};
const button=(text,run)=>{const el=node('button',text);el.type='button';el.onclick=run;return el;};
const field=(label,input)=>{const el=node('label',label);el.append(input);return el;};
const local=(date)=>`${calendarKey(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
const clock=(date)=>new Date(date).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
const PULSE_LABELS=['Very low','Low','Okay','Good','Great'];
const ENERGY=['Very draining','Draining','Neutral','Energizing','Very energizing'];
export function lifeExperience(item){
  if(item.kind!=='activity')return item.status==='done' ? 'Completed' : '';
  const parts=[item.outcome==='happened' ? 'It happened' : item.outcome==='missed' ? 'Did not happen' : 'Not checked in yet'];
  if(item.energy!=null)parts.push(`${item.energy}/5 · ${ENERGY[item.energy-1]}`);
  return parts.join(' · ');
}
function select(values,value){const el=node('select');for(const [key,label] of values){const option=node('option',label);option.value=String(key);el.append(option);}el.value=String(value);return el;}
async function api(action,input={}){const response=await fetch('/api/life',{credentials:'include',...(action ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})} : {})});const data=await response.json();if(!response.ok){const error=new Error(data.error || 'Could not save Life');error.status=response.status;throw error;}return data;}
export function lifeWeekItems(items,day){const from=new Date(day);from.setHours(0,0,0,0);from.setDate(from.getDate()-((from.getDay()+6)%7));const to=new Date(from);to.setDate(to.getDate()+7);return items.filter(item=>item.starts_at && Date.parse(item.starts_at)<+to && Date.parse(item.ends_at)>+from);}
function weekStart(day){const start=new Date(day);start.setHours(0,0,0,0);start.setDate(start.getDate()-((start.getDay()+6)%7));return start;}
export function copyLifeTimes(item,target,source){const start=new Date(item.starts_at),from=weekStart(source),to=weekStart(target);const days=Math.round((new Date(start.getFullYear(),start.getMonth(),start.getDate())-from)/86400000);const next=new Date(to);next.setDate(next.getDate()+days);next.setHours(start.getHours(),start.getMinutes(),0,0);const end=new Date(+next+Date.parse(item.ends_at)-Date.parse(item.starts_at));return {starts_at:next.toISOString(),ends_at:end.toISOString()};}
export async function renderLife(ctx){
  const root=node('section',undefined,'nexuslife');let data={items:[],profile:{focus:[],goals:''}};let drawId=0;
  async function load(message){try{data=await api();await draw();if(typeof message==='string')showFeedback(root,message);}catch(error){root.replaceChildren(node('p',friendlyError(error,{action:'load',subject:'Life'})),button('Try again',load));}}
  function heading(){root.replaceChildren();const head=node('div',undefined,'lifehead');head.append(node('div','NEXUS LIFE','lifeeyebrow'),node('h2','Make room for your life.'),node('p','Plan your time. Notice how it feels. Shape what comes next.'));root.append(head);}
  async function draw(){
    const generation=++drawId;heading();
    const navigation=node('nav',undefined,'lifehomeviews');navigation.setAttribute('aria-label','Life views');
    const home=button('Today',()=>{state.tab='today';return draw();});home.setAttribute('aria-pressed',String(state.tab==='today'));
    const explore=node('details',undefined,'lifeexplore');explore.open=state.tab!=='today';explore.append(node('summary','Explore Life'));
    const tabs=node('div',undefined,'lifetabs');
    for(const [key,label] of [['calendar','Life calendar'],['reminders','Life reminders'],['insights','Your rhythm'],['history','Life history'],['reset','Weekly reset']]){const tab=button(label,()=>{state.tab=key;return draw();});tab.setAttribute('aria-pressed',String(state.tab===key));tabs.append(tab);}explore.append(tabs);navigation.append(home,explore);root.append(navigation);
    const actions=node('div',undefined,'lifeactions lifeprimary');const plan=button('✦ Plan with Nex',()=>ctx.planWithNex ? ctx.planWithNex() : askNex('Help me design my Life week around my priorities. Read Life and Nex Schedule. Ask only the decisions you need, using relevant clickable options. Preview each linked change and get my approval.'));plan.className='uxprimary';actions.append(plan);root.append(actions);const more=node('details',undefined,'lifemore');more.append(node('summary','More options'),button('+ Plan an activity',()=>form()),button('+ Remember something',()=>form(null,'reminder')),button('My priorities',preferences),button('My day changed',dayChanged));root.append(more);
    if(!data.profile.onboarded){const welcome=node('div',undefined,'lifewelcome');welcome.append(node('h3','Start with what matters to you.'),node('p','Choose a few priorities, or jump straight into your day. You can change them anytime.'),button('Choose my priorities',preferences),button('Skip for now',async()=>{await api('profile',{focus:[]});await load();}));root.append(welcome);}
    if(state.tab==='calendar'){
      const calendar=await renderScheduleCalendar({calendarState:state,calendarEndpoint:'/api/life',calendarSubject:'Life plan',detailsLabel:'Check in',balanceLabel:'Your rhythm',weekLabel:'Design next week',
        activitySummary:lifeExperience,activityTitle:item=>`${item.title}${item.outcome==='happened' ? ' · ✓' : item.outcome==='missed' ? ' · Did not happen' : ''}${item.energy!=null ? ` · ${item.energy}/5` : ''}`,activityActions:quickCheckIn,
        planWithNex:()=>ctx.planWithNex ? ctx.planWithNex() : askNex('Help me design a balanced Life week. Read my priorities, Life records, and Nex Schedule. Ask only what you need and preview conflicts before linking anything.'),
        openScheduleStudio:(_mode,day,minutes)=>_mode==='week' ? askNex('Help me design a balanced Life week. Read my priorities, Life records, and Nex Schedule. Show relevant clickable choices and preview conflicts before linking anything.') : form(null,'activity',day,minutes),
        editScheduleItem:item=>form(item,item.kind==='reminder' ? 'reservation' : 'activity'),editScheduleNotes:item=>form(item),openPlannerItem:item=>item.kind==='reminder' ? form(item) : checkIn(item),detailsLabelFor:item=>item.kind==='reminder' ? 'Reminder' : 'Check in',
        openScheduleOverrun:item=>askNex(`Life activity ${item.id}, ${item.title}, is running over. Ask how much time I need. Read Life and Nex Schedule, preserve protected commitments, and preview any changes before I approve them.`),
        openWeekRollover:weeklyReset,ask:askNex,
      },{balance:()=>rhythm(state.date)});if(generation!==drawId)return;root.append(calendar);
    }else if(state.tab==='reminders')reminders();else if(state.tab==='insights')root.append(rhythm());else if(state.tab==='history')history();else if(state.tab==='reset')weeklyReset();else today();
    root.append(node('p','Life stays private to your account. Linking to Nex is always your choice.','lifehint'));
  }
  function askNex(prompt){return ctx.ask(`You are helping inside Nexus Life. Use read_life and manage_life for Life-owned records; ordinary Nex Schedule and Reminders are separate until explicitly linked. Never infer actual experience or energy from planned time. ${prompt}`);}
  function row(item){
    const card=node('article',undefined,'lifeactivity');card.style.setProperty('--pillar',PILLARS.find(([key])=>key===item.pillar)?.[2]);
    card.append(node('small',`${PILLARS.find(([key])=>key===item.pillar)?.[1]} · ${item.link_missing ? 'Nex link is missing' : item.link ? 'Linked to Nex' : 'Life only'}`),node('h3',item.title));
    card.append(node('p',item.starts_at ? `${clock(item.starts_at)} – ${clock(item.ends_at)}` : item.due_date || 'No date'));
    const experience=node('p',lifeExperience(item),'lifeexperience');experience.setAttribute('role','status');card.append(experience);
    if(item.outcome==='happened' && item.actual_starts_at && item.actual_ends_at)card.append(node('p',`Actual time: ${clock(item.actual_starts_at)} – ${clock(item.actual_ends_at)}`));
    if(item.person || item.place)card.append(node('p',[item.person,item.place].filter(Boolean).join(' · ')));
    if(item.reflection)card.append(node('p',item.reflection,'lifereflection'));
    const actions=node('div',undefined,'lifeactions');actions.append(button('Edit plan',()=>form(item)),button(item.kind==='activity' ? 'How was it?' : item.status==='done' ? 'Reopen' : 'Done',()=>item.kind==='activity' ? checkIn(item) : complete(item)));
    if(item.kind==='reminder' && item.status!=='done')actions.append(button(item.starts_at ? 'Change reserved time' : 'Find time in Life',()=>form(item,'reservation')));
    if(item.memory_url){const link=node('a','Open memory');link.href=item.memory_url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}card.append(actions,...quickCheckIn(item));return card;
  }
  function quickCheckIn(item){
    if(item.kind!=='activity')return [];
    const choices=node('div',undefined,'lifeactions lifequickcheck');choices.setAttribute('aria-label',`Check in for ${item.title}`);
    for(const [value,label] of [['happened','It happened'],['missed','Did not happen']]){
      const choice=button(label,()=>saveQuick({outcome:value},choice));choice.setAttribute('aria-pressed',String(item.outcome===value));choices.append(choice);
    }
    const ratings=node('details',undefined,'lifeenergypicker');ratings.append(node('summary',item.energy!=null ? 'Change energy rating' : 'How did it feel?'));
    const options=node('div',undefined,'lifeactions');
    for(const [value,label] of [...ENERGY.map((label,index)=>[index+1,`${index+1} · ${label}`]),[null,'Clear energy rating']]){
      const choice=button(label,()=>saveQuick({energy:value},choice));choice.setAttribute('aria-pressed',String(value===item.energy));options.append(choice);
    }
    ratings.append(options);
    async function saveQuick(values,control){control.disabled=true;try{await api('check_in',{id:item.id,...values});await load(`Check-in saved for ${item.title}.`);}catch(error){control.disabled=false;errorBox(error);}}
    return [choices,ratings];
  }
  function today(){
    const date=calendarKey(new Date()),activities=calendarDayItems(data.items.filter(item=>item.starts_at && item.status!=='done'),new Date()).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
    root.append(dailyPulse());root.append(node('h3',new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}),'lifesectiontitle'));
    if(!activities.length)root.append(node('p','Your day has room. Add one activity or ask Nex to help you plan.','lifeempty'));
    for(const item of activities)root.append(row(item));
    const due=data.items.filter(item=>item.kind==='reminder' && item.status!=='done' && item.due_date && item.due_date<=date && !activities.some(activity=>activity.id===item.id));
    if(due.length){root.append(node('h3','Things to remember','lifesectiontitle'));due.forEach(item=>root.append(row(item)));}
    const ideas=node('details',undefined,'lifeideas');ideas.append(node('summary','Ideas for today'),suggestions());root.append(button('My day changed',dayChanged),ideas);
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
    const daily=(data.pulses || []).filter(pulse=>pulse.date>=calendarKey(from) && pulse.date<calendarKey(to) && pulse.energy!=null);
    host.append(node('p',daily.length ? `Daily energy: ${(daily.reduce((sum,pulse)=>sum+pulse.energy,0)/daily.length).toFixed(1)}/5 across ${daily.length} reported days. Activity ratings are shown separately below.` : 'No daily energy ratings this week. You can add one from Today.'));
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

  function dailyPulse(){
    const date=calendarKey(new Date()),saved=(data.pulses || []).find(pulse=>pulse.date===date);
    const host=node('section',undefined,'lifepulse');host.append(node('h3','How is your energy today?'),node('p',saved?.energy ? `Today: ${saved.energy}/5 · ${PULSE_LABELS[saved.energy-1]}` : 'One tap is enough. You can skip this.'));
    const choices=node('div',undefined,'lifeactions');
    for(const [index,label] of PULSE_LABELS.entries()){
      const choice=button(`${index+1} · ${label}`,async()=>{choice.disabled=true;try{await api('pulse',{date,energy:index+1,note:saved?.note || ''});await load('Your energy check-in is saved.');}catch(error){choice.disabled=false;errorBox(error);}});
      choice.setAttribute('aria-pressed',String(saved?.energy===index+1));choices.append(choice);
    }host.append(choices);
    const details=node('details');details.append(node('summary',saved?.note ? 'Your note' : 'Add a note (optional)'));const note=node('textarea');note.value=saved?.note || '';note.maxLength=2000;
    details.append(field('What is on your mind?',note),button('Save note',async()=>{try{await api('pulse',{date,energy:saved?.energy ?? null,note:note.value});await load('Your note is saved.');}catch(error){errorBox(error);}}));host.append(details);return host;
  }
  function suggestions(){
    const host=node('section',undefined,'lifesuggestions');host.append(node('h3','A little room for you'));
    const today=(data.pulses || []).find(pulse=>pulse.date===calendarKey(new Date()));
    const recent=data.items.filter(item=>item.kind==='activity' && item.outcome==='happened' && item.energy>=4 && Date.parse(item.starts_at)<=Date.now() && Date.parse(item.starts_at)>=Date.now()-28*86400000).sort((a,b)=>Date.parse(b.starts_at)-Date.parse(a.starts_at));
    const seen=new Set();let count=0;
    if(today?.energy!=null && today.energy<=2){host.append(node('p',`You reported ${today.energy}/5 energy today. Would a little breathing room help?`),button('Plan a short pause',()=>form({title:'A short pause',kind:'activity',pillar:'personal',starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+15*60000).toISOString()})));count++;}
    for(const item of recent){if(count>=2)break;const name=item.title.toLowerCase();if(seen.has(name))continue;seen.add(name);count++;
      host.append(node('p',`You rated ${item.title} ${item.energy}/5 on ${new Date(item.starts_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}. Would you like to make room for it again?`),button(`Plan ${item.title} again`,()=>form({title:item.title,kind:'activity',pillar:item.pillar,notes:item.notes,person:item.person,place:item.place,starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+Math.min(16*3600000,Date.parse(item.ends_at)-Date.parse(item.starts_at))).toISOString()})));
    }
    if(!count){const focus=(data.profile.focus || []).map(key=>PILLARS.find(([pillar])=>pillar===key)?.[1]).filter(Boolean);host.append(node('p',focus.length ? `You chose ${focus.join(', ')} as priorities. Nex can help you find one small thing to make room for.` : 'What would make today a little better? Choose what matters to you, and Nex can offer ideas.'));}
    host.append(button('Find an idea with Nex',()=>askNex('Read my priorities, daily pulses, and confirmed recent experiences. Offer at most two relevant enriching options with clickable choices and explain the records behind them. If there is little evidence, ask what I enjoy. Do not fill every gap. Preview a chosen activity before saving.')));return host;
  }
  function dayChanged(){
    ++drawId;heading();root.append(node('h3','What changed today?'),node('p','Choose the closest option. Nex will suggest a plan for you to review before anything moves.'));
    const choices=node('div',undefined,'lifeactions');
    for(const [label,prompt] of [['I am tired','I have less energy today. Help me lighten the rest of my day.'],['I am running late','I am running late. Ask how late, then help me adjust the rest of today.'],['Something is running over','An activity is taking longer. Ask which activity and how much longer.'],['I need more room','I need some breathing room today. Help me choose what can wait.']])choices.append(button(label,()=>askNex(`${prompt} Read my daily pulse, Life activities, and Nex Schedule for today. Offer two short clickable alternatives. Protect fixed commitments and reminders; preview changes and wait for my choice before applying them. Do not infer that past activities happened.`)));
    root.append(choices,button('Something else',()=>askNex('My day changed. Ask me one short question about what changed, then read Life and Nex Schedule and suggest options before previewing changes for my approval.')),button('Back',draw));
  }
  function history(){
    root.append(node('h3','Your Life history'),node('p','Plans, experiences, reflections, and memories stay here.'));
    const date=node('input');date.type='date';date.value=state.historyDate;date.onchange=()=>{if(date.value){state.historyDate=date.value;return draw();}};
    root.append(field('Choose a day',date));const navigation=node('div',undefined,'lifeactions');
    for(const [label,offset] of [['Previous day',-1],['Next day',1]])navigation.append(button(label,()=>{const next=new Date(`${state.historyDate}T12:00:00`);next.setDate(next.getDate()+offset);state.historyDate=calendarKey(next);return draw();}));root.append(navigation);
    const pulse=(data.pulses || []).find(item=>item.date===state.historyDate);if(pulse)root.append(node('p',`Daily energy: ${pulse.energy==null ? 'Not rated' : `${pulse.energy}/5 · ${PULSE_LABELS[pulse.energy-1]}`}${pulse.note ? ` · ${pulse.note}` : ''}`,'lifeexperience'));
    const day=new Date(`${state.historyDate}T12:00:00`),items=calendarDayItems(data.items.filter(item=>item.starts_at),day);const ids=new Set(items.map(item=>item.id));
    for(const item of data.items.filter(item=>item.kind==='reminder' && item.due_date===state.historyDate && !ids.has(item.id)))items.push(item);
    items.sort((a,b)=>Date.parse(a.starts_at || `${a.due_date}T12:00:00`)-Date.parse(b.starts_at || `${b.due_date}T12:00:00`));
    if(!items.length)root.append(node('p','No activities or reminders recorded for this day.','lifeempty'));items.forEach(item=>root.append(row(item)));
    const memories=node('details',undefined,'lifememories');memories.append(node('summary','Browse reflections and memories'));
    const remembered=data.items.filter(item=>item.reflection || item.memory_url).sort((a,b)=>Date.parse(b.starts_at || b.due_date || 0)-Date.parse(a.starts_at || a.due_date || 0));
    if(!remembered.length)memories.append(node('p','Add a reflection or memory through an activity check-in.'));
    for(const item of remembered){const entry=node('div');entry.append(node('p',`${item.title} · ${new Date(item.starts_at || item.due_date || item.created_at).toLocaleDateString('en-US',{dateStyle:'medium'})}`),button('View this day',()=>{state.historyDate=item.starts_at ? calendarKey(new Date(item.starts_at)) : item.due_date || calendarKey(new Date(item.created_at));return draw();}));if(item.reflection)entry.append(node('p',item.reflection,'lifereflection'));if(item.memory_url){const link=node('a','Open memory');link.href=item.memory_url;link.target='_blank';link.rel='noopener noreferrer';entry.append(link);}memories.append(entry);}root.append(memories);
  }
  function weeklyReset(sourceDay=state.rhythmDate,draft=null){
    ++drawId;heading();root.append(node('h3','Keep what works. Make room for next week.'),node('p','Choose routines to carry forward, change their times, then review. Nothing is copied until you confirm. New copies stay in Life; you can link them to Nex afterward.'));
    const from=weekStart(sourceDay),target=new Date(from);target.setDate(target.getDate()+7);
    const sourceDate=node('input');sourceDate.type='date';sourceDate.value=calendarKey(from);sourceDate.onchange=()=>{if(sourceDate.value){state.rhythmDate=new Date(`${sourceDate.value}T12:00:00`);weeklyReset(state.rhythmDate);}};root.append(field('Review the week beginning',sourceDate));
    const items=data.items.filter(item=>item.kind==='activity' && Date.parse(item.starts_at)>=+from && Date.parse(item.starts_at)<+new Date(from.getFullYear(),from.getMonth(),from.getDate()+7)).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
    const reported=items.filter(item=>item.outcome==='happened').length,unknown=items.filter(item=>item.outcome==='unknown').length;
    const daily=(data.pulses || []).filter(pulse=>pulse.date>=calendarKey(from) && pulse.date<calendarKey(target) && pulse.energy!=null);
    if(daily.length)root.append(node('p',`You reported daily energy on ${daily.length} days, averaging ${(daily.reduce((sum,pulse)=>sum+pulse.energy,0)/daily.length).toFixed(1)}/5. Missing days are simply unknown.`));
    root.append(node('p',`${items.length} activities planned · ${reported} confirmed as happened · ${unknown} not checked in. Choose what you want to keep.`));
    const controls=[],list=node('div',undefined,'liferesetlist');root.append(list);
    for(const item of items){
      const saved=draft?.find(entry=>entry.source_id===item.id),times=copyLifeTimes(item,target,from),entry=node('details',undefined,'liferesetitem');
      const summary=node('summary',`${item.title} · ${lifeExperience(item)}`);entry.append(summary);
      const keep=node('input');keep.type='checkbox';keep.checked=draft ? Boolean(saved) : false;
      const date=node('input');date.type='date';date.value=saved ? calendarKey(new Date(saved.starts_at)) : calendarKey(new Date(times.starts_at));
      const time=select(Array.from({length:96},(_,i)=>[i*15,clock(new Date(2000,0,1,Math.floor(i/4),(i%4)*15))]),new Date(saved?.starts_at || times.starts_at).getHours()*60+new Date(saved?.starts_at || times.starts_at).getMinutes());
      const selectedMinute=new Date(saved?.starts_at || times.starts_at).getHours()*60+new Date(saved?.starts_at || times.starts_at).getMinutes();if(selectedMinute%15){const option=node('option',clock(new Date(saved?.starts_at || times.starts_at)));option.value=String(selectedMinute);time.append(option);time.value=String(selectedMinute);}
      const oldDuration=Math.round((Date.parse(saved?.ends_at || item.ends_at)-Date.parse(saved?.starts_at || item.starts_at))/60000),duration=select([...new Set([15,30,45,60,90,120,180,240,360,480,600,720,960,oldDuration])].sort((a,b)=>a-b).map(value=>[value,value<60 ? `${value} minutes` : `${value/60} hours`]),oldDuration);
      const title=node('input');title.value=saved?.title || item.title;title.maxLength=160;
      entry.append(field('Carry this activity forward',keep),field('Name',title),field('New day',date),field('Start time',time),field('Duration',duration));
      const finish=node('p',undefined,'lifeend');entry.append(finish);if(item.reflection)entry.append(node('p',item.reflection,'lifereflection'));
      function value(){if(!date.value)throw new Error('Choose a day for each selected activity');const start=new Date(`${date.value}T00:00:00`);start.setMinutes(Number(time.value));return {source_id:item.id,copy_date:date.value,title:title.value,starts_at:start.toISOString(),ends_at:new Date(+start+Number(duration.value)*60000).toISOString()};}
      function refresh(){try{const current=value();finish.textContent=`${date.value} · ${clock(current.starts_at)} – ${clock(current.ends_at)}${calendarKey(new Date(current.ends_at))!==date.value ? ' the next day' : ''}`;summary.textContent=`${keep.checked ? '✓ ' : ''}${item.title} · ${date.value} · ${clock(current.starts_at)} – ${clock(current.ends_at)} · ${lifeExperience(item)}`;}catch{finish.textContent='Choose a day';}}date.onchange=time.onchange=duration.onchange=keep.onchange=refresh;refresh();
      controls.push({keep,value,refresh});list.append(entry);
    }
    if(!items.length)root.append(node('p','No activities in this week yet. Plan an activity, choose an earlier week, or ask Nex to help.','lifeempty'));
    const actions=node('div',undefined,'lifeactions');actions.append(button('Select all',()=>{controls.forEach(control=>{control.keep.checked=true;control.refresh();});}),button('Clear selection',()=>{controls.forEach(control=>{control.keep.checked=false;control.refresh();});}));
    const review=button('Review next week',async()=>{review.disabled=true;try{const entries=controls.filter(control=>control.keep.checked).map(control=>control.value());const proposed=await api('preview_week',{entries});reviewWeek(proposed,sourceDay);}catch(error){review.disabled=false;errorBox(error);}});review.disabled=!items.length;actions.append(review,button('Reset with Nex',()=>askNex(`Review the Life week beginning ${calendarKey(from)}, daily pulses, and my priorities. Help me choose what to keep or change for next week. Offer short clickable choices. Use preview_week before save_week, protect commitments, and wait for my approval.`)),button('Back',()=>{state.tab='today';return draw();}));root.append(actions);
  }
  function reviewWeek(proposed,sourceDay){
    ++drawId;heading();root.append(node('h3','Review your next week'));
    for(const item of proposed.items)root.append(node('p',`${item.title} · ${new Date(item.starts_at).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${clock(item.starts_at)} – ${clock(item.ends_at)}`));
    if(proposed.already.length)root.append(node('p',`${proposed.already.length} activities already copied to those days. They will not be added again.`));
    if(proposed.conflicts.length){root.append(node('p','Some times overlap. Change their times or uncheck those activities.','lifeerror'));for(const conflict of proposed.conflicts)root.append(node('p',`${conflict.title} overlaps ${conflict.with} in ${conflict.where}.`));}else root.append(node('p','No conflicts found in Life or Nex Schedule.'));
    const save=button('Confirm and save in Life',async()=>{save.disabled=true;try{await api('save_week',{entries:proposed.entries,baseline:proposed.baseline});state.tab='calendar';state.mode='list';state.date=new Date(proposed.items[0].starts_at);await load();}catch(error){save.disabled=false;errorBox(error);}});save.disabled=Boolean(proposed.conflicts.length || !proposed.items.length);
    root.append(save,button('Change or skip activities',()=>weeklyReset(sourceDay,proposed.entries)),button('Ask Nex for alternatives',()=>askNex(`Help me resolve this weekly reset without moving protected commitments. Preview: ${JSON.stringify(proposed)}. Suggest changes for me to review.`)));
  }

  function errorBox(error){const status=node('p',friendlyError(error,{subject:'Life',keepDraft:true}),'lifeerror');status.setAttribute('role','status');root.append(status);}
  function preferences(){
    ++drawId;heading();root.append(node('h3','What would you like more room for?'),node('p','Choose any that matter. You can skip this.'));
    const chosen=new Set(data.profile.focus || []),choices=node('div',undefined,'lifeactions');for(const [key,label] of PILLARS){const choice=button(label,()=>{chosen.has(key) ? chosen.delete(key) : chosen.add(key);choice.setAttribute('aria-pressed',String(chosen.has(key)));});choice.setAttribute('aria-pressed',String(chosen.has(key)));choices.append(choice);}root.append(choices);
    const goals=node('textarea');goals.value=data.profile.goals || '';goals.placeholder='Something you want more of, or a rhythm you want to change…';goals.maxLength=2000;root.append(field('Anything else? (optional)',goals));
    const save=button('Save my priorities',async()=>{save.disabled=true;try{await api('profile',{focus:[...chosen],goals:goals.value});await load('Your priorities are saved.');}catch(error){save.disabled=false;errorBox(error);}});root.append(save,button('Back',draw));
  }
  function form(item=null,kind='activity',day,minutes){
    ++drawId;heading();const reservation=kind==='reservation';kind=item?.kind || kind;const timed=kind==='activity' || reservation;const form=document.createElement('form');form.className='lifeform';root.append(node('h3',item?.id ? 'Edit your plan' : timed ? 'Plan an activity' : 'Remember something'),form);
    const title=node('input');title.value=item?.title || '';title.required=true;title.maxLength=160;title.placeholder=timed ? 'A walk, work, dinner with someone…' : 'Call someone, pick something up…';
    const pillar=select(PILLARS.map(([key,label])=>[key,label]),item?.pillar || 'personal');
    const date=node('input');date.type='date';date.value=timed && item?.starts_at ? calendarKey(new Date(item.starts_at)) : item?.due_date || day || calendarKey(new Date());date.required=timed;
    const minuteOptions=Array.from({length:96},(_,i)=>{const minute=i*15,hour=Math.floor(minute/60);return [minute,`${hour%12 || 12}:${String(minute%60).padStart(2,'0')} ${hour<12 ? 'AM' : 'PM'}`];});
    const startDate=item?.starts_at ? new Date(item.starts_at) : item?.due_at ? new Date(item.due_at) : null;
    const selected=startDate ? startDate.getHours()*60+startDate.getMinutes() : minutes ?? 540;if(selected%15)minuteOptions.push([selected,clock(startDate)]);
    const time=select(!timed ? [['','No time'],...minuteOptions] : minuteOptions,!timed && !item?.due_at ? '' : selected);
    const oldDuration=item?.ends_at ? Math.round((Date.parse(item.ends_at)-Date.parse(item.starts_at))/60000) : 60;
    const duration=select([...new Set([...Array.from({length:64},(_,i)=>(i+1)*15),oldDuration])].sort((a,b)=>a-b).map(value=>[value,value<60 ? `${value} minutes` : `${value/60} hours`]),oldDuration);
    if(!item?.id && timed){const suggestions=node('div',undefined,'lifeactions');
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
    if(item?.id)form.append(button('Delete',async()=>{if(!confirm(`Delete ${item.title}${item.link ? ' and its linked Nex item' : ''}?`))return;try{await api('delete',{id:item.id});await load(`Removed from Life: ${item.title}.`);}catch(error){status.textContent=friendlyError(error,{subject:'Life',keepDraft:true});}}));
    function start(){if(!date.value)return null;const [y,m,d]=date.value.split('-').map(Number);return new Date(y,m-1,d,Math.floor(Number(time.value)/60),Number(time.value)%60);}
    function refresh(){if(timed && start()){const finish=new Date(+start()+Number(duration.value)*60000);end.textContent=`Planned finish: ${clock(finish)}${calendarKey(finish)!==date.value ? ' the next day' : ''}. This is a guide; you can run longer.`;}}
    date.onchange=time.onchange=duration.onchange=refresh;refresh();title.focus();
    form.onsubmit=async(event)=>{event.preventDefault();preview.disabled=true;status.textContent='';try{
      if(!timed && time.value!=='' && !date.value)throw new Error('Choose a date for this reminder time.');
      const payload={id:item?.id,kind,title:title.value,pillar:pillar.value,notes:notes.value,person:person.value,place:place.value,protected:protect.checked,
        ...(timed ? {starts_at:start().toISOString(),ends_at:new Date(+start()+Number(duration.value)*60000).toISOString()} : {due_date:date.value || null,due_at:date.value && time.value!=='' ? start().toISOString() : null})};
      const proposed=await api('preview',payload);review(proposed,item);
    }catch(error){status.textContent=friendlyError(error,{subject:'Life',keepDraft:true});preview.disabled=false;}};
  }
  function review(proposed,old){
    ++drawId;heading();const {item,conflicts}=proposed;root.append(node('h3','Does this look right?'),node('h3',item.title),node('p',item.starts_at ? `${new Date(item.starts_at).toLocaleDateString('en-US',{dateStyle:'medium'})} · ${clock(item.starts_at)} – ${clock(item.ends_at)}` : item.due_date || 'No date'));
    if(conflicts.length){root.append(node('p','These times overlap. You can change your plan or keep it in Life without linking.','lifeerror'));for(const conflict of conflicts)root.append(node('p',`${conflict.where}: ${conflict.title} · ${clock(conflict.starts_at)} – ${clock(conflict.ends_at)}`));}
    else root.append(node('p',item.starts_at ? 'No conflicts found in Life or Nex Schedule.' : 'Linking adds this to Nex Reminders.'));
    const status=node('p');status.setAttribute('role','status');const actions=node('div',undefined,'lifeactions');
    async function save(destination,control){control.disabled=true;try{await api('save',{...item,baseline:proposed.baseline,destination});await load(`Saved in Life: ${item.title}.`);}catch(error){status.textContent=friendlyError(error,{subject:'Life',keepDraft:true});control.disabled=false;}}
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
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;try{await api('check_in',{id:item.id,outcome:outcome.value,energy:energy.value==='' ? null : Number(energy.value),use_planned_times:usePlan.checked,...(!usePlan.checked ? {actual_starts_at:actualStart.value ? new Date(actualStart.value).toISOString() : null,actual_ends_at:actualEnd.value ? new Date(actualEnd.value).toISOString() : null} : {}),reflection:reflection.value,memory_url:memory.value});await load(`Check-in saved for ${item.title}.`);}catch(error){status.textContent=friendlyError(error,{subject:'Life',keepDraft:true});save.disabled=false;}};
  }
  await load();return root;
}
