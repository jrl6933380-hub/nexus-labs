import test from 'node:test';
import assert from 'node:assert/strict';
import { createTunneledPipelineService } from '../lib/tunneledPipeline.js';

function fakeService(delegate) {
  const tasks = new Map(); let number = 0;
  const store = new Map();
  const board = {
    async createTask(input) { const task = { id: `task-${++number}`, status: 'planning', ...input }; tasks.set(task.id, task); return task; },
    async updateProgress({ id, status, note }) { Object.assign(tasks.get(id), { status, last_note: note }); return tasks.get(id); },
    async completeTask({ id, result }) { Object.assign(tasks.get(id), { status: 'complete', result }); return tasks.get(id); },
  };
  const opts = { board, store: { get: async (id) => store.get(id) || null, set: async (id, value) => store.set(id, structuredClone(value)) } };
  if (delegate) opts.delegate = delegate;
  opts.env = {};
  return { service: createTunneledPipelineService(opts), tasks };
}

test('defaults to a single build lane, then locks reviewer until it has evidence', async () => {
  const { service, tasks } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs', acceptance_criteria: ['mobile works'] });
  assert.equal(run.status, 'lanes_running');
  assert.equal(run.split, false);
  assert.equal(tasks.size, 2, 'parent + build lane only -- no automatic second lane');
  const ready = await service.submitLaneResult({ pipeline_id: run.id, lane: 'build', summary: 'site complete', evidence: ['screenshot'] });
  assert.equal(ready.status, 'reviewing');
  assert.equal(tasks.size, 3);
  assert.match(tasks.get(ready.review_task_id).description, /site complete/);
});

test('split:true still fans out real layout and design lanes, then locks reviewer until both have evidence', async () => {
  const { service, tasks } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs', split: true, acceptance_criteria: ['mobile works'] });
  assert.equal(run.status, 'lanes_running');
  assert.equal(run.split, true);
  assert.equal(tasks.size, 3);
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'structure complete', evidence: ['unit test'] });
  assert.equal(tasks.size, 3);
  const ready = await service.submitLaneResult({ pipeline_id: run.id, lane: 'design', summary: 'visual system complete', evidence: ['screenshot'] });
  assert.equal(ready.status, 'reviewing');
  assert.equal(tasks.size, 4);
  assert.match(tasks.get(ready.review_task_id).description, /structure complete/);
});

test('only a passing review creates the final ready-for-Nex handoff (single build lane)', async () => {
  const { service, tasks } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs' });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'build', summary: 'build' });
  const blocked = await service.submitReview({ pipeline_id: run.id, decision: 'needs_changes', summary: 'fix contrast', corrections: ['Increase contrast'] });
  assert.equal(blocked.status, 'lanes_running');
  assert.equal(blocked.final_handoff, null);
  assert.equal(blocked.review_task_id, null);
  assert.equal(tasks.get(blocked.lane_task_ids.build).status, 'building');
  assert.match(tasks.get(blocked.lane_task_ids.build).last_note, /Increase contrast/);
});

test('only a passing review creates the final ready-for-Nex handoff (split lanes)', async () => {
  const { service, tasks } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs', split: true });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'layout' });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'design', summary: 'design' });
  const blocked = await service.submitReview({ pipeline_id: run.id, decision: 'needs_changes', summary: 'fix contrast', corrections: ['Increase contrast'] });
  assert.equal(blocked.status, 'lanes_running');
  assert.equal(blocked.final_handoff, null);
  assert.equal(blocked.review_task_id, null);
  assert.equal(tasks.get(blocked.lane_task_ids.layout).status, 'building');
  assert.match(tasks.get(blocked.lane_task_ids.design).last_note, /Increase contrast/);
});

test('passing review returns both lane results and QA evidence to Nex', async () => {
  const { service } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs', split: true });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'layout', evidence: ['test'] });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'design', summary: 'design', evidence: ['preview'] });
  const final = await service.submitReview({ pipeline_id: run.id, decision: 'pass', summary: 'fits together', evidence: ['QA checklist'] });
  assert.equal(final.status, 'ready_for_nex');
  assert.equal(final.final_handoff.review.decision, 'pass');
  assert.equal(final.final_handoff.lanes.design.summary, 'design');
});

test('start() auto-delegates both lanes to the injected model and reaches reviewing with no manual submit', async () => {
  const calls = [];
  const delegate = async ({ model, body }) => {
    calls.push(model);
    const isLayout = body.messages[0].content.includes('Own structure');
    return { data: { content: [{ type: 'text', text: isLayout ? 'layout done via model' : 'design done via model' }] } };
  };
  const { service, tasks } = fakeService(delegate);
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((m) => m === 'anthropic/claude-sonnet-4.5'));
  assert.equal(run.status, 'reviewing');
  assert.equal(run.lanes.layout.summary, 'layout done via model');
  assert.equal(run.lanes.design.summary, 'design done via model');
  assert.match(run.lanes.layout.evidence[0], /auto-delegated to anthropic\/claude-sonnet-4\.5/);
  assert.equal(tasks.get(run.lane_task_ids.layout).status, 'complete');
});

test('a failing delegate blocks the lane task with the real error instead of throwing, leaving manual pickup intact', async () => {
  const delegate = async () => { throw new Error('All configured reasoning providers are temporarily unavailable.'); };
  const { service, tasks } = fakeService(delegate);
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs' });
  assert.equal(run.status, 'lanes_running');
  assert.equal(tasks.get(run.lane_task_ids.layout).status, 'blocked');
  assert.match(tasks.get(run.lane_task_ids.layout).last_note, /temporarily unavailable/);
  const ready = await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'manual pickup works', evidence: ['manual'] });
  assert.equal(ready.status, 'lanes_running');
  assert.equal(ready.lanes.layout.summary, 'manual pickup works');
});
