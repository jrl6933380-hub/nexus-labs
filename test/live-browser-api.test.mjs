import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveBrowserHandler} from '../api/live-browser.js';

const owner={id:'justin',owner:true},customer={id:'c',owner:false};
const PASSWORD='s3cret-pw-12345';
function res(){const r={headers:{},code:200,body:null,setHeader(k,v){r.headers[k]=v;},status(c){r.code=c;return r;},json(b){r.body=b;return r;}};return r;}
const req=(body,extra={})=>({method:'POST',headers:{host:'nexus.test',origin:'https://nexus.test','content-type':'application/json'},body,...extra});
function setup({account=owner,browserOverrides={}}={}){
  const calls=[];
  const browser={
    async status(){return {running:true,url:'https://example.com/',title:'Example',last_action_at:5,pending_login:{platform:'tiktok',at:4},signed_in:{}};},
    async lastShot(){return {shot:'SHOT',url:'https://example.com/',title:'Example',at:5,by:'agent'};},
    async act(user,body,opts){calls.push(['act',user,body,opts]);return {ok:true,url:'https://example.com/',title:'Example',shot:'SHOT2',view:{width:1280,height:720}};},
    async approveLogin(user,input){calls.push(['approve',user,input]);return {submitted:true,platform:input.platform,url:'https://www.tiktok.com/login',title:'Log in'};},
    async close(user){calls.push(['close',user]);return {closed:true,was_running:true};},
    ...browserOverrides,
  };
  const logins={async status(){return {logins:[{platform:'tiktok',username:'me@x.com',has_password:true,updated_at:1,last_revealed_at:null}]};}};
  return {calls,handler:createLiveBrowserHandler({resolveAccount:async()=>account,browser,logins})};
}
const run=async(handler,body,extra)=>{const r=res();await handler(req(body,extra),r);return r;};

test('only the owner may use it, only by POST from this site', async () => {
  const {handler}=setup({account:customer});
  assert.equal((await run(handler,{action:'frame'})).code,403);
  const ok=setup().handler;
  const get=res();await ok({method:'GET',headers:{}},get);assert.equal(get.code,405);
  assert.equal((await run(ok,{action:'frame'},{headers:{host:'nexus.test',origin:'https://evil.test','content-type':'application/json'}})).code,403);
  assert.equal((await run(ok,{action:'frame'},{headers:{host:'nexus.test','sec-fetch-site':'cross-site','content-type':'application/json'}})).code,403);
  assert.equal((await run(ok,{action:'frame'},{headers:{host:'nexus.test','content-type':'text/plain'}})).code,415);
  assert.equal((await run(ok,{action:'frame'})).headers['Cache-Control'],'private, no-store');
});

test('frame returns the live picture and saved logins without any password', async () => {
  const r=await run(setup().handler,{action:'frame'});
  assert.equal(r.code,200);assert.equal(r.body.shot,'SHOT');assert.equal(r.body.shot_by,'agent');
  assert.equal(r.body.pending_login.platform,'tiktok');
  assert.deepEqual(r.body.logins,[{platform:'tiktok',username:'me@x.com',has_password:true}]);
  assert.ok(!JSON.stringify(r.body).includes('password":"'));
});

test('owner taps and typing go through as owner actions', async () => {
  const {handler,calls}=setup();
  const click=await run(handler,{action:'click',x:640,y:360});
  assert.equal(click.code,200);assert.equal(click.body.shot,'SHOT2');assert.equal(click.body.view,undefined);
  assert.deepEqual(calls[0],['act','justin',{action:'click',x:640,y:360},{by:'owner'}]);
  await run(handler,{action:'type',text:'hello'});await run(handler,{action:'press',key:'Enter'});await run(handler,{action:'scroll',dy:-300});await run(handler,{action:'open',url:'https://example.com/x'});
  assert.deepEqual(calls.slice(1).map(c=>c[2].action),['type','press','scroll','open']);
});

test('bad input is refused before the browser is touched', async () => {
  const {handler,calls}=setup();
  for(const body of [{action:'click',x:-1,y:5},{action:'click',x:5,y:900},{action:'click',x:'5',y:5},{action:'type',text:''},{action:'type',text:'x'.repeat(2001)},{action:'press',key:'Enter; rm'},{action:'scroll',dy:99999},{action:'open',url:5},{action:'approve_login',platform:'myspace'},{action:'frame',extra:1},{action:'nope'},[]]){
    assert.equal((await run(handler,body)).code,400,JSON.stringify(body));
  }
  assert.equal(calls.length,0);
});

test('approving a sign-in never returns the password', async () => {
  const {handler,calls}=setup({browserOverrides:{async approveLogin(u,i){return {submitted:true,platform:i.platform,url:'https://www.tiktok.com/login',title:'Log in'};}}});
  const r=await run(handler,{action:'approve_login',platform:'tiktok'});
  assert.equal(r.code,200);assert.equal(r.body.submitted,true);assert.ok(!JSON.stringify(r.body).includes(PASSWORD));
  assert.equal(calls.length,0);
});

test('close works, and errors become clean messages', async () => {
  assert.equal((await run(setup().handler,{action:'close'})).body.closed,true);
  const wrong=setup({browserOverrides:{async approveLogin(){throw Object.assign(new Error('The browser is not on tiktok.com. Open its sign-in page first.'),{status:409,code:'WRONG_PAGE'});}}});
  const r=await run(wrong.handler,{action:'approve_login',platform:'tiktok'});
  assert.equal(r.code,409);assert.equal(r.body.code,'WRONG_PAGE');
  const boom=setup({browserOverrides:{async status(){throw new Error('redis token abc123 leaked');}}});
  const b=await run(boom.handler,{action:'frame'});
  assert.equal(b.code,503);assert.ok(!JSON.stringify(b.body).includes('abc123'));
});
