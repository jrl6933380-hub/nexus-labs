// Match complete planned intervals, not just occupied start times.
export function scheduleStart(day, minutes) {
  const start = new Date(`${day}T00:00:00`);
  start.setMinutes(Number(minutes));
  return start;
}
export function scheduleEnd(day, startMinutes, durationMinutes) {
  return new Date(scheduleStart(day,startMinutes).getTime()+Number(durationMinutes)*60000);
}
export function occupiedStart({days, startMinutes, durationMinutes, items, excludeId = null}) {
  const conflicts = [];
  for (const day of days) {
    const start = scheduleStart(day,startMinutes).getTime();
    const end = start+Number(durationMinutes)*60000;
    for (const item of items) {
      if (item.id === excludeId || (item.status !== 'planned' && item.status !== 'draft')) continue;
      const itemStart = Date.parse(item.starts_at);
      const itemEnd = item.ends_at ? Date.parse(item.ends_at) : itemStart+(item.all_day ? 86400000 : 3600000);
      if (start < itemEnd && end > itemStart) conflicts.push({day,item});
    }
  }
  return conflicts;
}
export function plannedEndLabel(days,startMinutes,durationMinutes) {
  const day=days[0];if(!day)return '';
  const end=scheduleEnd(day,startMinutes,durationMinutes);
  const start=scheduleStart(day,startMinutes);
  return `${end.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}${end.getDate()!==start.getDate() || end.getMonth()!==start.getMonth() ? ' (next day)' : ''}`;
}
export function updateStartOptions(select, input) {
  for(const option of select.options) {
    option.dataset.clock ||= option.textContent;
    const busy=occupiedStart({...input,startMinutes:Number(option.value)}).length>0;
    option.disabled=busy;
    option.textContent=`${option.dataset.clock}${busy ? ' · taken' : ''}`;
  }
  return select.selectedOptions[0]?.disabled || false;
}
