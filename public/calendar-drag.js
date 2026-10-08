const pixelsPerHour=56;
function localDay(value){
  if(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)){
    const [year,month,day]=value.split('-').map(Number);return new Date(year,month-1,day);
  }
  return new Date(value);
}
function dayKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
// Preserve elapsed duration when moving. Resize only changes the planned finish.
export function calendarDragTimes(item,{day,minutes,resize=false}){
  const start=new Date(item.starts_at),end=new Date(item.ends_at),target=localDay(day);
  target.setHours(0,0,0,0);target.setMinutes(Math.round(minutes/15)*15);
  if(resize){
    if(+target<=+start || +target-+start>48*3600000)throw new Error('Choose a finish after the start, within 48 hours.');
    return {starts_at:start.toISOString(),ends_at:target.toISOString()};
  }
  return {starts_at:target.toISOString(),ends_at:new Date(+target+(+end-+start)).toISOString()};
}

export function attachCalendarDrag({event,item,day,entry,columns,grid,scroll,onChange,onError}){
  const controls=document.createElement('div');controls.className='caldragcontrols';
  for(const resize of [false,true]){
    const handle=document.createElement('button');handle.type='button';
    const label=resize ? '↕ Duration' : '⠿ Move';handle.textContent=label;
    handle.setAttribute('aria-label',`${resize ? 'Resize' : 'Move'} ${item.title}. Drag, or use arrow keys then Enter.`);
    let gesture=null,keyboard=null;
    function proposal(x,y){
      const target=columns.find(column=>{const rect=column.getBoundingClientRect();return x>=rect.left && x<=rect.right;}) || event.parentElement;
      const minutes=Math.max(0,Math.min(1440,(y-grid.getBoundingClientRect().top)/pixelsPerHour*60-gesture.offset));
      return calendarDragTimes(item,{day:target.getAttribute('data-day') || day,minutes,resize});
    }
    function preview(times){
      if(gesture && event.style){
        if(resize){
          const midnight=localDay(day);midnight.setHours(0,0,0,0);
          const endMinutes=(Date.parse(times.ends_at)-midnight)/60000;
          event.style.height=`${Math.max(20,(endMinutes-entry.start)/60*pixelsPerHour)}px`;
        }else{
          const start=new Date(times.starts_at),target=columns.find(column=>column.getAttribute('data-day')===dayKey(start));
          const horizontal=target ? target.getBoundingClientRect().left-event.parentElement.getBoundingClientRect().left : 0;
          event.style.transform=`translate(${horizontal}px,${(start.getHours()*60+start.getMinutes()-entry.start)/60*pixelsPerHour}px)`;
        }
      }
      event.classList.add('caldragging');
      handle.textContent=new Date(resize ? times.ends_at : times.starts_at).toLocaleString('en-US',{weekday:'short',hour:'numeric',minute:'2-digit'});
    }
    function clear(){
      if(gesture && event.style){event.style.transform=gesture.transform;event.style.height=gesture.height;}
      event.classList.remove('caldragging');handle.textContent=label;gesture=null;keyboard=null;
    }
    async function commit(times){
      clear();handle.disabled=true;
      try{await onChange(item,times);}catch(error){onError(error);}finally{handle.disabled=false;}
    }
    handle.onpointerdown=e=>{
      if(e.button!==0 || handle.disabled)return;
      e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);
      const midnight=localDay(day);midnight.setHours(0,0,0,0);
      const anchor=resize ? (Date.parse(item.ends_at)-midnight)/60000 : entry.start;
      gesture={transform:event.style?.transform || '',height:event.style?.height || '',offset:(e.clientY-grid.getBoundingClientRect().top)/pixelsPerHour*60-anchor,moved:false,times:null};
    };
    handle.onpointermove=e=>{
      if(!gesture)return;e.preventDefault();
      if(scroll){const bounds=scroll.getBoundingClientRect();if(e.clientY<bounds.top+35)scroll.scrollTop-=12;else if(e.clientY>bounds.bottom-35)scroll.scrollTop+=12;}
      try{gesture.times=proposal(e.clientX,e.clientY);gesture.moved=true;preview(gesture.times);}catch(error){gesture.times=null;handle.textContent=error.message;}
    };
    handle.onpointerup=e=>{
      if(!gesture)return;e.stopPropagation();const {times,moved}=gesture;clear();if(moved && times)commit(times);
    };
    handle.onpointercancel=clear;
    handle.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();clear();return;}
      if(e.key==='Enter' && keyboard){e.preventDefault();commit(keyboard);return;}
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();e.stopPropagation();
      const current=new Date(keyboard ? resize ? keyboard.ends_at : keyboard.starts_at : resize ? item.ends_at : item.starts_at);
      if(e.key==='ArrowLeft' || e.key==='ArrowRight')current.setDate(current.getDate()+(e.key==='ArrowLeft' ? -1 : 1));
      else current.setMinutes(current.getMinutes()+(e.key==='ArrowUp' ? -15 : 15));
      try{keyboard=calendarDragTimes(item,{day:current,minutes:current.getHours()*60+current.getMinutes(),resize});preview(keyboard);}catch(error){onError(error);}
    };
    controls.append(handle);
  }
  const actions=event.querySelector('.calactivityactions');if(actions)actions.prepend(controls);
}
