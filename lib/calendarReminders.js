// Read-only Calendar projections. Reminder markers never reserve time or
// become new Planner records, so there is no reciprocal creation loop.
export function calendarWithReminders(events,reminders,query={}){
 const byBlock=new Map(reminders.filter(item=>item.schedule_id).map(item=>[item.schedule_id,item]));
 const items=events.map(event=>{const reminder=byBlock.get(event.id);return reminder ? {...event,reminder_id:reminder.id,calendar_linked_reminder:true} : event;});
 for(const reminder of reminders){
  if(reminder.status==='done' || !reminder.due_at || reminder.source_calendar_id)continue;
  if(reminder.schedule_id && events.some(event=>event.id===reminder.schedule_id && Date.parse(event.starts_at)===Date.parse(reminder.due_at)))continue;
  const starts=Date.parse(reminder.due_at);if(!Number.isFinite(starts))continue;
  if(query.status && query.status!=='planned')continue;
  if(query.from && starts<Date.parse(query.from) || query.to && starts>=Date.parse(query.to))continue;
  items.push({id:`reminder-marker-${reminder.id}`,title:reminder.title,notes:reminder.notes || '',starts_at:new Date(starts).toISOString(),ends_at:new Date(starts+1).toISOString(),status:'planned',kind:'reminder',category:'other',calendar_marker:true,reminder_id:reminder.id,reminder_minutes:null,end_reminder:false,created_at:reminder.created_at,updated_at:reminder.updated_at});
 }
 return items.sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
}
