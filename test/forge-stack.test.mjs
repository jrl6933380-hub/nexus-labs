import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStore,
  ensureStackManifest,
  applyStackRecommendation,
  selectStackProvider,
  setStackSlotState,
  stackProgress,
} from '../lib/forgeStack.js';
import { createForgeStackHandler } from '../api/forge-stack.js';

test('booking recommendation creates the required full-stack checklist', async () => {
  const store = createMemoryStore();
  const manifest = await ensureStackManifest({
    ownerUsername: 'alice',
    projectId: 'salon',
    projectType: 'booking',
    store,
  });
  for (const slot of ['brain', 'auth', 'database', 'email', 'deployment']) {
    assert.equal(manifest.slots[slot].required, true, slot);
    assert.equal(manifest.slots[slot].status, 'recommended', slot);
  }
  assert.equal(manifest.slots.payments.required, false);
  assert.deepEqual(stackProgress(manifest), { ready: 0, required: 5, percent: 0, next: 'brain' });
});

test('manifests are isolated by account even with the same project id', async () => {
  const store = createMemoryStore();
  await selectStackProvider({
    ownerUsername: 'alice',
    projectId: 'default',
    slotId: 'database',
    provider: 'neon',
    store,
  });
  const bob = await ensureStackManifest({ ownerUsername: 'bob', projectId: 'default', store });
  assert.equal(bob.slots.database.status, 'not_needed');
  assert.equal(bob.slots.database.provider, null);
});

test('provider selection and readiness use validated transitions', async () => {
  const store = createMemoryStore();
  await selectStackProvider({
    ownerUsername: 'alice',
    projectId: 'app',
    slotId: 'brain',
    provider: 'openrouter',
    store,
  });
  await setStackSlotState({ ownerUsername: 'alice', projectId: 'app', slotId: 'brain', status: 'connecting', store });
  await setStackSlotState({ ownerUsername: 'alice', projectId: 'app', slotId: 'brain', status: 'connected', store });
  await setStackSlotState({ ownerUsername: 'alice', projectId: 'app', slotId: 'brain', status: 'testing', store });
  const ready = await setStackSlotState({ ownerUsername: 'alice', projectId: 'app', slotId: 'brain', status: 'ready', store });
  assert.equal(ready.slots.brain.status, 'ready');
  assert.ok(ready.slots.brain.tested_at);

  await assert.rejects(
    () => setStackSlotState({ ownerUsername: 'alice', projectId: 'app', slotId: 'deployment', status: 'ready', store }),
    /Invalid stack transition/,
  );
});

test('stack metadata rejects credentials at any nesting level', async () => {
  const store = createMemoryStore();
  await assert.rejects(
    () => setStackSlotState({
      ownerUsername: 'alice',
      projectId: 'app',
      slotId: 'brain',
      status: 'error',
      metadata: { provider: { apiKey: 'do-not-store-this' } },
      store,
    }),
    /cannot contain credentials/,
  );
});

function responseRecorder() {
  return {
    code: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('API scopes every stack operation to the authenticated account', async () => {
  const calls = [];
  const handler = createForgeStackHandler({
    resolveUser: async () => 'signed-in-user',
    ensure: async (input) => {
      calls.push(input);
      return {
        owner: input.ownerUsername,
        project_id: input.projectId,
        slots: {},
        created_at: 1,
        updated_at: 1,
      };
    },
  });
  const res = responseRecorder();
  await handler({ method: 'GET', query: { projectId: 'my-app' } }, res);
  assert.equal(res.code, 200);
  assert.equal(calls[0].ownerUsername, 'signed-in-user');
  assert.equal(calls[0].projectId, 'my-app');
  assert.equal(res.body.owner, 'signed-in-user');
});

test('API refuses unauthenticated access', async () => {
  const handler = createForgeStackHandler({ resolveUser: async () => null });
  const res = responseRecorder();
  await handler({ method: 'GET', query: {} }, res);
  assert.equal(res.code, 401);
});
