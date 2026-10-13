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
