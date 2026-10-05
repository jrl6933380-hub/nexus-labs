// In-app cues only; they never infer whether an activity actually finished.
export function dueScheduleReminders(items, now = Date.now(), delivered = new Set()) {
  const due = [];
  for (const item of items) {
    if (item.status !== 'planned') continue;
    const start = Date.parse(item.starts_at), end = item.ends_at ? Date.parse(item.ends_at) : start + 3600000;
    const endDue = item.end_reminder && !item.all_day && now >= end && now <= end + 3600000;
    const startDue = item.reminder_minutes != null && now >= start - Number(item.reminder_minutes) * 60000 && now <= start + 300000;
    const kind = endDue ? 'end' : startDue ? 'start' : null;
    if (!kind) continue;
    const key = `${item.id}:${kind}:${kind === 'end' ? end : start}`;
    if (!delivered.has(key)) due.push({ item, kind, key, start, end });
  }
  return due;
}
