import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryHandler } from '../api/room-history.js';

function response() {
  return { headers: {}, code: 0, body: null,
    setHeader(k,v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}
const html = '<!doctype html><script>alert("generated")</script>';
const make = (user) => createHistoryHandler({
  resolveUser: async () => user,
  readBuild: async (owner, id) => owner === 'alice' && id === 'a1' ? { html, label: '\r\nInjected: yes' } : null,
  readList: async () => [],
});
const request = (query = {id:'a1', download:'html'}) => ({method:'GET', query});

test('export requires a session before storage access', async () => {
  const handler = createHistoryHandler({resolveUser:async()=>null, readBuild:()=>assert.fail('storage called')});
  const res=response(); await handler(request(),res); assert.equal(res.code,401);
});
test('another user cannot download a known build id or spoof owner', async () => {
  const res=response(); await make('bob')(request({id:'a1',download:'html',username:'alice'}),res);
  assert.equal(res.code,404); assert.equal(res.headers['Content-Disposition'],undefined);
});
test('owner receives exact source as a non-cacheable attachment', async () => {
  const res=response(); await make('alice')(request(),res);
  assert.equal(res.code,200); assert.equal(res.body,html);
  assert.equal(res.headers['Content-Type'],'application/octet-stream');
  assert.equal(res.headers['Content-Disposition'],'attachment; filename="nexus-build.html"');
  assert.equal(res.headers['Cache-Control'],'private, no-store');
  assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
  assert.match(res.headers['Content-Security-Policy'],/sandbox/);
});
test('invalid export parameters are rejected', async () => {
  for (const query of [{download:'html'},{id:['a1'],download:'html'},{id:'a1',download:'zip'}]) {
    const res=response(); await make('alice')(request(query),res); assert.equal(res.code,400);
  }
});
test('existing JSON and list responses remain compatible', async () => {
  const res=response(); await make('alice')(request({id:'a1'}),res); assert.equal(res.body.build.html,html);
  const list=response(); await make('alice')(request({}),list); assert.deepEqual(list.body,{builds:[]});
});
test('session storage failure returns a controlled error', async () => {
  const handler=createHistoryHandler({resolveUser:async()=>{throw new Error('storage unavailable');}});
  const res=response(); await handler(request(),res); assert.equal(res.code,500);
});
test('non-GET requests cannot export', async () => {
  const res=response(); await make('alice')({method:'POST'},res); assert.equal(res.code,405);
});
