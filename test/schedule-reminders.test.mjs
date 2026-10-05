import test from 'node:test';
import assert from 'node:assert/strict';
import {dueScheduleReminders} from '../public/schedule-reminders.js';
const item={id:'focus',status:'planned',starts_at:'2026-10-05T09:00:00Z',ends_at:'2026-10-05T10:00:00Z',end_reminder:true};
test('time-up reminders are opt-in and ignore unfinished drafts and completed activities',()=>{
  const now=Date.parse(item.ends_at);
  assert.equal(dueScheduleReminders([item],now-1).length,0);
  assert.equal(dueScheduleReminders([item],now)[0].kind,'end');
  for(const change of [{end_reminder:false},{all_day:true},{status:'draft'},{status:'done'}])assert.equal(dueScheduleReminders([{...item,...change}],now).length,0);
});
test('reminder deduplication follows planned end changes and avoids stale alerts',()=>{
  const now=Date.parse(item.ends_at), cue=dueScheduleReminders([item],now)[0];
  const delivered=new Set([cue.key]);assert.equal(dueScheduleReminders([item],now,delivered).length,0);
  const extended={...item,ends_at:'2026-10-05T10:30:00Z'};
  assert.equal(dueScheduleReminders([extended],now,delivered).length,0);
  assert.equal(dueScheduleReminders([extended],Date.parse(extended.ends_at),delivered).length,1);
  assert.equal(dueScheduleReminders([item],now+3600001).length,0);
});
test('before-start reminders continue independently of the time-up option',()=>{
  const scheduled={...item,end_reminder:false,reminder_minutes:10};
  assert.equal(dueScheduleReminders([scheduled],Date.parse(item.starts_at)-600000)[0].kind,'start');
});
