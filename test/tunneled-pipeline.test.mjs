import test from 'node:test';
import assert from 'node:assert/strict';
import { createTunneledPipelineService } from '../lib/tunneledPipeline.js';

function fakeService() {
  const tasks = new Map(); let number = 0;
  const store = new Map();
  const board = {
    async createTask(input) { const task = { id: `task-${++number}`, status: 'planning', ...input }; tasks.set(task.id, task); return task; },
    async updateProgress({ id, status, note }) { Object.assign(tasks.get(id), { status, last_note: note }); return tasks.get(id); },
    async completeTask({ id, result }) { Object.assign(tasks.get(id), { status: 'complete', result }); return tasks.get(id); },
  };
  return { service: createTunneledPipelineService({ board, store: { get: async (id) => store.get(id) || null, set: async (id, value) => store.set(id, structuredClone(value)) } }), tasks };
}

test('fans out layout and design lanes, then locks reviewer until both have evidence', async () => {
  const { service, tasks } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs', acceptance_criteria: ['mobile works'] });
  assert.equal(run.status, 'lanes_running');
  assert.equal(tasks.size, 3);
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'structure complete', evidence: ['unit test'] });
  assert.equal(tasks.size, 3);
  const ready = await service.submitLaneResult({ pipeline_id: run.id, lane: 'design', summary: 'visual system complete', evidence: ['screenshot'] });
  assert.equal(ready.status, 'reviewing');
  assert.equal(tasks.size, 4);
  assert.match(tasks.get(ready.review_task_id).description, /structure complete/);
});

test('only a passing review creates the final ready-for-Nex handoff', async () => {
  const { service } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs' });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'layout' });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'design', summary: 'design' });
  const blocked = await service.submitReview({ pipeline_id: run.id, decision: 'needs_changes', summary: 'fix contrast', corrections: ['Increase contrast'] });
  assert.equal(blocked.status, 'needs_changes');
  assert.equal(blocked.final_handoff, null);
});

test('passing review returns both lane results and QA evidence to Nex', async () => {
  const { service } = fakeService();
  const run = await service.start({ goal: 'Build a room', owner: 'jrl6933380-hub', repo: 'nexus-labs' });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'layout', summary: 'layout', evidence: ['test'] });
  await service.submitLaneResult({ pipeline_id: run.id, lane: 'design', summary: 'design', evidence: ['preview'] });
  const final = await service.submitReview({ pipeline_id: run.id, decision: 'pass', summary: 'fits together', evidence: ['QA checklist'] });
  assert.equal(final.status, 'ready_for_nex');
  assert.equal(final.final_handoff.review.decision, 'pass');
  assert.equal(final.final_handoff.lanes.design.summary, 'design');
});
