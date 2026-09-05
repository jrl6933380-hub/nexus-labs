import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenantsHandler } from '../api/board.js';
const response = () => ({ code: 0, body: null, headers: {}, setHeader(k,v){this.headers[k]=v;}, status(c){this.code=c;return this;}, json(b){this.body=b;return this;}, send(b){this.body=b;return this;} });
const tenant = { tenant_id:'tenant-a', owner:'alice', name:'Example project', slug:'alice:example-project', mode:'hosted', quota:{creditsPerPeriod:250}, connections:{github:{accountLogin:'example-org',connected_at:1}} };

test('tenant API denies unauthenticated requests before storage access', async () => {
  const h=createTenantsHandler({resolveUser:async()=>null,listForOwner:()=>assert.fail('storage called')}), r=response();
  await h({method:'GET',query:{}},r);
  assert.equal(r.code,401); assert.equal(r.headers['Cache-Control'],'private, no-store');
});

test('tenant list derives ownership from the session, never request input', async () => {
  let owner; const h=createTenantsHandler({resolveUser:async()=> 'alice',listForOwner:async({ownerUsername})=>{owner=ownerUsername;return [tenant];}}),r=response();
  await h({method:'GET',query:{owner:'bob'}},r);
  assert.equal(r.code,200); assert.equal(owner,'alice'); assert.deepEqual(r.body.tenants,[tenant]);
});

test('tenant export denies cross-owner access and omits credentials', async () => {
  const denied=createTenantsHandler({resolveUser:async()=> 'bob',assertAccess:async()=>{throw new Error('Tenant not found or not owned by this account.');}}), dr=response();
  await denied({method:'GET',query:{action:'export',tenant_id:'tenant-a'}},dr); assert.equal(dr.code,400); assert.equal(dr.headers['Content-Disposition'],undefined);
  const allowed=createTenantsHandler({resolveUser:async()=> 'alice',assertAccess:async()=>tenant,meter:{getUsageSummary:async()=>({limit:250,consumed:10,remaining:240})}}), ar=response();
  await allowed({method:'GET',query:{action:'export',tenant_id:'tenant-a'}},ar);
  assert.equal(ar.code,200); assert.match(ar.headers['Content-Disposition'],/^attachment;/); const body=JSON.stringify(JSON.parse(ar.body));
  assert.equal(body.includes('accessToken'),false); assert.equal(body.includes('refreshToken'),false); assert.equal(body.includes('credential'),false);
});
