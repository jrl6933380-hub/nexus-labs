import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantHandler, parseAssistantDecision } from '../api/room-assistant.js';

function response() {
  return {
    code: 0,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function harness(decision, { user = 'alice' } = {}) {
  const calls = { reserve: [], settle: [], append: [], route: 0, routeInput: null };
  const handler = createAssistantHandler({
    resolveUser: async () => user,
    meter: {
      async reserveBuild(input) {
        calls.reserve.push(input);
        return { ok: true, period: 1, reservationId: 'r1' };
      },
      async settleBuild(input) { calls.settle.push(input); },
    },
    conversations: {
      async getConversation() { return [{ role: 'assistant', text: 'What is the main goal?' }]; },
      async appendTurns(...args) { calls.append.push(args); },
    },
    async route(input) {
      calls.route += 1;
      calls.routeInput = input;
      return { data: { content: [{ type: 'text', text: JSON.stringify(decision) }] } };
    },
  });
  return { handler, calls };
}

test('advice remains conversation and consumes only the assistant reservation', async () => {
  const { handler, calls } = harness({
    kind: 'reply',
    message: 'A single focused landing page is the strongest first version.',
    suggestions: ['Plan the sections', 'Build it'],
  });
  const res = response();
  await handler({ method: 'POST', body: { message: 'What should I build?', projectId: 'p1' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.kind, 'reply');
  assert.equal(calls.reserve[0].kind, 'assistant');
  assert.equal(calls.settle[0].success, true);
  assert.equal(calls.append.length, 1);
});

test('an explicit build is compiled and releases the assistant reservation for build metering', async () => {
  const { handler, calls } = harness({
    kind: 'build',
    message: 'I’ll build the painting company site now.',
    instruction: 'Build a responsive painting company site with a quote form.',
  });
  const res = response();
  await handler({
    method: 'POST',
    body: { message: 'Build it', projectId: 'p1', currentHtml: '', projectLabel: 'New project' },
  }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.kind, 'build');
  assert.match(res.body.instruction, /quote form/);
  assert.equal(calls.settle[0].success, false);
});

test('attached images reach Nex as vision input with a stable build token', async () => {
  const { handler, calls } = harness({
    kind: 'build',
    message: 'I’ll use your logo in the hero.',
    instruction: 'Place NEXUS_IMAGE_1 in the hero with descriptive alt text.',
  });
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]).toString('base64');
  const res = response();
  await handler({
    method: 'POST',
    body: {
      message: 'Use this logo',
      projectId: 'p1',
      attachments: [{name:'logo.png',mediaType:'image/png',data:png}],
    },
  }, res);
  assert.equal(res.code, 200);
  const content = calls.routeInput.body.messages[0].content;
  assert.equal(content[0].type, 'text');
  assert.match(content[0].text, /NEXUS_IMAGE_1: logo\.png/);
  assert.equal(content[1].type, 'image');
  assert.equal(content[1].source.data, png);
});

test('only allowlisted workspace commands can cross the assistant boundary', () => {
  assert.deepEqual(
    parseAssistantDecision('{"kind":"command","command":"preview_phone","message":"Showing phone view."}'),
    { kind: 'command', command: 'preview_phone', message: 'Showing phone view.' },
  );
  assert.throws(
    () => parseAssistantDecision('{"kind":"command","command":"merge_pr","message":"Doing it."}'),
    /Unsupported workspace command/,
  );
});

test('unauthenticated customers cannot invoke the professional builder', async () => {
  const { handler, calls } = harness({ kind: 'reply', message: 'Hi' }, { user: null });
  const res = response();
  await handler({ method: 'POST', body: { message: 'hello', projectId: 'p1' } }, res);
  assert.equal(res.code, 401);
  assert.equal(calls.route, 0);
});
