// A calendar-first surface over the shared Schedule store.
import { occupiedStart } from './schedule-availability.js';
const COLORS = {work:'#6f9ce8',project:'#9a7bea',gym:'#56c596',health:'#65b8b2',family:'#e9a66f',social:'#df7fa4',appointment:'#e0c35c',errands:'#a5a19a',learning:'#74b7e8',creative:'#c883d8',rest:'#7b87a7',travel:'#d78b68',other:'#8e8a84'};
const state = {date:new Date(),mode:'month'};
export function calendarKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function dayStart(date) { const copy = new Date(date); copy.setHours(0,0,0,0); return copy; }
function shift(date,days) { const copy = dayStart(date); copy.setDate(copy.getDate()+days); return copy; }
function endOf(item) { return item.ends_at ? new Date(item.ends_at) : new Date(Date.parse(item.starts_at)+(item.all_day ? 86400000 : 3600000)); }
export function calendarDayItems(items,date) {
  const from = dayStart(date), to = shift(date,1);
  return items.filter((item) => item.status !== 'cancelled' && new Date(item.starts_at) < to && endOf(item) > from);
}
// Assign columns to overlapping events so each remains readable and clickable.
export function calendarLayout(items,date) {
  const from = dayStart(date), to = shift(date,1);
  const entries = calendarDayItems(items,date).filter((item) => !item.all_day).map((item) => {
    const start = new Date(Math.max(from.getTime(),Date.parse(item.starts_at)));
    const end = new Date(Math.min(to.getTime(),endOf(item).getTime()));
    return {item,start:start.getHours()*60+start.getMinutes(),end:end.getTime() === to.getTime() ? 1440 : end.getHours()*60+end.getMinutes(),column:0,columns:1};
  }).sort((a,b) => a.start-b.start || b.end-a.end);
  let group=[], groupEnd=-1;
  function finish() {
    const ends=[];
    for (const entry of group) { let column=ends.findIndex((end) => end <= entry.start); if (column < 0) column=ends.length; ends[column]=entry.end; entry.column=column; }
    group.forEach((entry) => {entry.columns=ends.length;}); group=[];
  }
  for (const entry of entries) { if (entry.start >= groupEnd) {finish();groupEnd=-1;} group.push(entry);groupEnd=Math.max(groupEnd,entry.end); }
  finish(); return entries;
}
function node(tag,className,text) { const element=document.createElement(tag);element.className=className;if(text !== undefined) element.textContent=text;return element; }
function button(text,action,label=text) { const element=node('button','',text);element.type='button';element.setAttribute('aria-label',label);element.onclick=action;return element; }
const clock = (date) => date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
export async function renderScheduleCalendar(ctx, extras) {
  const root=node('section','nexcalendar');
  let payload={items:[]}, requestId=0, search='', closeActivityActions=null;
  async function load() {
    const id=++requestId;
    root.setAttribute('aria-busy','true');
    const start=state.mode === 'month' ? new Date(state.date.getFullYear(),state.date.getMonth(),1) : dayStart(state.date);
    const from=shift(start,state.mode === 'month' ? -start.getDay() : 0);
    const to=state.mode === 'month' ? shift(from,42) : shift(from,state.mode === 'multi' ? 3 : state.mode === 'list' ? 30 : 1);
    try {
      // Include blocks starting before the range, such as overnight events.
      const response=await fetch(`/api/planner?from=${encodeURIComponent(shift(from,-14).toISOString())}&to=${encodeURIComponent(to.toISOString())}`,{credentials:'include'});
      const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Could not load your calendar');
      if(id !== requestId) return;
      const items=(data.items || []).filter((item)=>new Date(item.starts_at)<to && endOf(item)>from && item.status !== 'cancelled');
      const category_minutes={}, conflicts=[];
      const active=items.filter((item)=>item.status==='planned' || item.status==='draft');
      for(const item of active) {const minutes=Math.max(0,(Math.min(endOf(item),to)-Math.max(new Date(item.starts_at),from))/60000);category_minutes[item.category || 'other']=(category_minutes[item.category || 'other'] || 0)+minutes;}
      for(let a=0;a<active.length;a++)for(let b=a+1;b<active.length;b++)if(new Date(active[a].starts_at)<endOf(active[b]) && endOf(active[a])>new Date(active[b].starts_at))conflicts.push([active[a].id,active[b].id]);
      payload={...data,items,summary:{category_minutes,conflicts}}; ctx.setScheduleItems?.(data.items || []);draw();
    } catch(error) {
      if(id !== requestId) return;
      root.replaceChildren(node('p','calerror',error.message),button('Try again',load));
    } finally {if(id === requestId) root.removeAttribute('aria-busy');}
  }
  function draw() {
    closeActivityActions=null;root.replaceChildren();
    const items=(payload.items || []).filter((item) => item.status !== 'cancelled' && (!search || item.title.toLowerCase().includes(search.toLowerCase())));
    const toolbar=node('div','caltoolbar');
    const heading=node('h2','',state.date.toLocaleDateString('en-US',{month:'long',year:'numeric'}));
    toolbar.append(button('‹',()=>navigate(-1),'Previous period'),heading,button('›',()=>navigate(1),'Next period'));
    const add=button('+',()=>ctx.openScheduleStudio('block',calendarKey(state.date)),'Add activity'); add.className='caladd';toolbar.append(add);root.append(toolbar);
    const controls=node('div','calcontrols');
    const modes=node('div','calmodes');modes.setAttribute('aria-label','Calendar views');
    for(const [mode,label] of [['month','Month'],['day','Day'],['multi','Multi-day'],['list','List']]) {
      const control=button(label,()=>{state.mode=mode;return load();});control.classList.toggle('active',state.mode===mode);control.setAttribute('aria-pressed',String(state.mode===mode));modes.append(control);
    }
    controls.append(modes,button('Today',()=>{state.date=new Date();return load();}));root.append(controls);
    const tools=node('div','caltools');
    tools.append(button('✦ Plan with Nex',()=>ctx.openScheduleStudio('week')),button('Time balance',()=>{
      const previous=root.querySelector('.calinsight');if(previous){previous.remove();return;}
      const host=node('div','calinsight');host.append(extras.balance(payload.summary,payload.items || [],ctx));root.append(host);host.scrollIntoView({block:'nearest'});
    }));
    const more=node('details','calmore');more.append(node('summary','','More'));
    more.append(button('Build next week',()=>ctx.openWeekRollover()),button('Ask Nex to adjust',()=>ctx.ask(`Read my schedule for ${calendarKey(state.date)}. Show me the tradeoffs and clickable ways to adjust it without moving protected commitments.`)));
    const find=node('input','calsearch');find.type='search';find.placeholder='Find an activity';find.setAttribute('aria-label','Search schedule');find.value=search;
    find.onchange=()=>{search=find.value;state.mode='list';return load();};more.append(find);tools.append(more);root.append(tools);
    for(const draftId of payload.drafts || []) {
      const draftItems=(payload.draft_items || payload.items || []).filter((item)=>item.draft_id===draftId);
      const draft=button(`Review draft · ${draftItems.length} blocks`,()=>ctx.reviewWeekDraft(draftId,draftItems));draft.className='caldraft';root.append(draft);
    }
    if(state.mode === 'month') month(items);
    else if(state.mode === 'list') agenda(items);
    else timeline(items);
  }
  function navigate(direction) {
    if(state.mode === 'month') state.date=new Date(state.date.getFullYear(),state.date.getMonth()+direction,Math.min(state.date.getDate(),28));
    else state.date=shift(state.date,direction*(state.mode === 'multi' ? 3 : state.mode === 'list' ? 7 : 1));
    load();
  }
  function month(items) {
    const grid=node('div','calmonth');
    for(const label of ['S','M','T','W','T','F','S']) grid.append(node('span','calweekday',label));
    const first=new Date(state.date.getFullYear(),state.date.getMonth(),1), start=shift(first,-first.getDay());
    const today=calendarKey(new Date());
    for(let i=0;i<42;i++) {
      const date=shift(start,i), key=calendarKey(date), events=calendarDayItems(items,date);
      const cell=button('',()=>{state.date=date;state.mode='day';return load();},`${date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}, ${events.length} activities`);cell.className='caldate';
      cell.classList.toggle('outside',date.getMonth()!==first.getMonth());cell.classList.toggle('today',key===today);cell.classList.toggle('selected',key===calendarKey(state.date));
      cell.append(node('span','calnumber',date.getDate()));
      const markers=node('span','calmarkers');
      for(const event of events.slice(0,3)) {const mark=node('i','');mark.style.background=COLORS[event.category] || COLORS.other;markers.append(mark);}
      cell.append(markers);if(events.length>3)cell.append(node('small','',`+${events.length-3}`));grid.append(cell);
    }
    root.append(grid,node('p','calhint','Tap a day to see its time slots.'));
  }
  // Sibling controls keep actions on the block without nesting buttons.
  function activityBlock(item, className, compact=false) {
    const block=node('div',className);block.style.setProperty('--event',COLORS[item.category] || COLORS.other);
    const main=button('',()=>{
      const opening=actions.hidden;closeActivityActions?.();
      actions.hidden=!opening;main.setAttribute('aria-expanded',String(opening));
      block.classList.toggle('actionsopen',opening);
      closeActivityActions=opening ? ()=>{actions.hidden=true;main.setAttribute('aria-expanded','false');block.classList.toggle('actionsopen',false);} : null;
    },`${item.title}, activity actions`);main.className='calactivitymain';main.setAttribute('aria-expanded','false');
    main.append(node('strong','',item.title),node('small','',item.all_day ? 'All day' : `${clock(new Date(item.starts_at))} – ${clock(endOf(item))}`));
    const actions=node('div','calactivityactions');actions.hidden=true;
    actions.append(button(item.notes ? 'Notes' : 'Add notes',()=>ctx.editScheduleNotes(item)),button('Edit',()=>ctx.editScheduleItem(item)));
    if(item.status==='planned' && !item.all_day)actions.append(button('Running over',()=>ctx.openScheduleOverrun(item)));
    actions.append(button('Details',()=>ctx.openPlannerItem(item)));
    block.onkeydown=(event)=>{if(event.key==='Escape'){closeActivityActions?.();closeActivityActions=null;main.focus();}};
    block.append(main,actions);if(compact)block.className+=' compactactivity';return block;
  }
  function agenda(items) {
    const host=node('div','calagenda');root.append(host);let count=0;
    for(let i=0;i<30;i++) {
      const date=shift(state.date,i), events=calendarDayItems(items,date);if(!events.length)continue;count+=events.length;
      host.append(node('h3','',date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})));
      for(const item of events) {
        host.append(activityBlock(item,'caleventrow'));
      }
    }
    if(!count)host.append(node('p','calempty',search ? 'No matching activities in this period.' : 'Your schedule is open. Tap + to add something, or plan with Nex.'));
  }
  function timeline(items) {
    const days=Array.from({length:state.mode==='multi' ? 3 : 1},(_,i)=>shift(state.date,i));
    const head=node('div','caldayheads');head.style.setProperty('--days',days.length);head.append(node('span','',''));
    for(const day of days)head.append(button(day.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),()=>{state.date=day;state.mode='day';return load();}));root.append(head);
    const allDay=node('div','calallday');
    for(const day of days) for(const item of calendarDayItems(items,day).filter((item)=>item.all_day)) allDay.append(activityBlock(item,'calalldayitem'));
    if(allDay.childNodes.length)root.append(allDay);
    const scroll=node('div','calhours');const grid=node('div','calhourgrid');grid.style.setProperty('--days',days.length);scroll.append(grid);root.append(scroll);
    const labels=node('div','calhourlabels');
    for(let hour=0;hour<24;hour++)labels.append(node('span','',`${hour%12 || 12} ${hour<12 ? 'AM' : 'PM'}`));grid.append(labels);
    for(const day of days) {
      const column=node('div','calhourcolumn');
      for(let hour=0;hour<24;hour++) {
        const slot=button('',()=>ctx.openScheduleStudio('block',calendarKey(day),hour*60),`Add activity ${day.toLocaleDateString('en-US',{weekday:'long'})} at ${hour%12 || 12} ${hour<12 ? 'AM' : 'PM'}`);slot.className='calslot';
        const busy=occupiedStart({days:[calendarKey(day)],startMinutes:hour*60,durationMinutes:60,items}).length>0;
        slot.disabled=busy;if(busy){slot.classList.add('taken');slot.setAttribute('aria-label',`Taken hour ${hour%12 || 12} ${hour<12 ? 'AM' : 'PM'}`);}column.append(slot);
      }
      for(const entry of calendarLayout(items,day)) {
        const {item}=entry;const event=activityBlock(item,`caltimed${item.status==='draft' ? ' draft' : ''}`,(entry.end-entry.start)<45);
        event.style.cssText=`top:${entry.start/60*56}px;height:${Math.max(20,(entry.end-entry.start)/60*56)}px;left:calc(${entry.column/entry.columns*100}% + 2px);width:calc(${100/entry.columns}% - 4px);--event:${COLORS[item.category] || COLORS.other}`;
        column.append(event);
      }
      if(calendarKey(day)===calendarKey(new Date())) {const now=new Date();const line=node('div','calnow');line.style.top=`${(now.getHours()+now.getMinutes()/60)*56}px`;column.append(line);}
      grid.append(column);
    }
    requestAnimationFrame(()=>{scroll.scrollTop=8*56;});root.append(node('p','calhint','Tap an open hour to add. Tap an activity for notes, editing, or more time.'));
  }
  await load();return root;
}
