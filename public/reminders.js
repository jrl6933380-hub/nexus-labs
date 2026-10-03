import { calendarKey } from './schedule-calendar.js';
import { occupiedStart } from './schedule-availability.js';
const state={filter:'today'};
const node=(tag,text,cls='')=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;el.className=cls;return el;};
const button=(text,run)=>{const el=node('button',text);el.type='button';el.onclick=run;return el;};
export function reminderMatches(item,filter,today){
  if(filter==='completed')return item.status==='done';
  if(item.status==='done')return false;
  if(filter==='today')return Boolean(item.due_date && item.due_date<=today);
  if(filter==='upcoming')return Boolean(item.due_date && item.due_date>today);
  return true;
}
async function api(action,input={}){
  const response=await fetch('/api/reminders',{credentials:'include',...(action ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})} : {})});
  const data=await response.json();if(!response.ok)throw new Error(data.error || 'Could not save reminders');return data;
}
export async function renderReminders(ctx){
  const root=node('section',undefined,'nexreminders');let items=[];
  async function load(){try{items=(await api()).items || [];draw();}catch(error){root.replaceChildren(node('p',error.message),button('Try again',load));}}
  function header(){root.replaceChildren();const bar=node('div',undefined,'reminderhead');bar.append(node('h2','Reminders'),button('+ Add',()=>form()));root.append(bar);}
  function draw(){
    header();const today=calendarKey(new Date()),tabs=node('div',undefined,'reminderfilters');
    for(const [filter,label] of [['today','Today'],['upcoming','Upcoming'],['all','All'],['completed','Completed']]){
      const count=items.filter(item=>reminderMatches(item,filter,today)).length;
      const tab=button(`${label} · ${count}`,()=>{state.filter=filter;draw();});tab.setAttribute('aria-pressed',String(state.filter===filter));tabs.append(tab);
    }
    root.append(tabs);
    const quick=document.createElement('form');quick.className='reminderquick';const title=node('input');title.placeholder='Something to remember…';title.required=true;title.maxLength=160;title.setAttribute('aria-label','New reminder title');
    const add=node('button','Add');add.type='submit';const status=node('p',undefined,'reminderstatus');status.setAttribute('role','status');quick.append(title,add);
    quick.onsubmit=async(event)=>{event.preventDefault();add.disabled=true;try{await api('create',{title:title.value});state.filter='all';await load();}catch(error){status.textContent=error.message;add.disabled=false;}};
    root.append(quick,button('✦ Organize with Nex',()=>ctx.ask('Read my reminders and schedule. Help me choose what matters today with relevant clickable choices. Offer to find time for a reminder; get my approval before changing anything.')),status);
    const visible=items.filter(item=>reminderMatches(item,state.filter,today));
    if(!visible.length)root.append(node('p',state.filter==='today' ? 'Nothing due today. Capture a reminder or ask Nex to help.' : 'Nothing here yet. Add something you want to remember.','reminderempty'));
    for(const item of visible){
      const row=node('div',undefined,'reminderrow');
      const done=button(item.status==='done' ? '✓' : '○',async()=>{done.disabled=true;try{await api('update',{id:item.id,status:item.status==='done' ? 'planned' : 'done'});await load();}catch(error){status.textContent=error.message;done.disabled=false;}});done.setAttribute('aria-label',`${item.status==='done' ? 'Reopen' : 'Complete'} ${item.title}`);
      const content=node('div',undefined,'remindercontent');content.append(button(item.title,()=>form(item)));
      if(item.notes)content.append(node('p',item.notes));
      const when=item.due_at ? new Date(item.due_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}) : item.due_date || 'No date';
      content.append(node('small',`${item.due_date && item.due_date<today && item.status!=='done' ? 'Overdue · ' : ''}${when}${item.scheduled_at ? ` · Time reserved ${new Date(item.scheduled_at).toLocaleString('en-US',{dateStyle:'short',timeStyle:'short'})}` : ''}`));
      const actions=node('div',undefined,'reminderactions');actions.append(button('Notes',()=>form(item,true)),button('Edit',()=>form(item)));
      if(item.status!=='done')actions.append(button(item.scheduled_at ? 'Change reserved time' : 'Find time for this',()=>schedule(item)));
      content.append(actions);row.append(done,content);root.append(row);
    }
    root.append(node('p','Timed reminders appear while Nexus is open.','reminderhint'));
  }
  function form(item=null,notesOnly=false){
    header();const form=document.createElement('form');form.className='reminderform';
    const title=node('input');title.value=item?.title || '';title.placeholder='What do you want to remember?';title.required=true;title.maxLength=160;title.setAttribute('aria-label','Reminder title');
    const notes=node('textarea');notes.value=item?.notes || '';notes.placeholder='Add notes…';notes.maxLength=4000;notes.setAttribute('aria-label','Reminder notes');
    const date=node('input');date.type='date';date.value=item?.due_date || '';date.setAttribute('aria-label','Reminder date');
    const time=node('select');time.setAttribute('aria-label','Reminder time');let option=node('option','No time');option.value='';time.append(option);
    for(let minute=0;minute<1440;minute+=15){option=node('option',clock(minute));option.value=String(minute);time.append(option);}
    if(item?.due_at){const local=new Date(item.due_at),minute=local.getHours()*60+local.getMinutes();if(minute%15){const custom=node('option',clock(minute));custom.value=String(minute);time.append(custom);}time.value=String(minute);}
    const quickDates=node('div',undefined,'reminderactions');
    for(const [label,offset] of [['Today',0],['Tomorrow',1],['Next week',7]])quickDates.append(button(label,()=>{const day=new Date();day.setDate(day.getDate()+offset);date.value=calendarKey(day);}));
    quickDates.append(button('No date',()=>{date.value='';time.value='';}));
    const dateLabel=node('label','Date (optional)');dateLabel.append(date);const timeLabel=node('label','Time (optional)');timeLabel.append(time);
    const save=node('button',notesOnly ? 'Save notes' : item ? 'Save changes' : 'Add reminder');save.type='submit';const status=node('p');status.setAttribute('role','status');
    if(!notesOnly)form.append(title);else form.append(node('h3',item.title));form.append(notes);
    if(!notesOnly)form.append(quickDates,dateLabel,timeLabel);
    form.append(save,button('Back',draw));
    if(item)form.append(button('Delete reminder',async()=>{
      if(!confirm(`Delete “${item.title}”${item.schedule_id ? ' and its reserved Schedule block' : ''}?`))return;
      try{await api('delete',{id:item.id});await load();}catch(error){status.textContent=error.message;}
    }));
    form.append(status);root.append(form);
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;
      try{if(time.value && !date.value && !notesOnly)throw new Error('Choose a date for this time.');
        await api(item ? 'update' : 'create',notesOnly ? {id:item.id,notes:notes.value} : {id:item?.id,title:title.value,notes:notes.value,due_date:date.value || null,due_at:date.value && time.value!=='' ? at(date.value,Number(time.value)).toISOString() : null});
        if(!item)state.filter='all';await load();
      }catch(error){status.textContent=error.message;save.disabled=false;}
    };(notesOnly ? notes : title).focus();
  }
  async function schedule(item){
    header();root.append(node('h3',`Find time for ${item.title}`));
    const form=document.createElement('form');form.className='reminderform';root.append(form);
    const date=node('input');date.type='date';date.value=item.due_date && item.due_date>=calendarKey(new Date()) ? item.due_date : calendarKey(new Date());date.required=true;date.setAttribute('aria-label','Schedule day');
    const time=node('select');time.setAttribute('aria-label','Start time');for(let minute=0;minute<1440;minute+=15){const option=node('option',clock(minute));option.value=String(minute);time.append(option);}time.value='540';time.disabled=true;
    const duration=node('select');duration.setAttribute('aria-label','Duration');for(const minutes of [15,30,45,60,90,120,180,240,480]){const option=node('option',minutes<60 ? `${minutes} minutes` : `${minutes/60} hours`);option.value=String(minutes);duration.append(option);}duration.value='30';
    for(const [text,input] of [['Day',date],['Start time',time],['Time to reserve',duration]]){const label=node('label',text);label.append(input);form.append(label);}
    const guide=node('p'),status=node('p');status.setAttribute('role','status');const save=node('button','Reserve this time');save.type='submit';save.disabled=true;
    form.append(guide,save,button('Find time with Nex',()=>ctx.ask(`Read my reminders and schedule. Find time for reminder ${item.id}, ${item.title}. Suggest open times and ask me before using manage_reminder to schedule it. Keep the reminder linked to its Schedule block.`)),button('Back',draw),status);
    let blocks=[],loaded=false;
    function refresh(){
      if(!loaded || !date.value){save.disabled=true;return;}
      for(const option of time.options){const busy=occupiedStart({days:[date.value],startMinutes:Number(option.value),durationMinutes:Number(duration.value),items:blocks,excludeId:item.schedule_id}).length>0;option.disabled=busy;option.textContent=clock(Number(option.value))+(busy ? ' · taken' : '');}
      save.disabled=time.selectedOptions[0]?.disabled;
      const start=at(date.value,Number(time.value));guide.textContent=`Planned end: ${new Date(+start+Number(duration.value)*60000).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}`;
    }
    date.onchange=time.onchange=duration.onchange=refresh;
    try{const response=await fetch('/api/planner',{credentials:'include'});const data=await response.json();if(!response.ok)throw new Error(data.error || 'Could not read Schedule');blocks=data.items || [];loaded=true;time.disabled=false;refresh();}catch(error){status.textContent=error.message;}
    form.onsubmit=async(event)=>{event.preventDefault();save.disabled=true;try{const start=at(date.value,Number(time.value));await api('schedule',{id:item.id,starts_at:start.toISOString(),ends_at:new Date(+start+Number(duration.value)*60000).toISOString(),apply:true});await load();}catch(error){status.textContent=error.message;refresh();}};
  }
  await load();return root;
}
function clock(minute){const hour=Math.floor(minute/60);return `${hour%12 || 12}:${String(minute%60).padStart(2,'0')} ${hour<12 ? 'AM' : 'PM'}`;}
function at(day,minute){const [year,month,date]=day.split('-').map(Number);return new Date(year,month-1,date,Math.floor(minute/60),minute%60);}

