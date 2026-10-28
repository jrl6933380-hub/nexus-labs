import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentTasks, fixtureFor} from '../lib/nexusLabAgentTasks.js';
import {createWorkspaceService, WORKSPACE_WRITES, WORKSPACE_ACTIONS} from '../lib/workspaceConnector.js';
import {WORKSPACE_TOOLS} from '../lib/workspaceBoard.js';

function memory() {
  const hashes = new Map();
  return async ([op, key, ...a]) => {
    if (op === 'HGET') return hashes.get(key)?.get(a[0]) ?? null;
    if (op === 'HVALS') return [...(hashes.get(key)?.values() || [])];
    if (op === 'HSET') { const h = hashes.get(key) || new Map(); for (let i = 0; i < a.length; i += 2) h.set(a[i], a[i + 1]); hashes.set(key, h); return 1; }
    if (op === 'HDEL') { a.forEach(f => hashes.get(key)?.delete(f)); return 1; }
    throw new Error('unexpected ' + op);
  };
}
const owner = {id: 'owner-1', workbenchUserId: 'wb', scheduleUserId: 'owner:owner-1', owner: true};
const customer = {...owner, id: 'cust', owner: false};

test('lab tools are declared, owner-flagged writes, and match their actions', () => {
  const labTools = WORKSPACE_TOOLS.filter(t => t[1].startsWith('lab_'));
  assert.deepEqual(labTools.map(t => t[0]).sort(), ['claim_nexus_lab_task', 'complete_nexus_lab_task', 'list_nexus_lab_tasks', 'start_nexus_lab_selftest']);
  for (const t of labTools) assert.equal(t[4], WORKSPACE_WRITES.has(t[1]), t[0]);
  for (const t of labTools) for (const f of Object.keys(t[3])) if (f !== 'request_id') assert.ok(WORKSPACE_ACTIONS[t[1]].includes(f));
});
test('owner runs a full self-test through the connector and gets the image inline', async () => {
  const labTasks = createAgentTasks({command: memory()});
  const run = createWorkspaceService({labTasks});
  const {task} = await run('lab_selftest', {capability: 'detect'}, owner);
  const claimed = await run('lab_claim', {task_id: task.id}, owner);
  assert.equal(claimed.inline_images[0].mime, 'image/png');
  assert.equal(claimed.image_png_base64, undefined);
  const truth = fixtureFor(task.id, 'detect').truth;
  const out = {detections: truth.boxes.map(b => ({asset_id: 'fixture-image', label: b.label + ' rectangle', box: b.box}))};
  const bad = run('lab_complete', {task_id: task.id, claim_token: claimed.claim_token, output: {detections: [{asset_id: 'x'}]}}, owner);
  await assert.rejects(bad, {status: 422});
  const done = await run('lab_complete', {task_id: task.id, claim_token: claimed.claim_token, output: out}, owner);
  assert.equal(done.task.status, 'done'); assert.ok(done.task.score > 0.99);
  const listed = await run('lab_tasks', {}, owner);
  assert.equal(listed.readiness.detect.passed, true); assert.equal(listed.tasks.length, 1);
  assert.equal(JSON.stringify(listed).includes(claimed.claim_token), false);
});
test('customers cannot use Lab tasks', async () => {
  const run = createWorkspaceService({labTasks: createAgentTasks({command: memory()})});
  for (const [a, i] of [['lab_tasks', {}], ['lab_selftest', {capability: 'detect'}], ['lab_claim', {task_id: 'abcdefgh'}]])
    await assert.rejects(run(a, i, customer), {status: 403});
});
