import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleStart,scheduleEnd,occupiedStart,plannedEndLabel,updateStartOptions} from '../public/schedule-availability.js';
const day='2026-10-05';
const work={id:'work',title:'Work',status:'planned',starts_at:scheduleStart(day,540).toISOString(),ends_at:scheduleEnd(day,540,480).toISOString()};
test('planned end comes from start plus duration, including overnight',()=>{
  assert.equal(plannedEndLabel([day],540,480),'5:00 PM');
  assert.equal(plannedEndLabel([day],1380,120),'1:00 AM (next day)');
});
test('occupied times check the entire new duration and allow starts exactly at a prior end',()=>{
  const check=(startMinutes,durationMinutes)=>occupiedStart({days:[day],startMinutes,durationMinutes,items:[work]});
  assert.equal(check(480,60).length,0);
  assert.equal(check(480,120).length,1);
  assert.equal(check(960,60).length,1);
  assert.equal(check(1020,60).length,0);
});
test('availability stays scoped to selected days and ignores cancelled/done records',()=>{
  const params={days:['2026-10-06'],startMinutes:540,durationMinutes:60,items:[work]};
  assert.equal(occupiedStart(params).length,0);
  assert.equal(occupiedStart({...params,days:[day,'2026-10-06']}).length,1);
  for(const status of ['done','cancelled'])assert.equal(occupiedStart({...params,days:[day],items:[{...work,status}]}).length,0);
  assert.equal(occupiedStart({...params,days:[day],excludeId:work.id}).length,0);
});
test('night shifts reserve the occupied portion of the following day',()=>{
  const overnight={...work,starts_at:scheduleStart(day,1380).toISOString(),ends_at:scheduleEnd(day,1380,120).toISOString()};
  assert.equal(occupiedStart({days:['2026-10-06'],startMinutes:30,durationMinutes:30,items:[overnight]}).length,1);
  assert.equal(occupiedStart({days:['2026-10-06'],startMinutes:60,durationMinutes:30,items:[overnight]}).length,0);
});
test('taken dropdown options disable and re-enable when a duration or reservation changes',()=>{
  const select={options:[{value:'480',textContent:'8:00 AM',dataset:{}},{value:'540',textContent:'9:00 AM',dataset:{}},{value:'1020',textContent:'5:00 PM',dataset:{}}]};
  select.selectedOptions=[select.options[1]];
  const params={days:[day],durationMinutes:120,items:[work]};
  assert.equal(updateStartOptions(select,params),true);
  assert.equal(select.options[0].disabled,true);assert.equal(select.options[2].disabled,false);
  assert.equal(select.options[1].textContent,'9:00 AM · taken');
  updateStartOptions(select,{...params,items:[]});assert.equal(select.options[1].disabled,false);assert.equal(select.options[1].textContent,'9:00 AM');
});
