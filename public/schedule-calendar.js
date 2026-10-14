import {calendarState as globalCalendarState} from './calendar-navigation.js';
import {openReminderDetail} from './reminders.js';
import {calendarKey,calendarDayItems,calendarLayout,dayStart,shift,endOf} from './calendar-layout.js';
export {calendarKey,calendarDayItems,calendarLayout};
import {renderLifeCalendar} from './life-calendar.js';
import { friendlyError } from './ux.js';
// A calendar-first surface over the shared Schedule store.
const COLORS = {sleep:'#879ade',personal:'#bd91d9',work:'#56a97b',project:'#9a7bea',gym:'#d5b366',health:'#65b8b2',family:'#e9a66f',social:'#b18cd2',appointment:'#e0c35c',errands:'#a5a19a',learning:'#74b7e8',creative:'#c883d8',rest:'#7b87a7',travel:'#d78b68',other:'#8e8a84'};
function node(tag,className,text) { const element=document.createElement(tag);element.className=className;if(text !== undefined) element.textContent=text;return element; }
function button(text,action,label=text) {
  const element=node('button','',text);element.type='button';element.setAttribute('aria-label',label);let touchAt=0;
  element.onclick=event=>{if(event?.detail>0 && Date.now()-touchAt<700)return;return action(event);};
  element.onpointerup=event=>{if(event.pointerType==='touch' && !element.disabled){event.preventDefault();event.stopPropagation();touchAt=Date.now();return action(event);}};
  return element;
}
const clock = (date) => date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
export async function renderScheduleCalendar(ctx, extras={}) {
  const state=ctx.calendarState || globalCalendarState;
  if(!state.mode)state.mode='list';
  const root=node('section','nexcalendar');
  let payload={items:[]}, requestId=0, search='', closeActivityActions=null, currentTimeline=null;
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
      const active=items.filter((item)=>!item.calendar_marker && (item.status==='planned' || item.status==='draft'));
      for(const item of active) {const minutes=Math.max(0,(Math.min(endOf(item),to)-Math.max(new Date(item.starts_at),from))/60000);category_minutes[item.category || 'other']=(category_minutes[item.category || 'other'] || 0)+minutes;}
      for(let a=0;a<active.length;a++)for(let b=a+1;b<active.length;b++)if(new Date(active[a].starts_at)<endOf(active[b]) && endOf(active[a])>new Date(active[b].starts_at))conflicts.push([active[a].id,active[b].id]);
      payload={...data,items,summary:{category_minutes,conflicts}}; ctx.setScheduleItems?.(data.items || []);draw();
    } catch(error) {
      if(id !== requestId) return;
      root.replaceChildren(node('p','calerror',friendlyError(error,{action:'load',subject:'your calendar'})),button('Try again',load));
    } finally {if(id === requestId) root.removeAttribute('aria-busy');}
  }
  function draw() {
    currentTimeline?.dispose?.();currentTimeline=null;closeActivityActions=null;root.replaceChildren();root.setAttribute('data-mode',state.mode);
    const items=(payload.items || []).filter((item) => item.status !== 'cancelled' && (!search || item.title.toLowerCase().includes(search.toLowerCase())));
    const toolbar=node('div','caltoolbar');
    const heading=node('h2','','Calendar');
    toolbar.append(node('span','nx-product-logo','N'),heading,button('↻',load,'Refresh calendar'));
    const add=button('+',()=>ctx.openScheduleStudio('block',calendarKey(state.date)),'Add activity'); add.className='caladd';toolbar.append(add);root.append(toolbar);
    const controls=node('div','calcontrols');
    const modes=node('div','calmodes');modes.setAttribute('aria-label','Calendar views');
    for(const [mode,label] of [['list','List'],['day','Day'],['week','Week'],['month','Month']]) {
      const control=button(label,()=>{state.mode=mode;state.timelineScrollLeft=undefined;return load();});control.classList.toggle('active',state.mode===mode);control.setAttribute('aria-pressed',String(state.mode===mode));modes.append(control);
    }
    controls.append(modes);root.append(controls);
    const dayHeading=node('div','caldateheading');dayHeading.append(node('strong','',state.date.toLocaleDateString('en-US',state.mode==='month' ? {month:'long',year:'numeric'} : {weekday:'long',month:'long',day:'numeric'})),button('Today',()=>{state.date=new Date();state.timelineScrollTop=Math.max(0,(state.date.getHours()-1)*80);state.timelineScrollLeft=undefined;return load();}));{dayHeading.prepend(button('‹',()=>navigate(-1),'Previous period'));dayHeading.append(button('›',()=>navigate(1),'Next period'));}root.append(dayHeading);
    const tools=node('div','caltools');
    tools.append(button('✦ Plan with Nex',()=>ctx.planWithNex ? ctx.planWithNex() : ctx.openScheduleStudio('week')),button(ctx.balanceLabel || 'Time balance',()=>{
      const previous=root.querySelector('.calinsight');if(previous){previous.remove();return;}
      const host=node('div','calinsight');host.append(extras.balance ? extras.balance(payload.summary,payload.items || [],ctx) : node('p','','Ask Nex to review how your time is balanced.'));root.append(host);host.scrollIntoView({block:'nearest'});
    }));
    const more=node('details','calmore');more.append(node('summary','','More'));
    more.append(button('Guided planner',()=>ctx.openScheduleStudio('week')),button(ctx.weekLabel || 'Build next week',()=>ctx.openWeekRollover()),button('Ask Nex to adjust',()=>ctx.ask(`Read my ${ctx.calendarSubject || 'schedule'} for ${calendarKey(state.date)}. Show me the tradeoffs and clickable ways to adjust it without moving protected commitments.`)));
    for(const [mode,label] of [['multi','Three days']])more.append(button(label,()=>{state.mode=mode;state.timelineScrollLeft=undefined;return load();}));
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
    const host=node('div','calmonthsurface');root.append(host);host.append(grid);const heading=node('div','calmonthday');heading.append(node('h3','',state.date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})),button('Open day',()=>{state.mode='day';state.timelineScrollLeft=undefined;return load();}));host.append(heading);const events=calendarDayItems(items,state.date);for(const item of events)host.append(activityBlock(item,'caleventrow'));if(!events.length)host.append(node('p','calempty','No activities this day. Open day to select a time.'));
  }
  // Sibling controls keep actions on the block without nesting buttons.
  function activityBlock(item, className, compact=false) {
    if(item.calendar_marker){const row=node('div',className+' calremindermarker');const pick=button('',()=>openReminderDetail(ctx,item.reminder_id),`Open reminder ${item.title}`);pick.append(node('strong','','Reminder · '+item.title),node('small','',clock(new Date(item.starts_at))));row.append(pick);return row;}

    const block=node('div',className);block.style.setProperty('--event',COLORS[item.category] || COLORS.other);
    const main=button('',()=>{
      const opening=actions.hidden;closeActivityActions?.();
      actions.hidden=!opening;main.setAttribute('aria-expanded',String(opening));
      block.classList.toggle('actionsopen',opening);
      closeActivityActions=opening ? ()=>{actions.hidden=true;main.setAttribute('aria-expanded','false');block.classList.toggle('actionsopen',false);} : null;
    },`${item.title}${ctx.activitySummary ? `, ${ctx.activitySummary(item)}` : ''}, activity actions`);main.className='calactivitymain';main.setAttribute('aria-expanded','false');
    main.append(node('strong','',ctx.activityTitle?.(item) || item.title),node('small','',item.all_day ? 'All day' : `${clock(new Date(item.starts_at))} – ${clock(endOf(item))}`));
    if(item.source==='life')main.append(node('small','calorigin','From Life'));
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
    const host=node('div','calsharedtimeline');root.append(host);
    const first=state.mode==='week' ? shift(state.date,-((state.date.getDay()+6)%7)) : state.date;
    const days=Array.from({length:state.mode==='week'?7:state.mode==='multi'?3:1},(_,i)=>shift(first,i));
    const allDay=items.filter(item=>item.all_day && days.some(day=>calendarDayItems([item],day).length));
    if(allDay.length){const row=node('div','calallday');for(const item of allDay)row.append(activityBlock(item,'calalldayitem'));host.append(row);}
    const timelineState={date:state.date,scrollTop:state.timelineScrollTop,scrollLeft:state.timelineScrollLeft};
    function remember(){state.timelineScrollTop=timelineState.scrollTop;state.timelineScrollLeft=timelineState.scrollLeft;}
    const calendar=renderLifeCalendar({items,state:timelineState,mode:state.mode,hideToolbar:true,ariaLabel:'Calendar time slots',
      onCreate:range=>{remember();ctx.openScheduleStudio('block',range.day,range.minutes,range.duration);},
      onOpen:item=>{remember();if(item.reminder_id)return openReminderDetail(ctx,item.reminder_id);(ctx.editScheduleItem || ctx.openPlannerItem)?.(item);},
      onChange:async(item,times)=>{remember();if(!ctx.changeCalendarTimes)throw new Error('Time editing is unavailable here. Open the activity editor.');await ctx.changeCalendarTimes(item,times);await load();},
      onNavigate:()=>{remember();state.date=timelineState.date;return load();},
      onSelectDay:day=>{remember();state.date=day;return load();},
      colorFor:item=>COLORS[item.category] || COLORS.other,
      onOpenReminder:item=>openReminderDetail(ctx,item.reminder_id),
    });currentTimeline=calendar;host.append(calendar);
  }
  await load();return root;
}
