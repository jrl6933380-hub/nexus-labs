import test from 'node:test';
import assert from 'node:assert/strict';
import {journalWeek} from '../public/life-journal.js';
import {calendarDragTimes,attachCalendarDrag} from '../public/calendar-drag.js';
const start=new Date(2026,9,5,9),item={id:'walk',title:'Walk',kind:'activity',pillar:'health',starts_at:start.toISOString(),ends_at:new Date(+start+3600000).toISOString(),outcome:'unknown'};
test('weekly journal clips overnight times and never counts planned activities as actual',()=>{
  const sunday=new Date(2026,9,4,23),monday=new Date(2026,9,5,7);
  const week=journalWeek([item,{...item,pillar:'sleep',starts_at:sunday.toISOString(),ends_at:monday.toISOString(),outcome:'happened',actual_starts_at:sunday.toISOString(),actual_ends_at:monday.toISOString(),energy:4}],start);
  assert.equal(week.confirmed,1);assert.equal(week.unknown,1);assert.equal(week.energy,4);
  assert.equal(week.pillars.find(p=>p.pillar==='sleep').actual,7);assert.equal(week.pillars.find(p=>p.pillar==='health').actual,0);
});
test('weekly journal includes actual experience moved outside its original planned week',()=>{
  const actual=new Date(2026,9,12,9);const week=journalWeek([{...item,outcome:'happened',actual_starts_at:actual.toISOString(),actual_ends_at:new Date(+actual+3600000).toISOString()}],actual);
  assert.equal(week.activities.length,1);assert.equal(week.pillars.find(p=>p.pillar==='health').planned,0);assert.equal(week.pillars.find(p=>p.pillar==='health').actual,1);
});
test('drag snaps to fifteen minutes, moves across days preserving duration, and resize preserves start',()=>{
  const day=new Date(2026,9,6);const moved=calendarDragTimes(item,{day,minutes:618});assert.equal(new Date(moved.starts_at).getDate(),6);assert.equal(new Date(moved.starts_at).getMinutes(),15);assert.equal(Date.parse(moved.ends_at)-Date.parse(moved.starts_at),3600000);
  const resized=calendarDragTimes(item,{day:start,minutes:660,resize:true});assert.equal(resized.starts_at,item.starts_at);assert.equal(new Date(resized.ends_at).getHours(),11);
  assert.throws(()=>calendarDragTimes(item,{day:start,minutes:540,resize:true}),/after the start/);
});
function element(){return {children:[],className:'',setAttribute(){},append(...nodes){this.children.push(...nodes);},setPointerCapture(){}};}
test('touch drag commits once, cancellation saves nothing, keyboard supports preview then Enter',async()=>{
  const oldDocument=globalThis.document;globalThis.document={createElement:element};
  try{
    const controls={prepend(node){this.node=node;}},column={getBoundingClientRect:()=>({left:0,right:200}),getAttribute:()=> '2026-10-05'},grid={getBoundingClientRect:()=>({top:0})};
    const block={parentElement:column,classList:{add(){},remove(){}},querySelector:()=>controls},changes=[];
    attachCalendarDrag({event:block,item,day:start,entry:{start:540,end:600},columns:[column],grid,onChange:async(_item,times)=>changes.push(times),onError:error=>{throw error;}});
    const [move,resize]=controls.node.children,e=(y)=>({button:0,pointerId:1,clientX:100,clientY:y,preventDefault(){},stopPropagation(){}});
    move.onpointerdown(e(510));move.onpointermove(e(566));move.onpointerup(e(566));await Promise.resolve();assert.equal(changes.length,1);assert.equal(new Date(changes[0].starts_at).getHours(),10);
    move.onpointerdown(e(510));move.onpointermove(e(600));move.onpointercancel();move.onpointerup(e(600));assert.equal(changes.length,1);
    resize.onkeydown({...e(0),key:'ArrowDown'});assert.equal(changes.length,1);resize.onkeydown({...e(0),key:'Enter'});await Promise.resolve();assert.equal(changes.length,2);assert.equal(new Date(changes[1].ends_at).getMinutes(),15);
  }finally{globalThis.document=oldDocument;}
});

import {lifeSelection,lifeMovedTimes} from '../public/life-calendar.js';
test('drawing time before entering details supports reversed ranges and local midnight',()=>{
  const range=lifeSelection('2026-10-08',600,525);assert.equal(range.minutes,525);assert.equal(range.duration,75);assert.equal(new Date(range.starts_at).getDate(),8);assert.equal(new Date(range.starts_at).getHours(),8);
  const late=lifeSelection('2026-10-08',1410,1440);assert.equal(late.duration,30);assert.equal(new Date(late.ends_at).getDate(),9);
  assert.equal(lifeSelection('2026-10-08',540,540).duration,15);
});
test('direct dragging preserves duration and the hidden portion of overnight blocks',()=>{
  const original=new Date(2026,9,7,23),record={starts_at:original.toISOString(),ends_at:new Date(+original+8*3600000).toISOString()};
  const moved=lifeMovedTimes(record,'2026-10-08','2026-10-09',30,0);assert.equal(new Date(moved.starts_at).getDate(),8);assert.equal(new Date(moved.starts_at).getHours(),23);assert.equal(new Date(moved.starts_at).getMinutes(),30);assert.equal(Date.parse(moved.ends_at)-Date.parse(moved.starts_at),8*3600000);
});
