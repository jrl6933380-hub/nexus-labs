import test from 'node:test';
import assert from 'node:assert/strict';
import {podAvailability,assertPodAvailable} from '../lib/podAvailability.js';
import {routeMessage} from '../lib/modelRouter.js';
import {generatedEventNotes} from '../lib/eventNotes.js';
import {recapDate} from '../public/life-journal.js';
const env={NEX_QWEN_ONLY:'true',NEX_POD_REST_START:'22:00',NEX_POD_REST_END:'08:00',NEX_POD_SCHEDULE_TIMEZONE:'America/Chicago'};
test('scheduled rest distinguishes active hours and handles overnight boundaries',()=>{
 const rest=podAvailability({env,now:Date.parse('2026-10-14T03:30:00Z')});assert.equal(rest.resting,true);assert.equal(rest.resumeAt,Date.parse('2026-10-14T13:00:00Z'));assert.match(rest.message,/resting, back at 8:00 AM CDT/);
 assert.equal(podAvailability({env,now:rest.resumeAt}).resting,false);
 assert.equal(podAvailability({env:{},now:rest.resumeAt}).state,'unscheduled');
});
test('rest boundaries are timezone-aware across spring DST',()=>{
 const rest=podAvailability({env,now:Date.parse('2026-03-08T06:00:00Z')});assert.equal(rest.resumeAt,Date.parse('2026-03-08T13:00:00Z'));
});
test('scheduled rest blocks provider routing before any fetch or retry',async()=>{
 const fixed={...env,NEX_POD_REST_START:'00:00',NEX_POD_REST_END:'23:59',NEX_POD_SCHEDULE_TIMEZONE:'UTC'};
 if(new Date().getUTCHours()===23 && new Date().getUTCMinutes()===59)fixed.NEX_POD_REST_START='23:58',fixed.NEX_POD_REST_END='00:01';
 let calls=0;await assert.rejects(routeMessage({env:fixed,body:{messages:[]},fetchFn:async()=>{calls++;throw Error('must not call');}}),error=>error.code==='POD_RESTING');assert.equal(calls,0);
});
test('generated notes retain useful content while dropping standalone timing metadata',()=>{
 assert.equal(generatedEventNotes('Time: 11:30 AM – 12:30 PM\nTimezone: America/Chicago\nBring a towel.\nArrive 10 minutes early.'),'Bring a towel.\nArrive 10 minutes early.');
});
test('Monday recap defaults to previous week without moving Tuesday or Sunday',()=>{
 const monday=new Date(2026,9,12,9);assert.equal(recapDate(monday).getDate(),5);assert.equal(recapDate(new Date(2026,9,13)).getDate(),13);assert.equal(recapDate(new Date(2026,9,11)).getDate(),11);assert.equal(monday.getDate(),12);
});
