import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchSweepHandler} from '../api/research-sweep.js';
import {createResearchHandler} from '../api/research-jobs.js';
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}});
test('recovery cron rejects missing and wrong credentials; only authorized cron recovers',async()=>{
 let calls=0;const h=createResearchSweepHandler({store:{recover:async()=>{calls++;return {recovered:1};}},secret:()=> 'test-secret'});
 for(const authorization of ['', 'Bearer wrong']){const r=response();await h({method:'GET',headers:{authorization}},r);assert.equal(r.code,401);}
 const r=response();await h({method:'GET',headers:{authorization:'Bearer test-secret'}},r);assert.equal(r.code,200);assert.equal(calls,1);
});
test('cron fails closed without CRON_SECRET and exposes no exception details',async()=>{
 const h=createResearchSweepHandler({store:{recover:async()=>{throw Error('database credential');}},secret:()=>''});const r=response();await h({method:'GET',headers:{}},r);assert.equal(r.code,401);
 const r2=response();await createResearchSweepHandler({store:{recover:async()=>{throw Error('database credential');}},secret:()=> 'test-secret'})({method:'GET',headers:{authorization:'Bearer test-secret'}},r2);assert.equal(r2.code,503);assert.equal(JSON.stringify(r2.body).includes('credential'),false);
});
test('public history passes its wallet key to the store and rejects cross-site requests',async()=>{
 let key;const h=createResearchHandler({store:{history:async k=>{key=k;return [];}}});const r=response();await h({method:'POST',headers:{'content-type':'application/json'},body:{action:'history',key:'example-wallet-key'}},r);assert.equal(r.code,200);assert.equal(key,'example-wallet-key');
 const bad=response();await h({method:'POST',headers:{'content-type':'application/json',origin:'https://other.test',host:'nexus.test'},body:{action:'history',key:'example-wallet-key'}},bad);assert.equal(bad.code,403);
});