export function dueReminderAlerts(items,now,delivered){
  return items.filter(item=>item.status!=='done' && item.due_at && Date.parse(item.due_at)<=now && now-Date.parse(item.due_at)<3600000 && !delivered.has(`${item.id}:${item.due_at}`));
}
// In-app delivery only. No request for browser notification permissions.
export function startReminderAlerts(openReminders,{endpoint='/api/reminders',filter=()=>true}={}){
  const delivered=new Set();let polling=false;
  async function check(){
    if(polling || document.visibilityState==='hidden' || document.querySelector('.scheduletoast'))return;
    polling=true;
    try{
      const response=await fetch(endpoint,{credentials:'include'});if(!response.ok)return;const items=((await response.json()).items || []).filter(filter),item=dueReminderAlerts(items,Date.now(),delivered)[0];if(!item)return;
      delivered.add(`${item.id}:${item.due_at}`);
      const toast=node('div',undefined,'scheduletoast');toast.setAttribute('role','status');
      toast.append(node('strong',item.title),node('span',item.notes || 'Your reminder is due.'));
      toast.append(button('×',()=>toast.remove()),button('Open reminders',()=>{toast.remove();openReminders();}));toast.lastChild.className='scheduleextend';document.body.append(toast);
    }catch{/* Retry on the next interval; the main view surfaces load failures. */}finally{polling=false;}
  }
  check();const timer=setInterval(check,30000);return ()=>clearInterval(timer);
}
