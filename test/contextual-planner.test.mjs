import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBriefStore, ensureProjectBrief, saveBriefAnswer, saveBriefAdditionKind, resetProjectBrief, approveProjectBrief, getProjectBrief, publicProjectBrief } from '../lib/forge/projectBrief.js';
import { readProjectContext, connectionsForPlan, approvedAddonInstruction } from '../lib/forge/projectContext.js';
import { createForgeBriefHandler } from '../api/forge-brief.js';
import { createMemoryStore, applyStackRecommendation, ensureStackManifest } from '../lib/forgeStack.js';
import { createAssistantHandler } from '../api/room-assistant.js';

const ownerUsername = 'alice', projectId = 'bakery';
const response = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
async function completeAddon(store) {
  let brief;
  for (const [questionId, values] of [['idea', 'Add customer bookings'], ['placement', 'Book now in the main navigation'], ['features', ['bookings']], ['preserve', 'Keep the menu and colors; visitors can select a time']]) {
    brief = await saveBriefAnswer({ ownerUsername, projectId, mode: 'addon', questionId, values, store });
  }
  return brief;
}

test('add-on interview and resets never overwrite the original project plan', async () => {
  const store = createMemoryBriefStore();
  await saveBriefAnswer({ ownerUsername, projectId, questionId: 'idea', values: 'Original bakery site', store });
  const addon = await completeAddon(store);
  assert.equal(publicProjectBrief(addon).progress.ready, true);
  assert.deepEqual(publicProjectBrief(addon).summary.map(item => item.field), ['idea', 'placement', 'features', 'preserve']);
  await resetProjectBrief({ ownerUsername, projectId, mode: 'addon', store });
  assert.equal((await getProjectBrief({ ownerUsername, projectId, store })).answers.idea, 'Original bakery site');
  assert.equal((await getProjectBrief({ ownerUsername: 'bob', projectId, mode: 'addon', store })), null);
});

test('add-on instructions require explicit approval and edits invalidate approval', async () => {
  const store = createMemoryBriefStore();
  const addon = await completeAddon(store);
  assert.throws(() => approvedAddonInstruction({ project: {}, addonPlan: publicProjectBrief(addon) }), /approve/);
  const approved = await approveProjectBrief({ ownerUsername, projectId, mode: 'addon', store });
  assert.match(approvedAddonInstruction({ project: {}, addonPlan: publicProjectBrief(approved) }), /main navigation/);
  await saveBriefAnswer({ ownerUsername, projectId, mode: 'addon', questionId: 'placement', values: 'Homepage button', store });
  assert.equal((await getProjectBrief({ ownerUsername, projectId, mode: 'addon', store })).approved_at, undefined);
});

test('project context is account scoped and exposes relationships without connection secrets', async () => {
  const reads = [];
  const context = await readProjectContext({ ownerUsername, projectId,
    readProjects: async user => { reads.push(user); return [{ projectId, mainLabel: 'Bakery', latestBuildId: 'build-1', stackItems: [{ kind: 'page', label: 'Menu' }] }]; },
    readBrief: async args => { reads.push(args.ownerUsername); return null; },
    readStack: async args => { reads.push(args.ownerUsername); return { features: ['forms'], slots: { database: { status: 'ready', required: true, provider: 'neon', metadata: { password: 'must-not-appear' } } } }; },
  });
  assert.ok(reads.every(user => user === ownerUsername));
  assert.equal(context.project.pieces[0].label, 'Menu');
  assert.equal(context.connections[0].status, 'ready');
  assert.ok(!JSON.stringify(context).includes('must-not-appear'));
  const needs = connectionsForPlan(context, { answers: { features: ['payments'] } });
  assert.equal(needs.find(item => item.id === 'database').status, 'ready');
  assert.equal(needs.find(item => item.id === 'payments').status, 'not_checked');
  assert.ok(needs.some(item => item.id === 'email'), 'existing form dependencies are retained');
});

function apiHarness(project = { projectId, label: 'Bakery' }, unavailable = []) {
  const store = createMemoryBriefStore();
  const recommended = [];
  const handler = createForgeBriefHandler({ resolveUser: async () => ownerUsername, env: { NEX_QWEN_ONLY: 'true' },
    readContext: async () => ({ project, features: ['forms'], connections: [], unavailable }),
    ensure: args => ensureProjectBrief({ ...args, store }), answer: args => saveBriefAnswer({ ...args, store }),
    chooseAdditionKind: args => saveBriefAdditionKind({ ...args, store }),
    approve: args => approveProjectBrief({ ...args, store }), reset: args => resetProjectBrief({ ...args, store }),
    recommend: async args => recommended.push(args),
  });
  return { store, handler, recommended };
}

