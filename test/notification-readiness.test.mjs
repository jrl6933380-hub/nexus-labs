import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationRegistration,notificationError} from '../public/push-notifications.js';

test('active notification registration does not wait on a stalled ready promise',async()=>{
 const active={active:{},pushManager:{}};
 const result=await notificationRegistration({getRegistration:async()=>active,ready:new Promise(()=>{}),register:()=>{throw Error('Already active');}},10);
 assert.equal(result,active);
});
test('missing registration is explicitly registered before awaiting readiness',async()=>{
 const calls=[],ready={active:{}};
 const result=await notificationRegistration({getRegistration:async()=>null,register:async(url,options)=>{calls.push([url,options]);return {};},ready:Promise.resolve(ready)},10);
 assert.equal(result,ready);assert.deepEqual(calls,[['/service-worker.js',{scope:'/'}]]);
});
test('a stalled phone service fails with retry guidance instead of hanging',async()=>{
 await assert.rejects(()=>notificationRegistration({getRegistration:async()=>null,register:async()=>({}),ready:new Promise(()=>{})},10),error=>{
  assert.equal(error.code,'worker-timeout');assert.match(notificationError(error),/Home Screen/);return true;
 });
});
test('registration failures and expired sessions have clear notification instructions',async()=>{
 await assert.rejects(()=>notificationRegistration({getRegistration:async()=>null,register:async()=>{throw new Error('internal browser details');}},10),error=>error.code==='worker-unavailable');
 assert.match(notificationError({status:401}),/sign in again/);
 assert.match(notificationError({code:'network-timeout'}),/Try again/);
 assert.match(notificationError({code:'permission-denied'}),/phone notification settings/);
 assert.doesNotMatch(notificationError(new Error('secret internal details')),/secret|internal/);
});
