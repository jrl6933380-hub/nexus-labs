import {calendarKey,calendarLayout} from './schedule-calendar.js';
export const LIFE_HOUR_HEIGHT=80;
const colors={work:'#418ba5',sleep:'#697990',social:'#52a998',health:'#c7a142',personal:'#9c83ae'};
const clock=date=>new Date(date).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
function dayAt(value){if(typeof value==='string'){const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d);}const day=new Date(value);day.setHours(0,0,0,0);return day;}
function at(day,minute){const value=dayAt(day);value.setMinutes(minute);return value;}
export function lifeSelection(day,anchor,current){
  const a=Math.max(0,Math.min(1425,Math.round(anchor/15)*15)),b=Math.max(0,Math.min(1440,Math.round(current/15)*15));
  const start=Math.min(a,b),end=Math.max(start+15,a,b);
  return {day:calendarKey(dayAt(day)),minutes:start,duration:end-start,starts_at:at(day,start).toISOString(),ends_at:at(day,end).toISOString()};
}
export function lifeMovedTimes(item,visibleDay,targetDay,targetMinute,entryStart){
  const source=dayAt(visibleDay),original=new Date(item.starts_at);
  const originalMinutes=(Date.parse(item.starts_at)-source)/60000;
  const target=at(targetDay,Math.round(targetMinute/15)*15-(entryStart-originalMinutes));
  return {starts_at:target.toISOString(),ends_at:new Date(+target+Date.parse(item.ends_at)-Date.parse(item.starts_at)).toISOString()};
}
const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const button=(text,run,label=text)=>{const el=node('button','',text);el.type='button';el.setAttribute('aria-label',label);el.onclick=run;return el;};

