import test from 'node:test';import assert from 'node:assert/strict';
import {calendarWithReminders} from '../lib/calendarReminders.js';
import {occupiedStart} from '../public/schedule-availability.js';
import {calendarDayItems} from '../public/calendar-layout.js';
import {openCalendarAt,calendarState} from '../public/calendar-navigation.js';
const timed={id:'r',title:'Take medicine',status:'planned',due_at:'2026-10-15T09:00:00Z'};
test('timed reminders appear once at their alert instant without reserving time; undated and completed stay out',()=>{
 const items=calendarWithReminders([], [timed,{...timed,id:'done',status:'done'},{id:'no-time',status:'planned',due_date:'2026-10-15'}]);
 assert.equal(items.length,1);assert.equal(items[0].calendar_marker,true);assert.equal(items[0].reminder_id,'r');assert.equal(items[0].starts_at,new Date(timed.due_at).toISOString());
 assert.deepEqual(occupiedStart({days:['2026-10-15'],startMinutes:540,durationMinutes:60,items}),[]);
 assert.equal(calendarDayItems(calendarWithReminders([],[{...timed,due_at:new Date(2026,9,15).toISOString()}]),new Date(2026,9,15)).length,1);
});
test('event-backed and same-time reserved reminders use their existing event rather than duplicating it',()=>{
 const event={id:'block',title:'Reserved',starts_at:timed.due_at,status:'planned'};
 const rows=calendarWithReminders([event],[{...timed,schedule_id:'block'},{...timed,id:'calendar-block',source_calendar_id:'block'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].reminder_id,'r');
 const separate=calendarWithReminders([event],[{...timed,schedule_id:'block',due_at:'2026-10-15T08:30:00Z'}]);assert.equal(separate.length,2);assert.equal(separate[0].calendar_marker,true);
});
test('markers follow edited times, disappear on deletion/completion, and obey range/status queries',()=>{
 const query={from:'2026-10-15T00:00:00Z',to:'2026-10-16T00:00:00Z'};
 assert.equal(calendarWithReminders([],[timed],query).length,1);
 assert.equal(calendarWithReminders([],[{...timed,due_at:'2026-10-16T00:00:00Z'}],query).length,0);
 assert.equal(calendarWithReminders([],[timed],{status:'draft'}).length,0);
 assert.equal(calendarWithReminders([],[]).length,0);
});
test('View in Calendar selects the actual local day and scrolls to its time without writing data',()=>{
 const calls=[],date=new Date(2026,9,15,14,30);openCalendarAt({go:view=>calls.push(view)},{starts_at:date.toISOString()});
 assert.equal(calendarState.mode,'day');assert.equal(+calendarState.date,+date);assert.equal(calendarState.timelineScrollTop,13*80);assert.deepEqual(calls,['planner']);
});
