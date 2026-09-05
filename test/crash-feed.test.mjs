import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createMemoryCrashStore, verifySentrySignature, normalizeSentryEvent, ingestSentryCrash, listCrashes } from '../lib/crashFeed.js';

test('rejects forged Sentry signatures and accepts HMAC signature', () => {
  const body = JSON.stringify({ issue_id: '42' });
  const secret = 'test-secret';
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifySentrySignature(body, `sha256=${sig}`, secret), true);
  assert.equal(verifySentrySignature(body, 'sha256=00'.repeat(32), secret), false);
});

test('normalizes and redacts sensitive Sentry fields', () => {
  const record = normalizeSentryEvent({ issue_id: 'i-1', title: 'Boom', tags: { route: '/api/chat' }, request: { headers: { authorization: 'Bearer secret' }, url: '/api/chat?token=abc' }, exception: { values: [{ type: 'Error', value: 'bad' }] } });
  assert.equal(record.route, '/api/chat');
  assert.equal(record.event.exception.type, 'Error');
  assert.equal(record.event.tags.route, '/api/chat');
  assert.equal(record.event.tags.authorization, undefined);
});

test('deduplicates repeated issue and links one repair task', async () => {
  const store = createMemoryCrashStore();
  let created = 0;
  const createRepairTask = async () => ({ id: `repair-${++created}` });
  const event = { issue_id: 'same', title: 'Repeated failure', level: 'error', transaction: '/api/chat' };
  const first = await ingestSentryCrash(event, { store, now: 100, createRepairTask });
  const second = await ingestSentryCrash(event, { store, now: 200, createRepairTask });
  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  assert.equal(second.repair_task_id, 'repair-1');
  assert.equal(created, 1);
  assert.equal((await listCrashes({ store }))[0].count, 2);
});
