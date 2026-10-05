import test from 'node:test';
import assert from 'node:assert/strict';
import { createForgeStackHandler } from '../api/forge-stack.js';
import { describeProjectConnections, connectionScopeMessage } from '../lib/forge/connectionGuidance.js';
import { createStackManifest } from '../lib/forgeStack.js';
import { describeStackActions } from '../lib/forge/stackActions.js';
import { createAssistantHandler, isConversationOnlyMessage } from '../api/room-assistant.js';
const projectId = 'bakery';
const manifest = createStackManifest({ ownerUsername: 'alice', projectId, features: ['bookings'] });
const context = { project: { projectId, label: 'Sunrise Bakery' }, features: ['bookings'], connections: [], unavailable: [] };
const response = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('connection descriptions explain their application to the selected project and honest blockers', () => {
  const guidance = describeProjectConnections(context, manifest, describeStackActions(manifest));
  assert.match(guidance.database.application, /Sunrise Bakery/);
  assert.match(guidance.database.application, /reservations/);
  assert.match(guidance.email.application, /booking confirmations/);
  assert.equal(guidance.database.canSetup, true);
  assert.equal(guidance.payments.canSetup, false);
  assert.match(guidance.payments.blocker, /authorization/);
});

test('connection details retain project identity and every row has an explanation', async () => {
  const handler = createForgeStackHandler({ resolveUser: async () => 'alice', ensure: async () => manifest, readContext: async () => context });
  const res = response(); await handler({ method: 'GET', query: { projectId } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.project.projectId, projectId);
  for (const id of Object.keys(manifest.slots)) {
    assert.ok(res.body.guidance[id].explanation);
    assert.match(res.body.guidance[id].application, /Sunrise Bakery/);
  }
});

test('Connect scopes only the authenticated saved project and performs no setup', async () => {
  const calls = [];
  const handler = createForgeStackHandler({ resolveUser: async () => 'alice',
    readContext: async args => { calls.push(args); return context; }, ensure: async () => manifest,
    runAction: async () => { throw Error('scope must not configure anything'); }, setup: async () => { throw Error('scope must not provision anything'); },
  });
  const res = response(); await handler({ method: 'POST', body: { action: 'scope', projectId, slotId: 'database', ownerUsername: 'bob' } }, res);
  assert.equal(res.code, 200); assert.equal(calls[0].ownerUsername, 'alice');
  assert.equal(res.body.project.projectId, projectId);
  assert.equal(isConversationOnlyMessage(res.body.message), true);
});

test('Connect refuses missing projects, unknown slots, and inherited property names', async () => {
  for (const [project, slotId, code] of [[null, 'database', 409], [context.project, 'unknown', 400], [context.project, '__proto__', 400]]) {
    const handler = createForgeStackHandler({ resolveUser: async () => 'alice', ensure: async () => manifest, readContext: async () => ({ ...context, project }) });
    const res = response(); await handler({ method: 'POST', body: { action: 'scope', projectId, slotId } }, res);
    assert.equal(res.code, code);
  }
});

test('Nex cannot turn a connection scoping request into an automatic build', async () => {
  const message = connectionScopeMessage(context.project, describeProjectConnections(context, manifest).database);
  const handler = createAssistantHandler({ resolveUser: async () => 'alice', conversations: { getConversation: async () => [], appendTurns: async () => {} },
    readContext: async () => context, searchVaultFn: async () => [], ask: async () => ({ text: JSON.stringify({ kind: 'build', message: 'Building now', instruction: 'Build a booking database' }) }),
  });
  const res = response(); await handler({ method: 'POST', body: { projectId, currentHtml: '<h1>Bakery</h1>', message } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.kind, 'reply');
});
