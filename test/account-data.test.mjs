import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createAccountDataService} from '../lib/accountData.js';
import {createAccountHandler} from '../api/board.js';

function response(){return {headers:{},statusCode:0,setHeader(name,value){this.headers[name]=value;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};}

test('account export contains safe user data and connected personal spaces',async()=>{
  const service=createAccountDataService({
    account:async()=>({username:'person',email:'person@example.com',signInMethods:['password']}),
    schedule:{list:async()=>[{id:'block'}]},reminders:{list:async()=>[{id:'reminder'}]},
    life:{overview:async()=>({items:[{id:'life'}]})},projects:{list:async()=>[{id:'project'}]},
    now:()=> '2026-10-05T00:00:00.000Z',command:async()=>null,removeAccount:async()=>({deleted:true}),
  });
  const data=await service.exportData('person');
  assert.equal(data.account.username,'person');assert.equal(data.schedule[0].id,'block');assert.equal(data.life.items[0].id,'life');
  assert.doesNotMatch(JSON.stringify(data),/passwordHash|salt/u);
});

test('account deletion requires the signed-in user and exact confirmation',async()=>{
  const service={exportData:async()=>({account:{username:'person'}}),purgeData:async username=>({username,deleted:true})};
  const handler=createAccountHandler({getOwner:async()=>null,getUser:async()=> 'person',service,clearCookie:()=> 'cleared=1'});
  let res=response();await handler({method:'POST',body:{action:'delete',confirmation:'delete'},headers:{}},res);assert.equal(res.statusCode,400);
  res=response();await handler({method:'POST',body:{action:'delete',confirmation:'DELETE MY ACCOUNT'},headers:{}},res);assert.equal(res.statusCode,200);assert.equal(res.body.deleted,true);assert.equal(res.headers['Set-Cookie'],'cleared=1');
});

test('Forge exposes understandable account download and deletion controls',()=>{
  const forge=fs.readFileSync(new URL('../public/forge.html',import.meta.url),'utf8');
  const views=fs.readFileSync(new URL('../public/forge-views.js',import.meta.url),'utf8');
  assert.match(forge,/fetch\('\/api\/account'/u);assert.match(views,/Download my data/u);assert.match(views,/Delete my account/u);
});
