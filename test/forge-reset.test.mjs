import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForge, CONFIRM, PATTERNS } from '../lib/forgeReset.js';

function fakeRedis(store) {
  const calls = [];
  const command = async parts => {
    calls.push(parts); const [op, ...a] = parts;
    if (op === 'HLEN') return store.leads ?? 0;
    if (op === 'DEL') { let n = 0; for (const k of a) if (k in store.keys) { delete store.keys[k]; n++; } if (a[0] === 'nexus:forge:leads') { store.leads = 0; return 1; } return n; }
    if (op === 'SCAN') { const re = new RegExp('^' + a[2].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '.*') + '$'); return ['0', Object.keys(store.keys).filter(k => re.test(k))]; }
    throw Error('unexpected ' + op);
  };
  return { command, calls };
}
test('refuses without the typed confirmation and touches nothing', async () => {
  const r = fakeRedis({ leads: 3, keys: {} });
  await assert.rejects(resetForge({ confirm: 'yes' }, { command: r.command }), /Type RESET FORGE/);
  assert.equal(r.calls.length, 0);
});
test('clears leads, jobs, missions and receipts and nothing else', async () => {
  const store = { leads: 4, keys: {
    'nexus:forge-lead-jobs:v1:own:abc': 1, 'nexus:forge-lead-jobs:v1:own:index': 1, 'nexus:forge-lead-jobs:v1:own:result:abc': 1,
    'nexus:forge-missions:v1:own:active': 1, 'nexus:forge:research:receipts:own': 1,
    'nexus:forge:roadmap:x': 1, 'nexus:forge:brief:x': 1, 'nexus:forge:model-routes': 1, 'nexus:forge:stack:x': 1, 'user:login:jr': 1 } };
  const r = fakeRedis(store);
  const out = await resetForge({ confirm: CONFIRM }, { command: r.command });
  assert.deepEqual(out, { cleared: { leads: 4, jobsMissionsAndReceipts: 5 } });
  assert.deepEqual(Object.keys(store.keys).sort(), ['nexus:forge:brief:x', 'nexus:forge:model-routes', 'nexus:forge:roadmap:x', 'nexus:forge:stack:x', 'user:login:jr']);
  assert.equal(PATTERNS.length, 3);
});