// Life has one calendar. The lanes are the controls: draw a range, move a block,
// or pull its bottom edge. Mouse and touch share the same save/preview path.
export function renderLifeCalendar({items,state,onCreate,onOpen,onChange,onNavigate}){
  const root=node('section','lifecalendar');root.setAttribute('aria-label','Life calendar');
  const current=dayAt(state.date),monday=dayAt(current);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
  const days=Array.from({length:7},(_,i)=>{const date=dayAt(monday);date.setDate(date.getDate()+i);return date;});
  const toolbar=node('div','lc-toolbar'),title=node('div','lc-period');
  title.append(node('strong','',current.toLocaleDateString('en-US',{month:'long',year:'numeric'})),node('small','',`${days[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${days[6].toLocaleDateString('en-US',{month:'short',day:'numeric'})}`));
  function navigate(offset){captureScroll();state.date=new Date(+current);state.date.setDate(state.date.getDate()+offset);state.scrollLeft=0;onNavigate();}
  toolbar.append(button('‹',()=>navigate(-7),'Previous week'),title,button('›',()=>navigate(7),'Next week'),button('Today',()=>{state.date=new Date();state.scrollTop=null;state.scrollLeft=null;onNavigate();}));root.append(toolbar);
  const viewport=node('div','lc-viewport'),canvas=node('div','lc-canvas'),heads=node('div','lc-days'),grid=node('div','lc-grid');
  const status=node('p','lc-status','Tap empty time, then drag the selection or either edge. Tap Add details when ready.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const gutter=node('div','lc-hourlabels');for(let hour=0;hour<24;hour++)gutter.append(node('span','',`${hour%12 || 12} ${hour<12 ? 'AM' : 'PM'}`));
  heads.append(node('div','lc-corner','TIME'));grid.append(gutter);
  const columns=[],today=calendarKey(new Date());let saving=false;
  function captureScroll(){state.scrollTop=viewport.scrollTop;state.scrollLeft=viewport.scrollLeft;dayViewport.scrollLeft=viewport.scrollLeft;}
  function columnAt(x,fallback){return columns.find(column=>{const r=column.getBoundingClientRect();return x>=r.left && x<r.right;}) || fallback;}
  function minuteAt(y){return Math.max(0,Math.min(1440,(y-grid.getBoundingClientRect().top)/LIFE_HOUR_HEIGHT*60));}
  function clashes(start,end,ignore){return items.some(item=>item.id!==ignore && item.status!=='cancelled' && item.status!=='done' && Date.parse(item.starts_at)<Date.parse(end) && Date.parse(item.ends_at)>Date.parse(start));}
  function autoScroll(x,y){const r=viewport.getBoundingClientRect();if(y<r.top+70)viewport.scrollTop-=10;else if(y>r.bottom-35)viewport.scrollTop+=10;if(x<r.left+18)viewport.scrollLeft-=8;else if(x>r.right-18)viewport.scrollLeft+=8;}
  async function change(item,times){
    captureScroll();saving=true;root.setAttribute('aria-busy','true');status.textContent='Saving time…';
    try{await onChange(item,times);status.textContent='Time saved.';}catch(error){status.textContent=error.message || 'Could not save this time. Your original block is unchanged.';}
    finally{saving=false;root.removeAttribute('aria-busy');}
  }
  let dismissSelection=null;
  const selectionActions=node('div','lc-selectionactions');selectionActions.hidden=true;
  root.append(selectionActions);
  function selectionLane(column,day){
    let gesture=null,timer=null,preview=null,range=null,rangeDay=day;
    function cancelKey(event){if(event.key==='Escape'){event.preventDefault();clean();status.textContent='Selection cancelled.';}}
    function clean(){
      document.removeEventListener('keydown',cancelKey);clearTimeout(timer);preview?.remove();preview=null;gesture=null;range=null;
      selectionActions.hidden=true;selectionActions.replaceChildren();if(dismissSelection===clean)dismissSelection=null;
    }
    function paint(){
      if(!range)return;
      if(!preview){
        preview=node('div','lc-selection lc-draft');preview.tabIndex=0;preview.setAttribute('aria-label','Selected time. Drag to move, or drag either edge to resize.');
        const label=node('span','lc-draftlabel'),top=node('span','lc-resize lc-resize-top'),bottom=node('span','lc-resize');
        top.dataset.edge='start';bottom.dataset.edge='end';top.append(node('i',''));bottom.append(node('i',''));preview.append(label,top,bottom);
        preview.onpointerdown=e=>{
          if(saving || e.button!==0)return;e.preventDefault();e.stopPropagation();preview.setPointerCapture(e.pointerId);
          gesture={mode:e.target.closest('.lc-resize')?.dataset.edge || 'move',anchor:minuteAt(e.clientY),start:range.minutes,end:range.minutes+range.duration};
        };
        preview.onpointermove=e=>{
          if(!gesture)return;e.preventDefault();e.stopPropagation();autoScroll(e.clientX,e.clientY);
          const minute=Math.round(minuteAt(e.clientY)/15)*15;
          if(gesture.mode==='move'){
            const target=columnAt(e.clientX,preview.parentElement);rangeDay=target.dataset.day;target.append(preview);
            const start=Math.max(0,Math.min(1440-range.duration,gesture.start+Math.round((minuteAt(e.clientY)-gesture.anchor)/15)*15));
            range=lifeSelection(rangeDay,start,start+range.duration);
          }else if(gesture.mode==='start'){
            range=lifeSelection(rangeDay,Math.max(0,Math.min(gesture.end-15,minute)),gesture.end);
          }else{
            range=lifeSelection(rangeDay,gesture.start,Math.max(gesture.start+15,Math.min(1440,minute)));
          }
          paint();
        };
        preview.onpointerup=e=>{e.preventDefault();e.stopPropagation();gesture=null;captureScroll();};
        preview.onpointercancel=()=>{gesture=null;};
        preview.onkeydown=e=>{
          if(e.key==='Enter'){e.preventDefault();finish();}
          if(e.key==='Escape'){e.preventDefault();clean();}
        };
        column.append(preview);
      }
      preview.style.top=`${range.minutes/60*LIFE_HOUR_HEIGHT}px`;preview.style.height=`${range.duration/60*LIFE_HOUR_HEIGHT}px`;
      preview.querySelector('.lc-draftlabel').textContent=`${clock(range.starts_at)} – ${clock(range.ends_at)}`;
      const busy=clashes(range.starts_at,range.ends_at);preview.classList.toggle('lc-conflict',busy);
      status.textContent=busy ? 'This time overlaps an activity. Move or resize the selection.' : `${clock(range.starts_at)} – ${clock(range.ends_at)} · drag to adjust, then add details`;
      selectionActions.querySelector('button').disabled=busy;
    }
    function finish(){
      if(!range || clashes(range.starts_at,range.ends_at))return;const selected={...range};clean();captureScroll();onCreate(selected);
    }
    function begin(start,end){
      dismissSelection?.();dismissSelection=clean;rangeDay=day;range=lifeSelection(day,start,end);
      document.addEventListener('keydown',cancelKey);selectionActions.replaceChildren(button('Add details',finish),button('Cancel',clean));selectionActions.hidden=false;paint();
    }
    column.onpointerdown=e=>{
      if(saving || e.button!==0 || e.target.closest('.lc-block,.lc-selection'))return;
      e.preventDefault();column.setPointerCapture(e.pointerId);
      const anchor=Math.floor(minuteAt(e.clientY)/15)*15;begin(anchor,anchor+15);
      gesture={anchor,current:minuteAt(e.clientY),x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,mode:e.pointerType==='touch' ? 'waiting' : 'select'};
      if(gesture.mode==='waiting')timer=setTimeout(()=>{if(gesture?.mode==='waiting')gesture.mode='select';},230);
    };
    column.onpointermove=e=>{
      if(!gesture)return;e.preventDefault();
      if(gesture.mode==='waiting' && Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>10){clearTimeout(timer);gesture.mode='scroll';preview?.remove();preview=null;selectionActions.hidden=true;}
      if(gesture.mode==='scroll'){viewport.scrollTop-=e.clientY-gesture.lastY;viewport.scrollLeft-=e.clientX-gesture.lastX;gesture.lastX=e.clientX;gesture.lastY=e.clientY;return;}
      if(gesture.mode==='select'){autoScroll(e.clientX,e.clientY);range=lifeSelection(day,gesture.anchor,minuteAt(e.clientY));paint();}
    };
    column.onpointerup=e=>{
      if(!gesture)return;e.preventDefault();const mode=gesture.mode;clearTimeout(timer);gesture=null;captureScroll();
      if(mode==='scroll')clean();else paint();
    };
    column.onpointercancel=clean;
    column.onkeydown=e=>{if(e.key==='Escape'){clean();status.textContent='Selection cancelled.';}};
    column.selectRange=begin;
  }
  function directBlock(item,entry,column,day){
    const block=node('div','lc-block');block.tabIndex=0;block.setAttribute('role','button');block.setAttribute('aria-label',`${item.title}, ${clock(item.starts_at)} to ${clock(item.ends_at)}. Drag to move. Press Enter to edit, arrows to move, Shift up or down to resize.`);
    block.dataset.itemId=item.id;block.style.setProperty('--lc-color',colors[item.pillar] || colors.personal);
    const position=()=>{block.style.top=`${entry.start/60*LIFE_HOUR_HEIGHT}px`;block.style.height=`${Math.max(24,(entry.end-entry.start)/60*LIFE_HOUR_HEIGHT)}px`;block.style.left=`calc(${entry.column/entry.columns*100}% + 2px)`;block.style.width=`calc(${100/entry.columns}% - 4px)`;block.style.transform='';};position();
    const text=node('div','lc-blocktext');text.append(node('small','',`${clock(item.starts_at)} – ${clock(item.ends_at)}`),node('strong','',item.title));
    const detail=node('div','lc-blockmeta');detail.append(node('span','',item.person ? '♧' : item.place ? '⌖' : ''),node('span','',item.energy==null ? '' : `${item.energy} ⚡`));
    const edge=node('span','lc-resize');edge.setAttribute('aria-hidden','true');edge.append(node('i',''));block.append(text,detail,edge);column.append(block);
    let gesture=null,keyboard=null;
    function cancelKey(event){if(event.key==='Escape'){event.preventDefault();cancel();}}
    function cancel(){document.removeEventListener('keydown',cancelKey);gesture=null;keyboard=null;block.classList.remove('lc-moving','lc-conflict');position();}
    block.onpointerdown=e=>{
      if(saving || e.button!==0)return;e.preventDefault();e.stopPropagation();block.setPointerCapture(e.pointerId);document.addEventListener('keydown',cancelKey);
      gesture={x:e.clientX,y:e.clientY,offset:minuteAt(e.clientY)-entry.start,resize:Boolean(e.target.closest('.lc-resize')),moved:false,times:null};
    };
    block.onpointermove=e=>{
      if(!gesture)return;e.preventDefault();e.stopPropagation();if(!gesture.moved && Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)<6)return;
      gesture.moved=true;autoScroll(e.clientX,e.clientY);const target=columnAt(e.clientX,column),targetDay=target.dataset.day;
      if(gesture.resize){
        const end=at(targetDay,Math.round(minuteAt(e.clientY)/15)*15);if(+end<=Date.parse(item.starts_at) || +end-Date.parse(item.starts_at)>48*3600000){gesture.times=null;return;}
        gesture.times={starts_at:item.starts_at,ends_at:end.toISOString()};block.style.height=`${Math.max(24,(+end-dayAt(day))/3600000*LIFE_HOUR_HEIGHT-entry.start/60*LIFE_HOUR_HEIGHT)}px`;
      }else{
        const minute=Math.max(0,Math.min(1425,minuteAt(e.clientY)-gesture.offset));gesture.times=lifeMovedTimes(item,day,targetDay,minute,entry.start);
        const left=target.getBoundingClientRect().left-column.getBoundingClientRect().left;
        block.style.transform=`translate(${left}px,${(Math.round(minute/15)*15-entry.start)/60*LIFE_HOUR_HEIGHT}px)`;
      }
      block.classList.add('lc-moving');const conflict=clashes(gesture.times.starts_at,gesture.times.ends_at,item.id);block.classList.toggle('lc-conflict',conflict);status.textContent=`${clock(gesture.times.starts_at)} – ${clock(gesture.times.ends_at)}${conflict ? ' · overlaps another activity' : ''}`;
    };
    block.onpointerup=e=>{
      if(!gesture)return;e.preventDefault();e.stopPropagation();const {moved,times}=gesture;cancel();captureScroll();
      if(!moved){onOpen(item);return;}if(times && (times.starts_at!==item.starts_at || times.ends_at!==item.ends_at))change(item,times);
    };
    block.onpointercancel=cancel;
    block.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();cancel();return;}
      if(e.key==='Enter'){e.preventDefault();if(keyboard){const times=keyboard;cancel();change(item,times);}else{captureScroll();onOpen(item);}return;}
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();const prior=keyboard || item,start=new Date(prior.starts_at);
      if(e.shiftKey && ['ArrowUp','ArrowDown'].includes(e.key)){const end=new Date(prior.ends_at);end.setMinutes(end.getMinutes()+(e.key==='ArrowUp' ? -15 : 15));if(+end<=+start)return;keyboard={starts_at:start.toISOString(),ends_at:end.toISOString()};}
      else{if(e.key==='ArrowLeft' || e.key==='ArrowRight')start.setDate(start.getDate()+(e.key==='ArrowLeft' ? -1 : 1));else start.setMinutes(start.getMinutes()+(e.key==='ArrowUp' ? -15 : 15));keyboard={starts_at:start.toISOString(),ends_at:new Date(+start+Date.parse(prior.ends_at)-Date.parse(prior.starts_at)).toISOString()};}status.textContent=`${clock(keyboard.starts_at)} – ${clock(keyboard.ends_at)}. Enter to save, Escape to cancel.`;
    };
    return block;
  }
  for(const day of days){
    const key=calendarKey(day),head=button('',()=>{state.date=day;heads.querySelectorAll('button').forEach(el=>el.classList.toggle('lc-selected',el.dataset.day===key));},`Select ${day.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}`);head.dataset.day=key;
    head.append(node('small','',day.toLocaleDateString('en-US',{weekday:'short'})),node('strong','',day.getDate()));if(key===today)head.classList.add('lc-today');if(key===calendarKey(current))head.classList.add('lc-selected');heads.append(head);
    const column=node('div','lc-lane');column.dataset.day=key;columns.push(column);selectionLane(column,day);
    for(const entry of calendarLayout(items.filter(item=>item.starts_at),day))directBlock(entry.item,entry,column,day);
    if(key===today){const now=new Date(),line=node('div','lc-now');line.style.top=`${(now.getHours()+now.getMinutes()/60)*LIFE_HOUR_HEIGHT}px`;column.append(line);}grid.append(column);
  }
  const dayViewport=node('div','lc-dayviewport');dayViewport.append(heads);
  canvas.append(grid);viewport.append(canvas);root.append(status,selectionActions,dayViewport,viewport);
  const add=button('+ Time block',()=>{captureScroll();const column=columns.find(el=>el.dataset.day===calendarKey(dayAt(state.date)));column?.selectRange(9*60,10*60);});add.className='lc-add';root.append(add);
  viewport.onscroll=captureScroll;
  const frame=typeof requestAnimationFrame==='function' ? requestAnimationFrame : callback=>callback();
  frame(()=>{viewport.scrollTop=state.scrollTop ?? 8*LIFE_HOUR_HEIGHT;const index=days.findIndex(day=>calendarKey(day)===calendarKey(current));viewport.scrollLeft=state.scrollLeft ?? Math.max(0,index)*columns[0].getBoundingClientRect().width;captureScroll();});
  return root;
}
