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
// Default to a paid plan in tests so the existing non-plan-related
// export tests below keep exercising the 200 path unchanged; the new
// tests at the bottom of this file explicitly pass resolvePlan to
// exercise the free-tier gate.
const make = (user, resolvePlan = async () => 'unlimited') => createHistoryHandler({
  resolveUser: async () => user,
  readBuild: async (owner, id) => owner === 'alice' && id === 'a1' ? { html, label: '\r\nInjected: yes' } : null,
  readList: async () => [],
  readProjects: async () => [],
  removeProject: async () => ({ removed: 0 }),
  resolvePlan,
});
const request = (query = {id:'a1', download:'html'}) => ({method:'GET', query});

test('a signed-out guest is scoped to its own anon id and still cannot read another account\'s build', async () => {
  // Guest access is deliberate: api/room-history.js falls back to
  // getOrCreateAnonId when there is no session. This test previously
  // asserted 401 and predated that change. The protection that actually
  // matters is that readBuild is owner-scoped — a guest resolves to their
  // own anon id, so a known build id belonging to someone else still misses.
  let requestedOwner = 'unset';
  const handler = createHistoryHandler({
    resolveUser: async () => null,
    readBuild: async (owner, id) => {
      requestedOwner = owner;
      return owner === 'alice' && id === 'a1' ? { html, label: 'x' } : null;
    },
    readList: async () => [],
    resolvePlan: async () => 'unlimited',
  });
  const res = response();
  await handler({ method: 'GET', query: { id: 'a1', download: 'html' }, headers: {}, cookies: {} }, res);
  assert.notEqual(requestedOwner, 'alice', 'a guest must never be resolved to another account');
  assert.equal(res.code, 404);
  assert.equal(res.headers['Content-Disposition'], undefined);
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
  // The list response gained a grouped `projects` view; `builds` stays for
  // anything still reading the flat version list.
  const list=response(); await make('alice')(request({}),list); assert.deepEqual(list.body,{builds:[],projects:[]});
});

test('deleting a project is scoped to the caller and reports what it removed', async () => {
  let askedFor = null;
  const handler = createHistoryHandler({
    resolveUser: async () => 'alice',
    readBuild: async () => null,
    readList: async () => [],
    readProjects: async () => [],
    removeProject: async (owner, projectId) => {
      askedFor = { owner, projectId };
      return { removed: projectId === 'proj-a' ? 2 : 0 };
    },
    resolvePlan: async () => 'unlimited',
  });
  const ok = response();
  await handler({ method: 'DELETE', query: { projectId: 'proj-a' } }, ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.removed, 2);
  assert.deepEqual(askedFor, { owner: 'alice', projectId: 'proj-a' }, 'delete must be scoped to the caller');

  const missing = response();
  await handler({ method: 'DELETE', query: { projectId: 'someone-elses' } }, missing);
  assert.equal(missing.code, 404, 'a project the caller does not own is simply not found');

  const bad = response();
  await handler({ method: 'DELETE', query: {} }, bad);
  assert.equal(bad.code, 400);
});
test('session storage failure returns a controlled error', async () => {
  const handler=createHistoryHandler({resolveUser:async()=>{throw new Error('storage unavailable');}});
  const res=response(); await handler(request(),res); assert.equal(res.code,500);
});
test('non-GET requests cannot export', async () => {
  const res=response(); await make('alice')({method:'POST'},res); assert.equal(res.code,405);
});
test('free-tier accounts cannot download exported html', async () => {
  const res=response(); await make('alice', async () => 'free')(request(),res);
  assert.equal(res.code,402);
  assert.equal(res.body.code,'EXPORT_REQUIRES_PAID_PLAN');
  assert.equal(res.headers['Content-Disposition'],undefined);
});
test('an account with no stored plan (undefined) is treated as free and blocked', async () => {
  const res=response(); await make('alice', async () => undefined)(request(),res);
  assert.equal(res.code,402);
});
test('viewing (no download param) still works on a free-tier account', async () => {
  const res=response(); await make('alice', async () => 'free')(request({id:'a1'}),res);
  assert.equal(res.code,200); assert.equal(res.body.build.html,html);
});
test('hosted, growth, and unlimited plans can all download', async () => {
  for (const plan of ['hosted','growth','unlimited']) {
    const res=response(); await make('alice', async () => plan)(request(),res);
    assert.equal(res.code,200,`plan ${plan} should be able to export`);
  }
});
