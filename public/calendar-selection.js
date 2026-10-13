function localDay(value){
  if(typeof value==='string'){const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d);}
  const day=new Date(value);day.setHours(0,0,0,0);return day;
}
function at(day,minute){const date=localDay(day);date.setMinutes(minute);return date;}
// Shared with Life: local-day ranges, 15-minute snapping, minimum 15 minutes.
export function calendarSelection(day,anchor,current){
  const a=Math.max(0,Math.min(1425,Math.round(anchor/15)*15)),b=Math.max(0,Math.min(1440,Math.round(current/15)*15));
  const start=Math.min(a,b),end=Math.max(start+15,a,b),date=localDay(day);
  return {day:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,minutes:start,duration:end-start,starts_at:at(day,start).toISOString(),ends_at:at(day,end).toISOString()};
}
export function selectionConflicts(range,items){
  return items.some(item=>!['cancelled','done'].includes(item.status) && Date.parse(item.starts_at)<Date.parse(range.ends_at) && Date.parse(item.ends_at || new Date(Date.parse(item.starts_at)+3600000).toISOString())>Date.parse(range.starts_at));
}
export function attachCalendarSelection({column,day,grid,scroll,items,onCreate}){
  let range=null,preview=null,drawing=null,suppressClickUntil=0;
  const minuteAt=y=>Math.max(0,Math.min(1440,(y-grid.getBoundingClientRect().top)/56*60));
  function clear(){preview?.remove();preview=null;range=null;drawing=null;if(grid.cancelSelection===clear)grid.cancelSelection=null;}
  function paint(){
    if(!range)return;
    preview.style.top=`${range.minutes/60*56}px`;preview.style.height=`${Math.max(28,range.duration/60*56)}px`;
    const clock=value=>new Date(value).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
    const busy=selectionConflicts(range,items);preview.classList.toggle('conflict',busy);
    preview.querySelector('.calselectionlabel').textContent=`${clock(range.starts_at)} – ${clock(range.ends_at)}${busy ? ' · Time taken' : ''}`;
    preview.querySelector('.calselectionadd').disabled=busy;
  }
  function begin(start,end){
    grid.cancelSelection?.();grid.cancelSelection=clear;range=calendarSelection(day,start,end);
    preview=document.createElement('div');preview.className='calselection';
    const label=document.createElement('span');label.className='calselectionlabel';label.setAttribute('role','status');preview.append(label);
    const controls=document.createElement('div');controls.className='calselectioncontrols';preview.append(controls);
    for(const mode of ['Move','Start','Duration']){
      const handle=document.createElement('button');handle.type='button';handle.textContent=mode;handle.setAttribute('aria-label',`${mode} selected time. Drag or use up and down arrows.`);let gesture=null;
      handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);gesture={y:minuteAt(e.clientY),start:range.minutes,duration:range.duration};};
      function adjust(delta,start,duration){
        if(mode==='Move'){const next=Math.max(0,Math.min(1440-duration,start+delta));range=calendarSelection(day,next,next+duration);}
        else if(mode==='Start')range=calendarSelection(day,Math.max(0,Math.min(start+duration-15,start+delta)),start+duration);
        else range=calendarSelection(day,start,Math.max(start+15,Math.min(1440,start+duration+delta)));
        paint();
      }
      handle.onpointermove=e=>{if(!gesture)return;e.preventDefault();e.stopPropagation();adjust(Math.round((minuteAt(e.clientY)-gesture.y)/15)*15,gesture.start,gesture.duration);};
      handle.onpointerup=handle.onpointercancel=()=>{gesture=null;};
      handle.onkeydown=e=>{if(e.key==='Escape'){clear();return;}if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();adjust(e.key==='ArrowUp'?-15:15,range.minutes,range.duration);};
      controls.append(handle);
    }
    const add=document.createElement('button');add.type='button';add.className='calselectionadd';add.textContent='Add details';add.onclick=()=>{if(selectionConflicts(range,items))return;const selected={...range};clear();onCreate(selected);};
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=clear;controls.append(add,cancel);column.append(preview);paint();
  }
  column.selectTime=minutes=>{if(Date.now()<suppressClickUntil)return;begin(minutes,Math.min(1440,minutes+60));};
  // Touch keeps native scrolling. A tap selects; the explicit handles own dragging.
  column.onpointerdown=e=>{
    if(e.pointerType==='touch' || e.button!==0 || !e.target.closest('.calslot:not(:disabled)'))return;
    e.preventDefault();column.setPointerCapture(e.pointerId);const anchor=Math.floor(minuteAt(e.clientY)/15)*15;begin(anchor,anchor+15);drawing={anchor,y:e.clientY,moved:false};
  };
  column.onpointermove=e=>{if(!drawing)return;e.preventDefault();if(Math.abs(e.clientY-drawing.y)<5 && !drawing.moved)return;drawing.moved=true;range=calendarSelection(day,drawing.anchor,minuteAt(e.clientY));paint();};
  column.onpointerup=()=>{if(drawing){suppressClickUntil=drawing.moved ? Date.now()+250 : 0;drawing=null;}};
  column.onpointercancel=clear;
  column.onkeydown=e=>{if(e.key==='Escape')clear();};
}
