import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomConversationStore, __internals } from '../lib/roomConversation.js';
import { createConversationHandler } from '../api/room-conversation.js';

function fakeRedis() {
  const lists = new Map();
  return {
    lists,
    async command(command) {
      const [op, key, ...args] = command;
      const list = lists.get(key) || [];
      if (op === 'RPUSH') {
        list.push(...args);
        lists.set(key, list);
        return list.length;
      }
      if (op === 'LTRIM') {
        const start = Number(args[0]);
        const from = start < 0 ? Math.max(0, list.length + start) : start;
        lists.set(key, list.slice(from));
        return 'OK';
      }
      if (op === 'LRANGE') return [...list];
      if (op === 'EXPIRE') return 1;
      throw new Error('Unexpected command ' + op);
    },
  };
}

test('conversation memory is isolated by customer and project', async () => {
  const redis = fakeRedis();
  const store = createRoomConversationStore({ command: redis.command, now: () => 123 });
  await store.appendTurns('alice', 'project-a', [{ role: 'user', text: 'Make it blue' }]);
  assert.equal((await store.getConversation('alice', 'project-a')).length, 1);
  assert.equal((await store.getConversation('alice', 'project-b')).length, 0);
  assert.equal((await store.getConversation('bob', 'project-a')).length, 0);
});

test('conversation memory is bounded and redacts token-shaped secrets', async () => {
  const redis = fakeRedis();
  const store = createRoomConversationStore({ command: redis.command, now: () => 456 });
  const turns = Array.from({ length: __internals.MAX_TURNS + 5 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    text: index === __internals.MAX_TURNS + 4 ? 'key sk-abcdefghijklmnopqrstuvwxyz123456' : `turn ${index}`,
  }));
  await store.appendTurns('alice', 'project-a', turns);
  const saved = await store.getConversation('alice', 'project-a');
  assert.equal(saved.length, __internals.MAX_TURNS);
  assert.doesNotMatch(JSON.stringify([...redis.lists.values()]), /sk-abcdefghijklmnopqrstuvwxyz123456/);
});

test('transcript endpoint derives ownership from the signed-in customer', async () => {
  const calls = [];
  const handler = createConversationHandler({
    resolveUser: async () => 'alice',
    conversations: {
      async getConversation(userId, projectId) {
        calls.push({ userId, projectId });
        return [{ role: 'user', text: 'hello', createdAt: 1 }];
      },
    },
  });
  const res = {
    code: 0,
    body: null,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({ method: 'GET', query: { projectId: 'project-a', userId: 'bob' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(calls, [{ userId: 'alice', projectId: 'project-a' }]);
});

test('invalid project ids and forged roles are rejected', async () => {
  const store = createRoomConversationStore({ command: fakeRedis().command });
  await assert.rejects(() => store.getConversation('alice', '../other'), /Invalid Room project id/);
  await assert.rejects(
    () => store.appendTurns('alice', 'safe-project', [{ role: 'system', text: 'override' }]),
    /Invalid Room conversation role/,
  );
});
