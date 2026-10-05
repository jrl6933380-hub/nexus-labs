import test from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://forge-developer-test.invalid';
process.env.KV_REST_API_TOKEN = 'test';

const kv = new Map();
const tracked = new Set();
const users = {
  'tester': { email:'forge-a1b2c3d4@nexus-forge.internal', plan:'free' },
  'customer': { email:'customer@example.test', plan:'free' },
};
global.fetch = async (_url, options) => {
  const [command, key, value] = JSON.parse(options.body);
  let result;
  if (command === 'SET') { kv.set(key, value); result = 'OK'; }
  else if (command === 'GET') result = kv.get(key) ?? null;
  else if (command === 'DEL') result = kv.delete(key) ? 1 : 0;
  else if (command === 'HGETALL') result = Object.entries(users).flatMap(([name, record]) => [name, JSON.stringify(record)]);
  else if (command === 'SADD') { tracked.add(value); result = 1; }
  else if (command === 'SISMEMBER') result = tracked.has(value) ? 1 : 0;
  else throw new Error(`Unexpected ${command}`);
  return { ok:true, json:async () => ({ result }) };
};

const { createOwnerSession } = await import('../lib/nexusOwnerAuth.js');
const { default: handler } = await import('../api/forge-admin.js');
function response() {
  return { headers:{}, setHeader(key, value) { this.headers[key] = value; return this; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test('developer switching requires the private owner session and excludes customer accounts', async () => {
  const noOwner = response();
  await handler({ method:'POST', headers:{}, body:{ action:'switch_developer', targetUsername:'tester' } }, noOwner);
  assert.equal(noOwner.code, 401);

  const ownerToken = await createOwnerSession();
  const req = { method:'POST', headers:{ cookie:`nexus_owner_session=${ownerToken}` },
    body:{ action:'switch_developer', targetUsername:'customer' } };
  const customer = response(); await handler(req, customer);
  assert.equal(customer.code, 403);
  req.body.action = 'track_developer';
  const customerTrack = response(); await handler(req, customerTrack);
  assert.equal(customerTrack.code, 403);

  req.body.targetUsername = 'tester';
  req.body.action = 'switch_developer';
  const untracked = response(); await handler(req, untracked);
  assert.equal(untracked.code, 403);
  req.body.action = 'track_developer';
  const mark = response(); await handler(req, mark);
  assert.equal(mark.code, 200);
  req.body.action = 'switch_developer';
  const developer = response(); await handler(req, developer);
  assert.equal(developer.code, 200);
  assert.equal(developer.body.username, 'tester');
  assert.match(developer.headers['Set-Cookie'], /nexus_room_session=/u);
});
