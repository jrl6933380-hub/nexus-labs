import test from 'node:test';
import assert from 'node:assert/strict';
import { createTunneledPipelineService } from '../lib/tunneledPipeline.js';

// A fake GitHub that records calls and never touches the network. Lanes now
// run a real tool loop against these, so every test that calls start() with a
// delegate needs one.
function fakeGithub(overrides = {}) {
  const calls = [];
  const record = (name) => (input) => { calls.push({ name, input }); return { ok: true, name, ...input }; };
  return {
    calls,
    createBranch: record('createBranch'),
    searchCode: record('searchCode'),
    readFile: async (input) => { calls.push({ name: 'readFile', input }); return { path: input.path, content: 'existing content' }; },
    patchFile: async (input) => { calls.push({ name: 'patchFile', input }); return { path: input.path, committed: true }; },
    createOrUpdateFile: async (input) => { calls.push({ name: 'createOrUpdateFile', input }); return { path: input.path, committed: true }; },
    inspectBranchDiff: record('inspectBranchDiff'),
    createPullRequest: async (input) => { calls.push({ name: 'createPullRequest', input }); return { html_url: 'https://github.com/o/r/pull/7', number: 7 }; },
    ...overrides,
  };
}

function fakeService(delegate, github = fakeGithub()) {
  const tasks = new Map(); let number = 0;
  const store = new Map();
  const board = {
    async createTask(input) { const task = { id: `task-${++number}`, status: 'planning', ...input }; tasks.set(task.id, task); return task; },
    async updateProgress({ id, status, note }) { Object.assign(tasks.get(id), { status, last_note: note }); return tasks.get(id); },
    async completeTask({ id, result }) { Object.assign(tasks.get(id), { status: 'complete', result }); return tasks.get(id); },
  };
  const opts = {
    board,
    store: { get: async (id) => store.get(id) || null, set: async (id, value) => store.set(id, structuredClone(value)) },
    github,
    env: {},
  };
  if (delegate) opts.delegate = delegate;
  return { service: createTunneledPipelineService(opts), tasks, github };
}

// A delegate that performs a realistic minimal build: write a file, then open
// a PR, then stop. This is what a healthy lane looks like.
function buildingDelegate({ onModel } = {}) {
  return async ({ model, body }) => {
    if (onModel) onModel(model, body);
    const turn = body.messages.length;
    if (turn === 1) {
      return { data: { content: [
        { type: 'text', text: 'Creating the page.' },
        { type: 'tool_use', id: 'tu1', name: 'create_repo_file', input: { path: 'public/site.html', content: '<h1>hi</h1>' } },
      ] } };
    }
    if (turn === 3) {
      return { data: { content: [
        { type: 'tool_use', id: 'tu2', name: 'create_pull_request', input: { title: 'Add site' } },
      ] } };
    }
    return { data: { content: [{ type: 'text', text: 'Build complete.' }] } };
  };
}

test('solo is the default: start() creates one build lane, not a layout/design split', async () => {
  const { service, tasks } = fakeService(buildingDelegate());
  const run = await service.start({ goal: 'Build a room', owner: 'o', repo: 'r', acceptance_criteria: ['mobile works'] });
  assert.equal(run.mode, 'solo');
  assert.deepEqual(Object.keys(run.lane_task_ids), ['build']);
  // parent + single build lane + reviewer gate == 3 (dual mode would be 4)
  assert.equal(tasks.size, 3);
  assert.equal(run.status, 'reviewing');
  assert.equal(tasks.get(run.lane_task_ids.build).status, 'complete');
});

test('a solo lane only completes on real evidence, and reports the real PR link', async () => {
  const { service } = fakeService(buildingDelegate());
  const run = await service.start({ goal: 'Build a room', owner: 'o', repo: 'r' });
  const evidence = run.lanes.build.evidence.join(' ');
  assert.match(evidence, /pull request: https:\/\/github\.com\/o\/r\/pull\/7/);
  assert.match(evidence, /branch: nex\/lane-build-/);
  // The old fabricated-evidence string must never come back.
  assert.doesNotMatch(evidence, /auto-delegated/);
});

test('a lane that only talks is blocked as unverifiable, and settles the parent task too', async () => {
  const allTalk = async () => ({ data: { content: [{ type: 'text', text: 'I would build a lovely site.' }] } });
  const { service, tasks } = fakeService(allTalk);
  const run = await service.start({ goal: 'Build a room', owner: 'o', repo: 'r' });
  assert.equal(run.status, 'lanes_running');
  assert.equal(tasks.get(run.lane_task_ids.build).status, 'blocked');
  assert.match(tasks.get(run.lane_task_ids.build).last_note, /no verifiable work/);
  // The parent must not sit on 'building' forever — that caused dead
  // pipelines to look live and get relaunched.
  assert.equal(tasks.get(run.parent_task_id).status, 'blocked');
});

