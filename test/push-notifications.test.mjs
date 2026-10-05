import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPushService, duePushNotifications } from '../lib/pushNotifications.js';
import { createPushDeliveryHandler, createPushHandler } from '../api/board.js';

function memoryRedis(){
  const hashes=new Map(),sets=new Map(),strings=new Map();
  const hash=(key)=>{if(!hashes.has(key))hashes.set(key,new Map());return hashes.get(key);};
  const set=(key)=>{if(!sets.has(key))sets.set(key,new Set());return sets.get(key);};
  return async([name,key,...args])=>{
    if(name==='HSET'){hash(key).set(String(args[0]),args[1]);return 1;}
    if(name==='HGETALL')return [...hash(key)].flat();
    if(name==='HDEL')return hash(key).delete(String(args[0]))?1:0;
    if(name==='HLEN')return hash(key).size;
    if(name==='SADD'){set(key).add(args[0]);return 1;}
    if(name==='SREM')return set(key).delete(args[0])?1:0;
    if(name==='SMEMBERS')return [...set(key)];
    if(name==='SET'){
      if(args.includes('NX')&&strings.has(key))return null;
      strings.set(key,args[0]);return 'OK';
    }
    throw new Error(`Unexpected command ${name}`);
  };
}

function response(){return {statusCode:0,body:null,headers:{},setHeader(name,value){this.headers[name]=value;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};}

test('due push notifications include timed reminders, starts, and optional block endings',()=>{
  const now=Date.parse('2026-10-05T15:00:00Z');
  const reminders=[{id:'r1',title:'Call Mom',due_at:'2026-10-05T15:00:00Z',status:'planned'}];
  const schedule=[
    {id:'s1',title:'Work',starts_at:'2026-10-05T15:10:00Z',ends_at:'2026-10-05T16:00:00Z',status:'planned',reminder_minutes:10,end_reminder:false},
    {id:'s2',title:'Gym',starts_at:'2026-10-05T14:00:00Z',ends_at:'2026-10-05T15:00:00Z',status:'planned',reminder_minutes:null,end_reminder:true},
  ];
  const due=duePushNotifications({reminders,schedule,now});
  assert.deepEqual(due.map(item=>item.body),['Call Mom','Work','Gym can keep going, or Nex can adjust what comes next.']);
  assert.deepEqual(due.map(item=>item.url),['/workspace.html?view=reminders','/workspace.html?view=planner','/workspace.html?view=planner']);
});

test('push subscriptions deliver once across repeated cron passes',async()=>{
  const command=memoryRedis(),sent=[];
  const service=createPushService({command,env:{VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private',VAPID_SUBJECT:'mailto:test@example.com'},now:()=>Date.parse('2026-10-05T15:00:00Z'),reminders:{list:async()=>[{id:'r1',title:'Call Mom',due_at:'2026-10-05T15:00:00Z',status:'planned'}]},planner:{list:async()=>[]},sender:{setVapidDetails(){},async sendNotification(subscription,payload){sent.push([subscription,JSON.parse(payload)]);}}});
  await service.subscribe('owner:justin',{endpoint:'https://fcm.googleapis.com/device',keys:{p256dh:'key',auth:'auth'}});
  assert.equal((await service.status('owner:justin')).enabled,true);
  assert.equal((await service.deliverAll()).sent,1);
  assert.equal((await service.deliverAll()).sent,0);
  assert.equal(sent.length,1);
});

test('push API requires an account and delivery requires the cron secret',async()=>{
  const denied=response();await createPushHandler({getOwner:async()=>null,getUser:async()=>null,service:{}})({method:'GET',headers:{}},denied);assert.equal(denied.statusCode,401);
  const service={status:async()=>({configured:true,enabled:false,publicKey:'public'}),deliverAll:async()=>({sent:2})};
  const allowed=response();await createPushHandler({getOwner:async()=>({id:'justin'}),service})({method:'GET',headers:{}},allowed);assert.equal(allowed.statusCode,200);assert.equal(allowed.body.publicKey,'public');
  const cronDenied=response();await createPushDeliveryHandler({authorized:()=>false,service})({method:'GET',headers:{}},cronDenied);assert.equal(cronDenied.statusCode,401);
  const cronAllowed=response();await createPushDeliveryHandler({authorized:()=>true,service})({method:'GET',headers:{}},cronAllowed);assert.deepEqual(cronAllowed.body,{sent:2});
});

test('service worker and Messages expose background phone alerts',()=>{
  const worker=fs.readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8');
  const messages=fs.readFileSync(new URL('../public/nexus-messages.js',import.meta.url),'utf8');
  const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.match(worker,/addEventListener\('push'/u);
  assert.match(worker,/addEventListener\('notificationclick'/u);
  assert.match(messages,/Turn on notifications/u);
  assert.ok(config.crons.some(item=>item.path==='/api/push-deliver'));
});

 test('push subscriptions reject arbitrary destinations before storing them',async()=>{
  const commands=[],service=createPushService({command:async c=>{commands.push(c);return 1;}});
  for(const endpoint of ['https://127.0.0.1/push','https://attacker.example/push','https://fcm.googleapis.com.attacker.example/push','https://fcm.googleapis.com:444/push']){
    await assert.rejects(()=>service.subscribe('room:person',{endpoint,keys:{p256dh:'key',auth:'auth'}}),/enable notifications/u);
  }
  assert.equal(commands.length,0);
 });