test('Add a piece stores its type on the add-on brief without faking a chat answer', async () => {
  const { store, handler } = apiHarness();
  const res = response();
  await handler({ method: 'POST', body: { projectId, mode: 'addon', action: 'choose_addition_kind', additionKind: 'intelligence' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.addition_kind, 'intelligence');
  assert.equal(res.body.next_question.id, 'idea');
  assert.equal(res.body.summary[0].value, 'Intelligence');
  const stored = await getProjectBrief({ ownerUsername, projectId, mode: 'addon', store });
  assert.deepEqual(stored.answers, {});
});

test('the selected addition type and connections adapt the remaining questions', async () => {
  const store = createMemoryBriefStore();
  await saveBriefAdditionKind({ ownerUsername, projectId, additionKind: 'intelligence', store });
  for (const [questionId, values] of [
    ['idea', 'Answer questions from uploaded policies'],
    ['placement', 'Open from the help button'],
    ['features', ['uploads', 'database']],
  ]) await saveBriefAnswer({ ownerUsername, projectId, mode: 'addon', questionId, values, store });
  let brief = await getProjectBrief({ ownerUsername, projectId, mode: 'addon', store });
  assert.equal(publicProjectBrief(brief).next_question.id, 'intelligence_rules');
  await saveBriefAnswer({ ownerUsername, projectId, mode: 'addon', questionId: 'intelligence_rules', values: 'Use approved policies and ask before sending anything', store });
  brief = await getProjectBrief({ ownerUsername, projectId, mode: 'addon', store });
  assert.equal(publicProjectBrief(brief).next_question.id, 'data_rules');
  assert.equal(publicProjectBrief(brief).progress.required, 6);
});

test('add-on API refuses an unsaved project and never silently uses a new-project plan', async () => {
  const { handler } = apiHarness(null);
  const res = response(); await handler({ method: 'GET', query: { projectId, mode: 'addon' } }, res);
  assert.equal(res.code, 409);
});

test('approving an add-on expands its own connection checklist with existing needs', async () => {
  const { store, handler, recommended } = apiHarness();
  await completeAddon(store);
  const res = response(); await handler({ method: 'POST', body: { projectId, mode: 'addon', action: 'approve' } }, res);
  assert.equal(res.code, 200);
  assert.ok(res.body.approved_at);
  assert.equal(recommended[0].ownerUsername, ownerUsername);
  assert.equal(recommended[0].projectId, projectId);
  assert.deepEqual(recommended[0].features, ['forms', 'bookings']);
  assert.equal(recommended[0].preserveRequired, true);
});

test('unavailable connection context blocks approval instead of replacing an unknown checklist', async () => {
  const { store, handler, recommended } = apiHarness({ projectId }, ['connections']);
  await completeAddon(store);
  const res = response(); await handler({ method: 'POST', body: { projectId, mode: 'addon', action: 'approve' } }, res);
  assert.equal(res.code, 503); assert.equal(recommended.length, 0);
});

test('add-on recommendations preserve previous required slots even if not represented by a feature', async () => {
  const store = createMemoryStore();
  const original = await ensureStackManifest({ ownerUsername, projectId, features: ['uploads'], store });
  assert.equal(original.slots.storage.required, true);
  const next = await applyStackRecommendation({ ownerUsername, projectId, features: ['database'], preserveRequired: true, store });
  assert.equal(next.slots.storage.required, true);
  assert.equal(next.slots.database.required, true);
});

test('Nex receives the current project, add-on mode, and server-read connection state', async () => {
  let modelInput;
  const handler = createAssistantHandler({ resolveUser: async () => ownerUsername, conversations: { getConversation: async () => [], appendTurns: async () => {} },
    searchVaultFn: async () => [], readContext: async () => ({ project: { projectId, pieces: [{ label: 'Menu' }] }, connections: [{ id: 'database', status: 'ready' }] }),
    ask: async input => { modelInput = input; return { text: JSON.stringify({ kind: 'reply', message: 'Let us plan the booking addition.' }) }; },
  });
  const res = response(); await handler({ method: 'POST', body: { projectId, currentHtml: '<h1>Bakery</h1>', message: 'What does a booking addition need?' } }, res);
  assert.equal(res.code, 200);
  const text = JSON.stringify(modelInput);
  assert.match(text, /planningMode/); assert.match(text, /addon/); assert.match(text, /database/); assert.match(text, /ready/); assert.match(text, /Menu/);
});

const { readFile } = await import('node:fs/promises');
const vm = await import('node:vm');
const forgeSource = await readFile(new URL('../public/forge.html', import.meta.url), 'utf8');

test('Connections navigation follows whether there is a current project build', () => {
  const nav = { children: [], set innerHTML(value) { this.children = []; }, appendChild(child) { this.children.push(child); } };
  const context = { nav, currentBuild: '', currentView: 'chat', isWorkbench: true,
    WORKBENCH_VIEW_ORDER: ['project', 'stack', 'brief'], FORGE_VIEWS: { project: { icon: 'p' }, stack: { icon: 's' }, brief: { icon: 'b' } },
    WORKBENCH_LABELS: { project: 'Projects', stack: 'Connections', brief: 'Plan' }, VIEW_REQUIRES: { stack: 'stack', brief: 'brief' },
    featureUnlocked: () => true, connectionSnapshot: () => ({}), esc: text => text, showView() {},
    document: { createElement: () => ({ dataset: {} }) },
  };
  vm.createContext(context);
  vm.runInContext(forgeSource.split('function drawNav(){')[1].split('\nfunction bubble(')[0].replace(/^/, 'function drawNav(){') + '\nthis.draw = drawNav;', context);
  context.draw(); assert.ok(!nav.children.some(button => button.dataset.view === 'stack'));
  context.currentBuild = '<h1>Bakery</h1>';
  context.draw(); assert.ok(nav.children.some(button => button.dataset.view === 'stack'));
  context.currentView = 'project'; context.draw(); assert.ok(!nav.children.some(button => button.dataset.view === 'stack'));
});

test('resetting an add-on plan does not clear the existing build or saved build id', async () => {
  const body = forgeSource.split('  resetBrief: async () => {')[1].split('\n  },\n  buildFromBrief:')[0];
  const calls = [];
  const context = { currentBuild: '<h1>Bakery</h1>', latestBuildId: 'build-1', briefAction: async action => calls.push(action), showView: async id => calls.push(id) };
  vm.createContext(context); vm.runInContext('this.reset = async () => {' + body + '\n};', context);
  await context.reset();
  assert.equal(context.currentBuild, '<h1>Bakery</h1>'); assert.equal(context.latestBuildId, 'build-1');
  assert.deepEqual(calls, ['reset', 'brief']);
});
