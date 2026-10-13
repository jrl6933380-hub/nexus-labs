import {attachCalendarSelection} from './calendar-selection.js';
import {attachCalendarDrag} from './calendar-drag.js';
import { friendlyError } from './ux.js';
// A calendar-first surface over the shared Schedule store.
import { occupiedStart } from './schedule-availability.js';
const COLORS = {sleep:'#879ade',personal:'#bd91d9',work:'#56a97b',project:'#9a7bea',gym:'#d5b366',health:'#65b8b2',family:'#e9a66f',social:'#b18cd2',appointment:'#e0c35c',errands:'#a5a19a',learning:'#74b7e8',creative:'#c883d8',rest:'#7b87a7',travel:'#d78b68',other:'#8e8a84'};
const globalCalendarState = {date:new Date(),mode:'list'};
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
export async function renderScheduleCalendar(ctx, extras={}) {
  const state=ctx.calendarState || globalCalendarState;
  if(!state.mode)state.mode='list';
  const root=node('section','nexcalendar');
  let payload={items:[]}, requestId=0, search='', closeActivityActions=null, savedScroll=null, revealSelectedDay=false;
  async function load() {
    const id=++requestId;
    root.setAttribute('aria-busy','true');
    const start=state.mode === 'month' ? new Date(state.date.getFullYear(),state.date.getMonth(),1) : dayStart(state.date);
    const from=shift(start,state.mode === 'month' ? -start.getDay() : state.mode==='week' ? -((start.getDay()+6)%7) : 0);
    const to=state.mode === 'month' ? shift(from,42) : shift(from,state.mode==='week' ? 7 : state.mode === 'multi' ? 3 : state.mode === 'list' ? 30 : 1);
    try {
      // Include blocks starting before the range, such as overnight events.
      const response=await fetch(`${ctx.calendarEndpoint || '/api/planner'}?from=${encodeURIComponent(shift(from,-14).toISOString())}&to=${encodeURIComponent(to.toISOString())}`,{credentials:'include'});
      const data=await response.json(); if(!response.ok){const error=new Error(data.error || 'Could not load your calendar');error.status=response.status;throw error;}
      if(id !== requestId) return;
      const items=(data.items || []).filter((item)=>new Date(item.starts_at)<to && endOf(item)>from && item.status !== 'cancelled');
      const category_minutes={}, conflicts=[];
      const active=items.filter((item)=>item.status==='planned' || item.status==='draft');
      for(const item of active) {const minutes=Math.max(0,(Math.min(endOf(item),to)-Math.max(new Date(item.starts_at),from))/60000);category_minutes[item.category || 'other']=(category_minutes[item.category || 'other'] || 0)+minutes;}
      for(let a=0;a<active.length;a++)for(let b=a+1;b<active.length;b++)if(new Date(active[a].starts_at)<endOf(active[b]) && endOf(active[a])>new Date(active[b].starts_at))conflicts.push([active[a].id,active[b].id]);
      payload={...data,items,summary:{category_minutes,conflicts}}; ctx.setScheduleItems?.(data.items || []);draw();
    } catch(error) {
      if(id !== requestId) return;
      root.replaceChildren(node('p','calerror',friendlyError(error,{action:'load',subject:'your calendar'})),button('Try again',load));
    } finally {if(id === requestId) root.removeAttribute('aria-busy');}
  }
  function draw() {
    closeActivityActions=null;root.replaceChildren();root.setAttribute('data-mode',state.mode);
    const items=(payload.items || []).filter((item) => item.status !== 'cancelled' && (!search || item.title.toLowerCase().includes(search.toLowerCase())));
    const toolbar=node('div','caltoolbar');
    const heading=node('h2','','Calendar');
    toolbar.append(node('span','nx-product-logo','N'),heading,button('↻',load,'Refresh calendar'));
    const add=button('+',()=>ctx.openScheduleStudio('block',calendarKey(state.date)),'Add activity'); add.className='caladd';toolbar.append(add);root.append(toolbar);
    const controls=node('div','calcontrols');
    const modes=node('div','calmodes');modes.setAttribute('aria-label','Calendar views');
    for(const [mode,label] of [['list','List'],['day','Day'],['week','Week'],['month','Month']]) {
      const control=button(label,()=>{state.mode=mode;return load();});control.classList.toggle('active',state.mode===mode);control.setAttribute('aria-pressed',String(state.mode===mode));modes.append(control);
    }
    controls.append(modes);root.append(controls);
    const strip=node('nav','caldatestrip');strip.setAttribute('aria-label','Choose calendar day');const monday=shift(state.date,-((state.date.getDay()+6)%7));
    strip.append(button('‹',()=>navigate(-1),'Previous period'));
    for(let i=0;i<7;i++){const day=shift(monday,i),pick=button('',()=>{state.date=day;revealSelectedDay=true;return load();},day.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}));pick.append(node('small','',day.toLocaleDateString('en-US',{weekday:'short'})),node('strong','',day.getDate()));pick.setAttribute('aria-pressed',String(calendarKey(day)===calendarKey(state.date)));strip.append(pick);}
    strip.append(button('›',()=>navigate(1),'Next period'));if(state.mode==='day' || state.mode==='week' || state.mode==='multi')root.append(strip);
    const dayHeading=node('div','caldateheading');dayHeading.append(node('strong','',state.date.toLocaleDateString('en-US',state.mode==='month' ? {month:'long',year:'numeric'} : {weekday:'long',month:'long',day:'numeric'})),button('Today',()=>{state.date=new Date();savedScroll=Math.max(0,(state.date.getHours()-1)*56);revealSelectedDay=true;return load();}));if(state.mode==='list' || state.mode==='month'){dayHeading.prepend(button('‹',()=>navigate(-1),'Previous period'));dayHeading.append(button('›',()=>navigate(1),'Next period'));}root.append(dayHeading);
    const tools=node('div','caltools');
    tools.append(button('✦ Plan with Nex',()=>ctx.planWithNex ? ctx.planWithNex() : ctx.openScheduleStudio('week')),button(ctx.balanceLabel || 'Time balance',()=>{
      const previous=root.querySelector('.calinsight');if(previous){previous.remove();return;}
      const host=node('div','calinsight');host.append(extras.balance ? extras.balance(payload.summary,payload.items || [],ctx) : node('p','','Ask Nex to review how your time is balanced.'));root.append(host);host.scrollIntoView({block:'nearest'});
    }));
    const more=node('details','calmore');more.append(node('summary','','More'));
    more.append(button('Guided planner',()=>ctx.openScheduleStudio('week')),button(ctx.weekLabel || 'Build next week',()=>ctx.openWeekRollover()),button('Ask Nex to adjust',()=>ctx.ask(`Read my ${ctx.calendarSubject || 'schedule'} for ${calendarKey(state.date)}. Show me the tradeoffs and clickable ways to adjust it without moving protected commitments.`)));
    for(const [mode,label] of [['multi','Three days']])more.append(button(label,()=>{state.mode=mode;return load();}));
    const find=node('input','calsearch');find.type='search';find.placeholder='Find an activity';find.setAttribute('aria-label','Search schedule');find.value=search;
    find.onchange=()=>{search=find.value;state.mode='list';return load();};more.append(find);tools.append(more);
    for(const draftId of payload.drafts || []) {
      const draftItems=(payload.draft_items || payload.items || []).filter((item)=>item.draft_id===draftId);
      const draft=button(`Review draft · ${draftItems.length} blocks`,()=>ctx.reviewWeekDraft(draftId,draftItems));draft.className='caldraft';root.append(draft);
    }
    if(state.mode === 'month') month(items);
    else if(state.mode === 'list') agenda(items);
    else timeline(items);
    const nex=node('details','calnex');nex.append(node('summary','','Planning options'),tools);const ask=button('✦ Ask Nex',()=>ctx.planWithNex ? ctx.planWithNex() : ctx.ask?.('Help me plan my schedule.'));ask.className='calask';const footer=node('div','calfooter');footer.append(ask,nex);root.append(footer);
  }
  function navigate(direction) {
    if(state.mode === 'month') state.date=new Date(state.date.getFullYear(),state.date.getMonth()+direction,Math.min(state.date.getDate(),28));
    else state.date=shift(state.date,direction*(state.mode==='week' ? 7 : state.mode === 'multi' ? 3 : state.mode === 'list' ? 7 : 1));
    load();
  }
  function month(items) {
    const grid=node('div','calmonth');
    for(const label of ['S','M','T','W','T','F','S']) grid.append(node('span','calweekday',label));
    const first=new Date(state.date.getFullYear(),state.date.getMonth(),1), start=shift(first,-first.getDay());
    const today=calendarKey(new Date());
    for(let i=0;i<42;i++) {
      const date=shift(start,i), key=calendarKey(date), events=calendarDayItems(items,date);
      const cell=button('',()=>{const sameMonth=date.getMonth()===state.date.getMonth() && date.getFullYear()===state.date.getFullYear();state.date=date;return sameMonth ? draw() : load();},`${date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}, ${events.length} activities`);cell.className='caldate';
      cell.classList.toggle('outside',date.getMonth()!==first.getMonth());cell.classList.toggle('today',key===today);cell.classList.toggle('selected',key===calendarKey(state.date));
      cell.append(node('span','calnumber',date.getDate()));
      const markers=node('span','calmarkers');
      for(const event of events.slice(0,3)) {const mark=node('i','');mark.style.background=COLORS[event.category] || COLORS.other;markers.append(mark);}
      cell.append(markers);if(events.length>3)cell.append(node('small','',`+${events.length-3}`));grid.append(cell);
    }
    const host=node('div','calmonthsurface');root.append(host);host.append(grid);const heading=node('div','calmonthday');heading.append(node('h3','',state.date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})),button('Open day',()=>{state.mode='day';return load();}));host.append(heading);const events=calendarDayItems(items,state.date);for(const item of events)host.append(activityBlock(item,'caleventrow'));if(!events.length)host.append(node('p','calempty','No activities this day. Open day to select a time.'));
  }
  // Sibling controls keep actions on the block without nesting buttons.
  function activityBlock(item, className, compact=false) {
    const block=node('div',className);block.style.setProperty('--event',COLORS[item.category] || COLORS.other);
    const main=button('',()=>{
      const opening=actions.hidden;closeActivityActions?.();
      actions.hidden=!opening;main.setAttribute('aria-expanded',String(opening));
      block.classList.toggle('actionsopen',opening);
      closeActivityActions=opening ? ()=>{actions.hidden=true;main.setAttribute('aria-expanded','false');block.classList.toggle('actionsopen',false);} : null;
    },`${item.title}${ctx.activitySummary ? `, ${ctx.activitySummary(item)}` : ''}, activity actions`);main.className='calactivitymain';main.setAttribute('aria-expanded','false');
    main.append(node('strong','',ctx.activityTitle?.(item) || item.title),node('small','',item.all_day ? 'All day' : `${clock(new Date(item.starts_at))} – ${clock(endOf(item))}`));
    if(ctx.activitySummary)main.append(node('small','calexperience',ctx.activitySummary(item)));
    const actions=node('div','calactivityactions');actions.hidden=true;
    actions.append(button(item.notes ? 'Notes' : 'Add notes',()=>ctx.editScheduleNotes(item)),button('Edit',()=>ctx.editScheduleItem(item)));
    if(item.status==='planned' && !item.all_day)actions.append(button('Running over',()=>ctx.openScheduleOverrun(item)));
    actions.append(button(ctx.detailsLabelFor?.(item) || ctx.detailsLabel || 'Details',()=>ctx.openPlannerItem(item)));
    if(ctx.activityActions)actions.append(...ctx.activityActions(item));
    block.onkeydown=(event)=>{if(event.key==='Escape'){closeActivityActions?.();closeActivityActions=null;main.focus();}};
    block.append(main,actions);if(compact)block.className+=' compactactivity';return block;
  }
  function agenda(items) {
    const host=node('div','calagenda');root.append(host);let count=0;
    for(let i=0;i<30;i++) {
      const date=shift(state.date,i), events=calendarDayItems(items,date);if(!events.length)continue;count+=events.length;
      if(i!==0)host.append(node('h3','',date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})));
      for(const item of events) {
        host.append(activityBlock(item,'caleventrow'));
      }
    }
    if(!count)host.append(node('p','calempty',search ? 'No matching activities in this period.' : 'Your schedule is open. Tap + to add something, or plan with Nex.'));
  }
  function timeline(items) {
    const first=state.mode==='week' ? shift(state.date,-((state.date.getDay()+6)%7)) : state.date;
    const days=Array.from({length:state.mode==='week' ? 7 : state.mode==='multi' ? 3 : 1},(_,i)=>shift(first,i));
    const canvas=node('div',state.mode==='week' ? 'calweekcanvas' : 'calcanvas');root.append(canvas);
    const head=node('div','caldayheads');head.style.setProperty('--days',days.length);head.append(node('span','',''));
    for(const day of days)head.append(button(day.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),()=>{state.date=day;state.mode='day';return load();}));const headViewport=node('div','calheadviewport');headViewport.append(head);canvas.append(headViewport);
    const allDay=node('div','calallday');
    for(const day of days) for(const item of calendarDayItems(items,day).filter((item)=>item.all_day)) allDay.append(activityBlock(item,'calalldayitem'));
    if(allDay.childNodes.length)root.append(allDay);
    const scroll=node('div','calhours');const grid=node('div','calhourgrid');grid.style.setProperty('--days',days.length);scroll.append(grid);canvas.append(scroll);
    const columns=[];const labels=node('div','calhourlabels');
    for(let hour=0;hour<24;hour++)labels.append(node('span','',`${hour%12 || 12} ${hour<12 ? 'AM' : 'PM'}`));grid.append(labels);
    for(const day of days) {
      const column=node('div','calhourcolumn');column.setAttribute('data-day',calendarKey(day));columns.push(column);
      for(let hour=0;hour<24;hour++) {
        const slot=button('',()=>column.selectTime(hour*60),`Add activity ${day.toLocaleDateString('en-US',{weekday:'long'})} at ${hour%12 || 12} ${hour<12 ? 'AM' : 'PM'}`);slot.className='calslot';
        const busy=occupiedStart({days:[calendarKey(day)],startMinutes:hour*60,durationMinutes:60,items}).length>0;
        slot.disabled=busy;if(busy){slot.classList.add('taken');slot.setAttribute('aria-label',`Taken hour ${hour%12 || 12} ${hour<12 ? 'AM' : 'PM'}`);}column.append(slot);
      }
      for(const entry of calendarLayout(items,day)) {
        const {item}=entry;const event=activityBlock(item,`caltimed${item.status==='draft' ? ' draft' : ''}`,(entry.end-entry.start)<45);
        event.style.cssText=`top:${entry.start/60*56}px;height:${Math.max(20,(entry.end-entry.start)/60*56)}px;left:calc(${entry.column/entry.columns*100}% + 2px);width:calc(${100/entry.columns}% - 4px);--event:${COLORS[item.category] || COLORS.other}`;
        column.append(event);
        if(ctx.changeCalendarTimes)attachCalendarDrag({event,item,day,entry,columns,grid,scroll,onChange:async(record,times)=>{savedScroll=scroll.scrollTop;await ctx.changeCalendarTimes(record,times);await load();},onError:error=>{const message=node('p','calerror',friendlyError(error,{subject:'calendar change'}));message.setAttribute('role','alert');root.append(message);}});
      }
      if(calendarKey(day)===calendarKey(new Date())) {const now=new Date();const line=node('div','calnow');line.style.top=`${(now.getHours()+now.getMinutes()/60)*56}px`;column.append(line);}
      grid.append(column);
      attachCalendarSelection({column,day,grid,scroll,items,onCreate:range=>{savedScroll=scroll.scrollTop;ctx.openScheduleStudio('block',range.day,range.minutes,range.duration);}});
    }
    scroll.onscroll=()=>{headViewport.scrollLeft=scroll.scrollLeft;};
    requestAnimationFrame(()=>{scroll.scrollTop=savedScroll ?? 8*56;savedScroll=null;if(revealSelectedDay){const index=days.findIndex(day=>calendarKey(day)===calendarKey(state.date));scroll.scrollLeft=Math.max(0,index)*((grid.scrollWidth-56)/days.length);revealSelectedDay=false;}headViewport.scrollLeft=scroll.scrollLeft;});root.append(node('p','calhint',ctx.changeCalendarTimes ? 'Tap empty time, then drag to adjust. Tap an event for Move and Duration.' : 'Tap an open hour to add. Tap an activity for notes, editing, or more time.'));
  }
  await load();return root;
}
