import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGoalId, parseSteps, appendCheckpoint, addOwnerNote, toggleStep,
  claimConflict, taskProgress, buildDashboard, CHECKPOINT_LIMIT, NOTE_LIMIT,
} from '../lib/boardGoals.js';

test('parseGoalId reads the first line only', () => {
  assert.equal(parseGoalId('goal: g-123\nrest'), 'g-123');
  assert.equal(parseGoalId('GOAL:abc-def'), 'abc-def');
  assert.equal(parseGoalId('notes\ngoal: g-123'), null);
  assert.equal(parseGoalId(''), null);
});

test('parseSteps reads checkbox lines', () => {
  const steps = parseSteps('intro\n- [ ] one\n- [x] two\n* [X] three\nplain');
  assert.deepEqual(steps, [{ text: 'one', done: false }, { text: 'two', done: true }, { text: 'three', done: true }]);
});

test('appendCheckpoint records changes, skips repeats, caps length', () => {
  const task = { owner: 'claude', status: 'planning' };
  appendCheckpoint(task, { status: 'building', note: 'started', at: 1 });
  appendCheckpoint(task, { status: 'building', at: 2 });
  assert.equal(task.checkpoints.length, 1);
  assert.equal(task.checkpoints[0].by, 'claude');
  for (let i = 0; i < 50; i += 1) appendCheckpoint(task, { status: 'building', note: `n${i}`, at: i });
  assert.equal(task.checkpoints.length, CHECKPOINT_LIMIT);
});

test('addOwnerNote validates and caps', () => {
  const task = {};
  assert.throws(() => addOwnerNote(task, { text: '  ' }));
  for (let i = 0; i < 30; i += 1) addOwnerNote(task, { text: `note ${i}` });
  assert.equal(task.owner_notes.length, NOTE_LIMIT);
  assert.equal(task.owner_notes[0].from, 'justin');
});

test('toggleStep flips and rejects bad index', () => {
  const task = { steps: [{ text: 'a', done: false }] };
  toggleStep(task, 0);
  assert.equal(task.steps[0].done, true);
  assert.throws(() => toggleStep(task, 3));
});

test('claimConflict protects other agents tasks', () => {
  assert.match(claimConflict({ owner: 'chatgpt', status: 'building' }, 'claude'), /chatgpt/);
  assert.equal(claimConflict({ owner: 'chatgpt', status: 'building' }, 'claude', true), null);
  assert.equal(claimConflict({ owner: 'claude', status: 'building' }, 'claude'), null);
  assert.equal(claimConflict({ owner: null, status: 'idle' }, 'claude'), null);
  assert.equal(claimConflict({ owner: 'chatgpt', status: 'complete' }, 'claude'), null);
});

test('taskProgress for goals, steps and plain tasks', () => {
  const kids = [{ status: 'complete' }, { status: 'building' }];
  assert.equal(taskProgress({ kind: 'goal' }, kids).percent, 50);
  assert.equal(taskProgress({ steps: [{ done: true }, { done: true }, { done: false }] }).done, 2);
  assert.equal(taskProgress({ status: 'complete' }).percent, 100);
  assert.equal(taskProgress({ status: 'idle' }).percent, 0);
});

test('buildDashboard groups children under goals and lists who is working on what', () => {
  const tasks = [
    { id: 'g-1', kind: 'goal', title: 'Big goal', status: 'planning', owner: null },
    { id: 't-1', title: 'A', description: 'goal: g-1', status: 'complete', owner: 'claude' },
    { id: 't-2', title: 'B', goal_id: 'g-1', status: 'building', owner: 'chatgpt' },
    { id: 't-3', title: 'Loose', description: 'goal: missing', status: 'idle', owner: null },
  ];
  const agents = [{ id: 'nex', display_name: 'Nex', status: 'online' }];
  const view = buildDashboard(tasks, agents, 1000);
  assert.equal(view.goals.length, 1);
  assert.equal(view.goals[0].tasks.length, 2);
  assert.equal(view.goals[0].progress.percent, 50);
  assert.deepEqual(view.loose.map((t) => t.id), ['t-3']);
  const chatgpt = view.people.find((p) => p.id === 'chatgpt');
  assert.equal(chatgpt.working_on[0].id, 't-2');
  assert.equal(view.people.find((p) => p.id === 'nex').name, 'Nex');
  assert.equal(view.counts.unclaimed, 1);
});
