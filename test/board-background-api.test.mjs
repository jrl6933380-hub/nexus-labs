import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexusLabHandler} from '../api/nexus-lab.js';
const request=(action,input={},extra={})=>({method:'POST',headers:{host:'nexus.test',origin:'https://nexus.test','content-type':'application/json',...extra},body:{action,input,request_id:'bg-import-1'}});
async function call(handler,req){const res={setHeader(){return this;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};await handler(req,res);return res;}
test('background lookup and import preserve owner scope, photo restriction, and attribution',async()=>{
  const calls=[],owner={id:'owner-bg'};
  const handler=createNexusLabHandler({authenticate:async()=>owner,
    stockSearch:async input=>{calls.push(input);return {candidates:[]};},
    stockImport:async input=>{calls.push(input);return {media_id:'med-bg0001',credit:'Photo by Jane',license:'CC BY',source_url:'https://example.org/photo'};},
    assets:{adopt:async(o,input)=>{assert.equal(o,owner);calls.push(input);return {media_id:input.media_id,provenance:input.provenance};}},
    once:async(id,key,action,input,run)=>{assert.equal(id,owner.id);assert.equal(key,'bg-import-1');assert.equal(action,'lab_background_import');return run();}
  });
  let res=await call(handler,request('background_search',{query:'neon',kind:'video',limit:99}));
  assert.equal(res.code,200);assert.deepEqual(calls[0],{query:'neon',kind:'photo',limit:8});
  res=await call(handler,request('background_import',{candidate_id:'pexels:photo:123'}));
  assert.equal(res.code,200);assert.equal(calls[1].user,owner.id);
  assert.deepEqual(res.body.asset.provenance,{role:'original',origin:'imported',source_url:'https://example.org/photo',attribution:'Photo by Jane',rights:'CC BY'});
  const count=calls.length;
  for(const candidate_id of ['pexels:video:123','https://evil.test/picture','openverse:photo:../../../']){
    res=await call(handler,request('background_import',{candidate_id}));assert.equal(res.code,400);
  }
  res=await call(handler,request('background_search',{query:'test'},{origin:'https://elsewhere.test'}));assert.equal(res.code,403);
  assert.equal(calls.length,count);
  res=await call(createNexusLabHandler({authenticate:async()=>null}),request('background_search',{query:'test'}));assert.equal(res.code,401);
});
