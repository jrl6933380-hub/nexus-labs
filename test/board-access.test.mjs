import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardAccessGuard} from '../lib/boardAccess.js';
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(body){this.body=body;return this;}});
const request=(body={},headers={})=>({method:'POST',headers:{host:'nexus.test','content-type':'application/json',...headers},body});
const guard=(owner=null,internal=false)=>createBoardAccessGuard({getOwner:async()=>owner,agentAuthorized:()=>internal});
test('anonymous dashboard reads, task lookup and writes are rejected',async()=>{
 for(const req of [{method:'GET',query:{view:'dashboard'}},{method:'GET',query:{task_id:'a'}},request({action:'add_note'}),request({action:'claim_task'})]){
  const res=response();assert.equal(await guard()(req,res),null);assert.equal(res.code,401);assert.equal(res.headers['Cache-Control'],'private, no-store');
 }
});
test('owner session reads and same-origin JSON mutations work',async()=>{
 for(const req of [{method:'GET'},request({action:'add_note',from:'spoofed'},{origin:'https://nexus.test'})]){
  const res=response(),access=await guard({id:'justin'})(req,res);assert.equal(access.owner.id,'justin');assert.equal(res.code,200);
 }
});
test('trusted agents can claim tasks but cannot author owner notes',async()=>{
 assert.equal((await guard(null,true)(request({action:'claim_task'}),response())).internal,true);
 const res=response();assert.equal(await guard(null,true)(request({action:'add_note'}),res),null);assert.equal(res.code,403);
});
test('browser cross-site and non-JSON writes fail before execution',async()=>{
 for(const [headers,code] of [[{origin:'https://evil.test'},403],[{'sec-fetch-site':'cross-site'},403],[{origin:'null'},403],[{'content-type':'text/plain'},415]]){
  const res=response();assert.equal(await guard({id:'justin'})(request({action:'create_task'},headers),res),null);assert.equal(res.code,code);
 }
});
test('an owner lookup failure does not open access or disable valid agent auth',async()=>{
 const g=createBoardAccessGuard({getOwner:async()=>{throw Error('bad session');},agentAuthorized:()=>false});const res=response();assert.equal(await g({method:'GET'},res),null);assert.equal(res.code,401);
});
