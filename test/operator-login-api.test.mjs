import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

process.env.KV_REST_API_URL = 'https://auth-test.invalid';
process.env.KV_REST_API_TOKEN = 'test-only';
process.env.NEXUS_OPERATOR_USERNAMES = 'owner';
const { default: handler } = await import('../api/room-auth.js');
const salt = 'test-only-salt';
const record = JSON.stringify({ salt, passwordHash: scryptSync('test-password', salt, 64).toString('hex') });

test('operator login denies customers before creating cookies; normal customer login still works', async () => {
  let sessions = 0;
  globalThis.fetch = async (_url, options) => {
    const [command] = JSON.parse(options.body);
    if (command === 'SET') sessions++;
    return { ok: true, json: async () => ({ result: command === 'HGET' ? record : 'OK' }) };
  };
  const invoke = async (action, username, password = 'test-password') => {
    const res = { statusCode: 0, headers: {}, status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; } };
    await handler({ method: 'POST', body: { action, username, password } }, res);
    return res;
  };
  const customer = await invoke('operator-login', 'customer');
  assert.equal(customer.statusCode, 403);
  assert.equal(sessions, 0);
  assert.equal(customer.headers['Set-Cookie'], undefined);
  assert.equal((await invoke('operator-login', 'owner', 'wrong')).statusCode, 401);
  assert.equal(sessions, 0);
  const owner = await invoke('operator-login', 'owner');
  assert.equal(owner.body.operator, true);
  assert.match(owner.headers['Set-Cookie'], /HttpOnly/);
  const regular = await invoke('login', 'customer');
  assert.equal(regular.statusCode, 200);
  assert.equal(regular.body.operator, false);
  assert.equal(sessions, 2);
});
