import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomEscalator } from '../lib/roomEscalation.js';

test('a Forge capability wall creates private context and a real three-lane pipeline', async () => {
  const saved = [];
  const pipelineCalls = [];
  const escalator = createRoomEscalator({
    now: () => 1_700_000_000_000,
    store: {
      async save(id, value) { saved.push({ id, value: structuredClone(value) }); },
      async get() { return null; },
    },
    async startPipeline(input) {
      pipelineCalls.push(input);
      return { id: 'pipeline-1', status: 'lanes_running' };
    },
  });

  const result = await escalator.queue({
    userId: 'alice',
    projectId: 'project-1',
    request: 'Build a booking app with sk-abcdefghijklmnopqrstuvwxyz1234567890',
    reason: 'The instant builder reached its limit.',
    currentHtml: '<!doctype html><html><body>Existing work</body></html>',
  });

  assert.equal(result.pipelineId, 'pipeline-1');
  assert.match(result.message, /Build Team ticket/);
  assert.equal(pipelineCalls.length, 1);
  assert.equal(pipelineCalls[0].layout_agent, 'claude');
  assert.equal(pipelineCalls[0].design_agent, 'chatgpt');
  assert.equal(pipelineCalls[0].reviewer_agent, 'nex');
  assert.match(pipelineCalls[0].acceptance_criteria.join(' '), /private Forge escalation/);
  assert.equal(saved.length, 2);
  assert.doesNotMatch(JSON.stringify(saved), /sk-abcdefghijklmnopqrstuvwxyz1234567890/);
  assert.match(saved[1].value.currentHtml, /Existing work/);
});

test('Forge escalation rejects an invalid project boundary', async () => {
  const escalator = createRoomEscalator({
    store: { async save() {}, async get() { return null; } },
    async startPipeline() { throw new Error('should not run'); },
  });
  await assert.rejects(
    escalator.queue({ userId: 'alice', projectId: '../other-user', request: 'build it' }),
    /valid customer and project/,
  );
});
