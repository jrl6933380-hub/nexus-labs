export function calendarKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function dayStart(date) { const copy = new Date(date); copy.setHours(0,0,0,0); return copy; }
export function shift(date,days) { const copy = dayStart(date); copy.setDate(copy.getDate()+days); return copy; }
export function endOf(item) { return item.ends_at ? new Date(item.ends_at) : new Date(Date.parse(item.starts_at)+(item.all_day ? 86400000 : 3600000)); }
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
