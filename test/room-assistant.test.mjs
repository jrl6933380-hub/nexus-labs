import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAssistantHandler,
  buildFromCustomerWords,
  getDirectOpenProjectCommand,
  isConversationOnlyMessage,
  parseAssistantDecision,
} from '../api/room-assistant.js';

test('an empty free-router decision recovers an explicit build from the customer brief', async () => {
  const prior = [{ role:'user', text:'Build a brainstorming board with Ideas, In Progress, and Done columns, draggable cards and saved state.' }];
  assert.match(buildFromCustomerWords('Build it', prior).instruction, /draggable cards/);
  assert.equal(buildFromCustomerWords('Build it', []), null);
  assert.equal(buildFromCustomerWords('Should I build it?', prior), null);
  const handler = createAssistantHandler({
    resolveUser:async () => 'tester',
    conversations:{ getConversation:async () => prior, appendTurns:async () => {} },
    searchVaultFn:async () => [],
    ask:async () => { const error = new Error('empty'); error.code = 'BRAIN_EMPTY'; throw error; },
  });
  const res = response();
  await handler({ method:'POST', body:{ message:'Build it', projectId:'board' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.kind, 'build');
  assert.match(res.body.instruction, /Ideas, In Progress, and Done/);
});

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

function harness(decision, { user = 'alice', reserveResult = { ok: true, period: 1, reservationId: 'r1' } } = {}) {
  const calls = { reserve: [], settle: [], append: [], escalate: [], route: 0, routeInput: null };
  const handler = createAssistantHandler({
    resolveUser: async () => user,
    meter: {
      async reserveBuild(input) {
        calls.reserve.push(input);
        return reserveResult;
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
    escalator: {
      async queue(input) {
        calls.escalate.push(input);
        return { id: 'forge-1-ticket', pipelineId: 'pipeline-1', status: 'lanes_running', message: 'Build Team ticket forge-1-ticket is queued.' };
      },
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

test('a named saved project opens directly and never reaches the builder classifier', async () => {
  const id = '1789900007465-5xiu9n';
  assert.deepEqual(
    getDirectOpenProjectCommand(`Open "${id}" and tell me where it stands.`),
    { kind: 'command', command: 'open_project', target: id, message: `Opening saved project "${id}".` },
  );
  const { handler, calls } = harness({
    kind: 'build',
    message: 'Wrong path',
    instruction: 'Rebuild it.',
  });
  const res = response();
  await handler({ method: 'POST', body: { message: `Open "${id}" and tell me where it stands.`, projectId: 'p1' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.kind, 'command');
  assert.equal(res.body.command, 'open_project');
  assert.equal(res.body.target, id);
  assert.equal(calls.route, 0, 'safe local navigation bypasses the model');
  assert.equal(calls.reserve.length, 0, 'opening history does not consume an assistant credit');
});

test('questions cannot be promoted into builds by a classifier mistake', async () => {
  assert.equal(isConversationOnlyMessage('Should I add a contact form?'), true);
  assert.equal(isConversationOnlyMessage('Can you add a contact form?'), false);
  const { handler, calls } = harness({
    kind: 'build',
    message: 'I’ll change it now.',
    instruction: 'Add a contact form.',
  });
  const res = response();
  await handler({ method: 'POST', body: { message: 'Should I add a contact form?', projectId: 'p1' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.kind, 'reply');
  assert.match(res.body.message, /won’t change the project/);
  assert.equal(calls.settle[0].success, true, 'the guarded turn stays conversational');
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

test('an old team-shaped decision is normalized into an automatic build', async () => {
  const { handler, calls } = harness({
    kind: 'team',
    message: 'This needs the Build Team.',
    instruction: 'Build a multi-route booking app with a secure server workflow.',
  });
  const res = response();
  await handler({
    method: 'POST',
    body: { message: 'Build my booking platform', projectId: 'p1', currentHtml: '<!doctype html><html></html>' },
  }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.kind, 'build');
  assert.match(res.body.instruction, /booking app/);
  assert.equal(calls.escalate.length, 0);
  assert.equal(calls.settle[0].success, false, 'automatic build owns the build credit');
});

test('only allowlisted workspace commands can cross the assistant boundary', () => {
  assert.deepEqual(
    parseAssistantDecision('{"kind":"command","command":"preview_phone","message":"Showing phone view."}'),
    { kind: 'command', command: 'preview_phone', message: 'Showing phone view.' },
  );
  assert.deepEqual(
    parseAssistantDecision('{"kind":"command","command":"open_project","target":"1789900007465-5xiu9n","message":"Opening it."}'),
    { kind: 'command', command: 'open_project', target: '1789900007465-5xiu9n', message: 'Opening it.' },
  );
  assert.deepEqual(
    parseAssistantDecision('{"kind":"team","message":"This needs the team.","instruction":"Build the complete multi-route app."}'),
    { kind: 'build', message: 'This needs the team.', instruction: 'Build the complete multi-route app.' },
  );
  assert.throws(
    () => parseAssistantDecision('{"kind":"command","command":"merge_pr","message":"Doing it."}'),
    /Unsupported workspace command/,
  );
});

test('a signed-out guest can use the builder but is still metered, not waved through', async () => {
  // Guest access is deliberate: api/room-assistant.js falls back to
  // getOrCreateAnonId. This test previously asserted 401 and predated that.
  // What protects cost here is not a session wall but the meter — a guest
  // reserves credits like anyone else, and is refused when exhausted (see
  // the next test), so "no session" does not mean "free unlimited model".
  const { handler, calls } = harness({ kind: 'reply', message: 'Hi' }, { user: null });
  const res = response();
  await handler({ method: 'POST', body: { message: 'hello', projectId: 'p1' }, headers: {}, cookies: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(calls.reserve.length, 1, 'a guest turn still goes through the meter');
});

test('an exhausted account is refused before the model is ever called', async () => {
  const { handler, calls } = harness(
    { kind: 'reply', message: 'Hi' },
    { reserveResult: { ok: false, remaining: 0 } },
  );
  const res = response();
  await handler({ method: 'POST', body: { message: 'hello', projectId: 'p1' }, headers: {}, cookies: {} }, res);
  assert.equal(res.code, 429);
  assert.equal(res.body.code, 'ROOM_CREDITS_EXHAUSTED');
  assert.equal(calls.route, 0, 'no model spend on an exhausted account');
});
