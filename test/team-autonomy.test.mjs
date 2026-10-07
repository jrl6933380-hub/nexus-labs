import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamMissionIndex } from '../lib/teamMissionIndex.js';
import { createTeamSweepHandler } from '../api/team-sweep.js';

const response=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;}});

test('mission index keeps resumable work and removes terminal missions',async()=>{
  const hash=new Map(),command=async([verb,key,field,value])=>{
    if(verb==='HSET'){hash.set(field,value);return 1;}
    if(verb==='HDEL'){hash.delete(field);return 1;}
    if(verb==='HGETALL')return [...hash].flat();
    throw new Error(`Unexpected ${verb} on ${key}`);
  },missions=createTeamMissionIndex({command});
  await missions.track('justin','group-one',{id:'mission-one',state:'queued',updated_at:20});
  await missions.track('justin','group-one',{id:'mission-three',state:'running',updated_at:30});
  await missions.track('justin','group-two',{id:'mission-two',state:'needs_approval',updated_at:10});
  assert.deepEqual((await missions.list()).map(item=>item.run_id),['mission-two','mission-one','mission-three']);
  await missions.track('justin','group-one',{id:'mission-one',state:'completed'});
  assert.deepEqual((await missions.list()).map(item=>item.run_id),['mission-two','mission-three']);
  await missions.remove('justin','group-one','mission-three');
  assert.deepEqual((await missions.list()).map(item=>item.run_id),['mission-two']);
});

test('cron sweep resumes queued missions without an open app and prunes completed work',async()=>{
  const previous=process.env.CRON_SECRET;process.env.CRON_SECRET='test-secret';
  try{
    let run={id:'mission-one',state:'queued'},executed=0;const tracked=[];
    const handler=createTeamSweepHandler({
      missions:{list:async()=>[{owner:'justin',group_id:'group-one',run_id:'mission-one',state:'queued'}],track:async(owner,group,value)=>tracked.push([owner,group,value?.state || null]),remove:async()=>{}},
      runs:{list:async()=>[run]},
      runner:{execute:async()=>{executed++;run={...run,state:'completed'};return true;}},
    });
    const res=response();await handler({method:'GET',headers:{authorization:'Bearer test-secret'}},res);
    assert.equal(res.code,200);assert.equal(executed,1);assert.deepEqual(tracked,[['justin','group-one','completed']]);assert.equal(res.body.missions[0].state,'completed');
  }finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});

test('team sweep is closed when the cron secret is absent or wrong',async()=>{
  const previous=process.env.CRON_SECRET;process.env.CRON_SECRET='right-secret';
  try{const handler=createTeamSweepHandler(),res=response();await handler({method:'GET',headers:{authorization:'Bearer wrong-secret'}},res);assert.equal(res.code,401);}
  finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});
