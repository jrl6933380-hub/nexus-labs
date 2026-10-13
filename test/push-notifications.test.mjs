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
    if(name==='GET')return strings.get(key) || null;
    if(name==='EVAL'){const receipt=args[1],claim=args[2];if(strings.get(receipt)!==claim)return 0;if(key.includes("'DEL'"))return strings.delete(receipt)?1:0;strings.set(receipt,'sent');return 'OK';}
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
  const service=createPushService({command,life:{notificationItems:async()=>[]},env:{VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private',VAPID_SUBJECT:'mailto:test@example.com'},now:()=>Date.parse('2026-10-05T15:00:00Z'),reminders:{list:async()=>[{id:'r1',title:'Call Mom',due_at:'2026-10-05T15:00:00Z',status:'planned'}]},planner:{list:async()=>[]},sender:{setVapidDetails(){},async sendNotification(subscription,payload){sent.push([subscription,JSON.parse(payload)]);}}});
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


test('saved alerts reach Apple and Android next day without an open app; only failed devices retry',async()=>{
  const command=memoryRedis(),sent=[],attempts=[];
  let clock=Date.parse('2026-10-05T12:00:00Z'),failApple=true;
  const due='2026-10-06T15:00:00Z';
  const service=createPushService({command,env:{VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private',VAPID_SUBJECT:'mailto:test@example.com'},now:()=>clock,
    reminders:{list:async user=>user==='owner:a'?[{id:'r',title:'Tomorrow reminder',due_at:due,status:'planned'}]:[]},
    planner:{list:async()=>[{id:'s',title:'Tomorrow calendar',starts_at:due,ends_at:'2026-10-06T16:00:00Z',status:'planned',reminder_minutes:0}]},
    life:{notificationItems:async()=>[{id:'l',kind:'reminder',title:'Tomorrow Life',due_at:due,status:'planned'}]},
    sender:{setVapidDetails(){},async sendNotification(subscription,payload,options){attempts.push(subscription.endpoint);assert.equal(options.TTL,86400);if(subscription.endpoint.includes('apple')&&failApple)throw Object.assign(new Error('Temporary outage'),{statusCode:503});sent.push([subscription.endpoint,JSON.parse(payload)]);}}});
  for(const endpoint of ['https://web.push.apple.com/device','https://fcm.googleapis.com/device'])await service.subscribe('owner:a',{endpoint,keys:{p256dh:'key',auth:'auth'}});
  assert.equal((await service.deliverAll()).sent,0);
  clock=Date.parse(due);assert.equal((await service.deliverAll()).sent,3);
  failApple=false;clock+=60000;assert.equal((await service.deliverAll()).sent,3);
  assert.equal((await service.deliverAll()).sent,0);
  assert.equal(sent.length,6);assert.equal(attempts.filter(x=>x.includes('googleapis')).length,3);
  assert.deepEqual(new Set(sent.map(x=>x[1].url)),new Set(['/workspace.html?view=reminders','/workspace.html?view=planner','/workspace.html?view=life']));
});

test('Life independent and linked alerts avoid duplicates and respect completion, edits, and catch-up',()=>{
  const now=Date.parse('2026-10-06T15:00:00Z'),due='2026-10-06T14:00:00Z';
  const schedule=[{id:'life-a',source:'life',status:'planned',title:'Linked activity',starts_at:due,ends_at:due,reminder_minutes:0,end_reminder:true}];
  const reminders=[{id:'life-r',title:'Linked reminder',due_at:due,status:'planned'}];
  const life=[{id:'a',kind:'activity',link:{kind:'activity',id:'life-a'},status:'planned',starts_at:due,ends_at:due,reminder_minutes:0,end_reminder:true},
    {id:'r',kind:'reminder',link:{kind:'reminder',id:'life-r'},due_at:due,status:'planned'},
    {id:'own',kind:'activity',title:'Own activity',status:'planned',starts_at:due,ends_at:due,reminder_minutes:0,end_reminder:true},
    {id:'done',kind:'reminder',status:'done',due_at:due},
    {id:'later',kind:'reminder',status:'planned',due_at:'2026-10-07T15:00:00Z'}];
  const notifications=duePushNotifications({schedule,reminders,life,now});
  assert.equal(notifications.length,5);assert.ok(notifications.every(x=>x.url==='/workspace.html?view=life'));
  assert.equal(duePushNotifications({life:[life[4]],now}).length,0);
  assert.equal(duePushNotifications({reminders:[{...reminders[0],due_at:'2026-10-05T13:00:00Z'}],now}).length,0);
});

test('concurrent cron passes send each device once and expired endpoints are removed',async()=>{
  const command=memoryRedis();let sends=0;
  const service=createPushService({command,env:{VAPID_PUBLIC_KEY:'p',VAPID_PRIVATE_KEY:'p',VAPID_SUBJECT:'mailto:test@example.com'},now:()=>Date.parse('2026-10-06T15:00:00Z'),
    reminders:{list:async()=>[{id:'r',title:'R',due_at:'2026-10-06T15:00:00Z'}]},planner:{list:async()=>[]},life:{notificationItems:async()=>[]},
    sender:{setVapidDetails(){},async sendNotification(subscription){sends++;if(subscription.endpoint.endsWith('expired'))throw Object.assign(new Error('Expired'),{statusCode:410});}}});
  for(const endpoint of ['https://fcm.googleapis.com/device','https://web.push.apple.com/expired'])await service.subscribe('owner:a',{endpoint,keys:{p256dh:'k',auth:'a'}});
  await Promise.all([service.deliverAll(),service.deliverAll()]);assert.equal(sends,2);
  assert.equal((await service.deliverAll()).sent,0);assert.equal((await service.status('owner:a')).enabled,true);
});


test('Calendar-backed reminder sends once; snoozed or completed reminder suppresses the calendar duplicate',()=>{
 const now=Date.parse('2026-10-15T11:30:00Z'),event={id:'a',title:'Workout',status:'planned',starts_at:'2026-10-15T12:00:00Z',reminder_minutes:30};
 const reminder={id:'calendar-a',source_calendar_id:'a',title:'Workout',due_at:'2026-10-15T11:30:00Z',status:'planned'};
 const due=duePushNotifications({reminders:[reminder],schedule:[event],now});assert.equal(due.length,1);assert.equal(due[0].tag,'nexus-reminder-calendar-a');
 assert.equal(duePushNotifications({reminders:[{...reminder,status:'done'}],schedule:[event],now}).length,0);
 assert.equal(duePushNotifications({reminders:[{...reminder,due_at:'2026-10-15T11:45:00Z'}],schedule:[event],now}).length,0);
});
