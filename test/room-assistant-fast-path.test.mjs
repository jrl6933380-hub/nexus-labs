import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssistantHandler } from '../api/room-assistant.js';

// The point of these tests: a build request must not spend a Builder Brain
// call on classification. That second call is what ran the free tier out of
// per-minute budget, failing the classifier before the builder ever started.

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function harness({ askImpl } = {}) {
  let askCalls = 0;
  const appended = [];
  const handler = createAssistantHandler({
    resolveUser: async () => 'testuser',
    conversations: {
      getConversation: async () => [],
      appendTurns: async (user, project, turns) => { appended.push(...turns); },
    },
    ask: async (...args) => {
      askCalls += 1;
      if (askImpl) return askImpl(...args);
      throw new Error('the classifier should not have been called');
    },
    searchVaultFn: async () => [],
    meter: { settleBuild: async () => {} },
  });
  return { handler, appended, askCalls: () => askCalls };
}

const req = (message, extra = {}) => ({
  method: 'POST',
  body: { message, projectId: 'forge-1', ...extra },
});

test('an obvious build request builds without calling the Builder Brain', async () => {
  const { handler, askCalls } = harness();
  const res = makeRes();

  await handler(req('Can you build a page that helps me brainstorm ideas for the forge'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.kind, 'build');
  assert.match(res.body.instruction, /brainstorm ideas for the forge/);
  assert.equal(askCalls(), 0, 'the classifier call is exactly what this change exists to avoid');
});

test('the fast path records the exchange so the transcript stays intact', async () => {
  const { handler, appended } = harness();
  await handler(req('Make me a landing page for my bakery'), makeRes());

  assert.equal(appended.length, 2);
  assert.equal(appended[0].role, 'user');
  assert.equal(appended[1].role, 'assistant');
});

test('a question still goes to the model rather than building', async () => {
  const { handler, askCalls } = harness({
    askImpl: async () => ({ text: JSON.stringify({ kind: 'reply', message: 'Here is some advice.' }) }),
  });
  const res = makeRes();

  await handler(req('What kind of page would work best for a bakery?'), res);

  assert.equal(res.body.kind, 'reply');
  assert.equal(askCalls(), 1, 'judgement calls are exactly what the model is still for');
});

test('a bare greeting still goes to the model', async () => {
  const { handler, askCalls } = harness({
    askImpl: async () => ({ text: JSON.stringify({ kind: 'reply', message: 'Hey! What are we building?' }) }),
  });
  const res = makeRes();

  await handler(req('Hey'), res);

  assert.equal(res.body.kind, 'reply');
  assert.equal(askCalls(), 1);
});

test('an edit request does not take the fast path (it needs the current page)', async () => {
  const { handler, askCalls } = harness({
    askImpl: async () => ({
      text: JSON.stringify({ kind: 'build', message: 'Changing it.', instruction: 'Make the header red.' }),
    }),
  });
  const res = makeRes();

  await handler(req('Change the header to red', { currentHtml: '<!DOCTYPE html><html></html>' }), res);

  assert.equal(res.body.kind, 'build');
  assert.equal(askCalls(), 1, 'an edit still routes through the model, which sees the existing page');
});

test('a rate-limited edit still recovers a build from the customer\'s own words', async () => {
  const { handler } = harness({
    askImpl: async () => {
      const error = new Error('rate limited');
      error.code = 'BRAIN_RATE_LIMITED';
      throw error;
    },
  });
  const res = makeRes();

  await handler(req('Add a contact form to the bottom', { currentHtml: '<!DOCTYPE html><html></html>' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.kind, 'build', 'a rate limit should not dead-end an explicit request');
});

test('a rate-limited question still surfaces the rate-limit message', async () => {
  const { handler } = harness({
    askImpl: async () => {
      const error = new Error('Your Builder Brain hit its rate limit.');
      error.code = 'BRAIN_RATE_LIMITED';
      throw error;
    },
  });
  const res = makeRes();

  await handler(req('What should I put on the homepage?'), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'BRAIN_RATE_LIMITED');
  assert.match(res.body.error, /rate limit/i);
});