test('ask_helper_model routes to a different model and feeds the answer back to the builder', async () => {
  const seen = [];
  const delegate = async ({ model, body }) => {
    seen.push(model);
    // Check the model FIRST: the helper call is a fresh conversation whose
    // message count collides with the builder's first turn.
    if (model === 'openai/gpt-5') {
      return { data: { content: [{ type: 'text', text: 'Use one column on mobile.' }] } };
    }
    const turn = body.messages.length;
    if (turn === 1) {
      return { data: { content: [{ type: 'tool_use', id: 'h1', name: 'ask_helper_model', input: { question: 'Two columns or one?' } }] } };
    }
    if (turn === 3) {
      return { data: { content: [{ type: 'tool_use', id: 'h2', name: 'create_repo_file', input: { path: 'public/site.html', content: '<h1>one column</h1>' } }] } };
    }
    if (turn === 5) {
      return { data: { content: [{ type: 'tool_use', id: 'h3', name: 'create_pull_request', input: { title: 'Add site' } }] } };
    }
    return { data: { content: [{ type: 'text', text: 'Done.' }] } };
  };
  const { service } = fakeService(delegate);
  const run = await service.start({ goal: 'Build a room', owner: 'o', repo: 'r' });
  assert.ok(seen.includes('anthropic/claude-sonnet-4.5'), 'builder model used');
  assert.ok(seen.includes('openai/gpt-5'), 'helper model is a different model');
  assert.equal(run.status, 'reviewing');
});

test('a failing delegate blocks the lane with the real error instead of throwing', async () => {
  const delegate = async () => { throw new Error('All configured reasoning providers are temporarily unavailable.'); };
  const { service, tasks } = fakeService(delegate);
  const run = await service.start({ goal: 'Build a room', owner: 'o', repo: 'r' });
  assert.equal(run.status, 'lanes_running');
  assert.equal(tasks.get(run.lane_task_ids.build).status, 'blocked');
  assert.match(tasks.get(run.lane_task_ids.build).last_note, /temporarily unavailable/);
});

test('dual mode still fans out, and locks the reviewer until both lanes have evidence', async () => {
  const { service, tasks } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'o', repo: 'r', mode: 'dual', acceptance_criteria: ['mobile works'] });
  assert.equal(run.status, 'lanes_running');
  assert.equal(tasks.size, 3);
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'structure complete', evidence: ['unit test'] });
  assert.equal(tasks.size, 3, 'reviewer stays locked after only one lane');
  const ready = await service.submitLaneResult({ pipeline_id: run.id, lane: 'design', summary: 'visual system complete', evidence: ['screenshot'] });
  assert.equal(ready.status, 'reviewing');
  assert.equal(tasks.size, 4);
  assert.match(tasks.get(ready.review_task_id).description, /structure complete/);
});

test('start() rejects an unknown mode rather than silently picking one', async () => {
  const { service } = fakeService();
  await assert.rejects(
    () => service.start({ goal: 'Build a room', owner: 'o', repo: 'r', mode: 'triple' }),
    /mode must be/,
  );
});

test('only a passing review creates the final ready-for-Nex handoff', async () => {
  const { service, tasks } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'o', repo: 'r', mode: 'dual' });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'layout' });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'design', summary: 'design' });
  const blocked = await service.submitReview({ pipeline_id: run.id, decision: 'needs_changes', summary: 'fix contrast', corrections: ['Increase contrast'] });
  assert.equal(blocked.status, 'lanes_running');
  assert.equal(blocked.final_handoff, null);
  assert.equal(blocked.review_task_id, null);
  assert.equal(tasks.get(blocked.lane_task_ids.layout).status, 'building');
  assert.match(tasks.get(blocked.lane_task_ids.design).last_note, /Increase contrast/);
});

test('passing review returns lane results and QA evidence to Nex', async () => {
  const { service } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'o', repo: 'r', mode: 'dual' });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'layout', evidence: ['test'] });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'design', summary: 'design', evidence: ['preview'] });
  const final = await service.submitReview({ pipeline_id: run.id, decision: 'pass', summary: 'fits together', evidence: ['QA checklist'] });
  assert.equal(final.status, 'ready_for_nex');
  assert.equal(final.final_handoff.review.decision, 'pass');
  assert.equal(final.final_handoff.lanes.design.summary, 'design');
});
