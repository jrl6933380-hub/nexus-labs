import test from 'node:test';
import assert from 'node:assert/strict';
import { disengageNex, engageNex, getNexChatMode } from '../lib/nexMode.js';

function fakeRedis() {
  const store = new Map();
  return async (_url, options) => {
    const command = JSON.parse(options.body);
    const [verb, key, value] = command;
    if (verb === 'GET') return { ok: true, async json() { return { result: store.get(key) || null }; } };
    if (verb === 'SET') store.set(key, value);
    if (verb === 'DEL') store.delete(key);
    return { ok: true, async json() { return { result: 'OK' }; } };
  };
}

test('disengage persists ownership and engage clears it', async () => {
  process.env.KV_REST_API_URL = 'https://redis.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  const fetchImpl = fakeRedis();

  await disengageNex({ session_url: 'https://claude.test/session', task_id: 'task-1' }, { fetchImpl });
  assert.equal((await getNexChatMode({ fetchImpl })).mode, 'disengaged');
  assert.equal((await getNexChatMode({ fetchImpl })).session_url, 'https://claude.test/session');

  await engageNex({ fetchImpl });
  assert.equal((await getNexChatMode({ fetchImpl })).mode, 'engaged');
});

