import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryRoadmapStore,
  getProjectRoadmap,
  publicProjectRoadmap,
  reconcileProjectRoadmap,
  recordRoadmapChecklist,
} from '../lib/forge/projectRoadmap.js';
import { createForgeRoadmapHandler } from '../api/forge-roadmap.js';
import { conversationTurnForPrompt, createAssistantHandler } from '../api/room-assistant.js';

const ownerUsername = 'alice', projectId = 'bakery';
const response = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

function context(overrides = {}) {
  return {
    project: { projectId, label: 'Sunrise Bakery', latestBuildId: 'build-1', pieces: [] },
    originalPlan: { mode: 'new', progress: { ready: true }, answers: { idea: 'A bakery website' }, summary: [{ label: 'What should Nex build?', value: 'A bakery website' }] },
    addonPlan: null,
    connections: [],
    unavailable: [],
    ...overrides,
  };
}

test('roadmap creates a stable customer path from real project evidence', () => {
  const roadmap = reconcileProjectRoadmap({}, context(), () => 100);
  assert.equal(roadmap.phase, 'reviewing');
  assert.deepEqual(roadmap.path.map(item => item.id), ['plan', 'build', 'connections', 'review', 'launch']);
  assert.equal(roadmap.path.find(item => item.id === 'build').status, 'complete');
  assert.equal(roadmap.path.find(item => item.id === 'review').status, 'current');
  assert.deepEqual(roadmap.best_next_step, { label: 'Review the complete project', view: 'preview' });
});

test('unready required connections become the evidence-backed next step', () => {
  const roadmap = reconcileProjectRoadmap({}, context({ connections: [
    { id: 'database', label: 'Database', required: true, status: 'ready' },
    { id: 'email', label: 'Email', required: true, status: 'not_checked' },
  ] }));
  assert.equal(roadmap.phase, 'connecting');
  assert.deepEqual(roadmap.best_next_step, { label: 'Prepare Email', view: 'stack' });
  assert.match(roadmap.path.find(item => item.id === 'connections').note, /1 required connection/);
});

test('approved additions stay current until their saved stack piece proves completion', () => {
  const addonPlan = { mode: 'addon', approved_at: 1, progress: { ready: true }, answers: { idea: 'Customer booking page' }, summary: [] };
  let roadmap = reconcileProjectRoadmap({}, context({ addonPlan }));
  assert.equal(roadmap.path.find(item => item.id === 'addition').status, 'current');
  assert.deepEqual(roadmap.best_next_step, { label: 'Build the approved addition', view: 'brief' });
  roadmap = reconcileProjectRoadmap({}, context({ addonPlan, project: { ...context().project, pieces: [{ kind: 'page', label: 'Add-on approved: Customer booking page' }] } }));
  assert.equal(roadmap.path.find(item => item.id === 'addition').status, 'complete');
});

test('Nex checklist items persist privately and can guide the best next action', async () => {
  const store = createMemoryRoadmapStore();
  const readContext = async () => context();
  const roadmap = await recordRoadmapChecklist({ ownerUsername, projectId, store, readContext, checklist: {
    title: 'Bakery updates', items: [
      { label: 'Keep the warm colors', state: 'decided' },
      { label: 'Choose pickup hours', state: 'next' },
    ],
  }, now: () => 200 });
  assert.equal(roadmap.assistant_items[1].label, 'Choose pickup hours');
  assert.deepEqual(roadmap.best_next_step, { label: 'Choose pickup hours', view: 'chat' });
  const refreshed = await getProjectRoadmap({ ownerUsername, projectId, store, readContext, now: () => 300 });
  assert.equal(refreshed.assistant_items.length, 2);
  const publicView = publicProjectRoadmap(refreshed);
  assert.equal(publicView.assistant_items, undefined);
  assert.equal(publicView.confirmed_facts, undefined);
  assert.equal(publicView.dependencies, undefined);
});

test('Project Path API is account scoped and returns only the public projection', async () => {
  const calls = [];
  const handler = createForgeRoadmapHandler({ resolveUser: async () => 'signed-in-user', readRoadmap: async input => {
    calls.push(input);
    return reconcileProjectRoadmap({}, context());
  } });
  const res = response();
  await handler({ method: 'GET', query: { projectId } }, res);
  assert.equal(res.code, 200);
  assert.equal(calls[0].ownerUsername, 'signed-in-user');
  assert.ok(Array.isArray(res.body.path));
  assert.equal(res.body.confirmed_facts, undefined);
});

test('saved roadmap context is formatted as operational state, not build permission', () => {
  const turn = conversationTurnForPrompt({ role: 'assistant', text: 'Here is the current direction.', guidance: { checklist: { title: 'Direction', items: [{ label: 'Confirm pricing', state: 'next' }] } } });
  assert.match(turn, /SAVED CHECKLIST/);
  assert.match(turn, /\[next\] Confirm pricing/);
});

test('Nex receives the private roadmap and saves a new checklist back into it', async () => {
  let modelInput;
  let savedChecklist;
  const handler = createAssistantHandler({
    resolveUser: async () => ownerUsername,
    conversations: { getConversation: async () => [], appendTurns: async () => {} },
    searchVaultFn: async () => [],
    readContext: async () => context(),
    readRoadmap: async () => ({ project_id: projectId, confirmed_facts: [{ label: 'Audience', value: 'Local customers' }], best_next_step: { label: 'Choose pickup hours', view: 'chat' } }),
    saveRoadmapChecklist: async input => { savedChecklist = input.checklist; },
    ask: async input => {
      modelInput = input;
      return { text: JSON.stringify({ kind: 'reply', message: 'Let’s lock down pickup.', checklist: { title: 'Pickup flow', items: [{ label: 'Choose pickup hours', state: 'next' }] } }) };
    },
  });
  const res = response();
  await handler({ method: 'POST', body: { projectId, currentHtml: '<h1>Bakery</h1>', message: 'What should we decide next?' } }, res);
  assert.equal(res.code, 200);
  assert.match(JSON.stringify(modelInput), /Local customers/);
  assert.match(JSON.stringify(modelInput), /Choose pickup hours/);
  assert.equal(savedChecklist.items[0].state, 'next');
});
