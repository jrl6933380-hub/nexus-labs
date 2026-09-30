import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerStore } from '../lib/planner.js';

function fakePlannerRedis() {
  const hash = new Map();
  return async ([verb, key, ...args]) => {
    assert.equal(key, 'nexus:planner:items:v1');
    if (verb === 'HGETALL') return [...hash.entries()].flat();
    if (verb === 'HGET') return hash.get(args[0]) ?? null;
    if (verb === 'HSET') { hash.set(args[0], args[1]); return 1; }
    if (verb === 'HDEL') return hash.delete(args[0]) ? 1 : 0;
    throw new Error(`Unexpected command: ${verb}`);
  };
}

test('planner creates normalized items and lists them chronologically', async () => {
  let clock = 1000;
  const store = createPlannerStore({ command: fakePlannerRedis(), now: () => clock++, idFactory: (() => { let id = 0; return () => `plan-${++id}`; })() });
  const later = await store.createPlannerItem({ title: ' Dinner ', starts_at: '2026-10-02T18:00:00-05:00' });
  const sooner = await store.createPlannerItem({ title: 'Workout', starts_at: '2026-10-01T07:00:00-05:00', notes: 'Leg day' });
  assert.equal(later.source, 'nex_chat');
  assert.equal(later.status, 'planned');
  assert.deepEqual((await store.listPlannerItems()).map((item) => item.id), [sooner.id, later.id]);
});

test('planner updates, filters, and deletes one exact item', async () => {
  const store = createPlannerStore({ command: fakePlannerRedis(), now: () => 2000, idFactory: () => 'plan-1' });
  await store.createPlannerItem({ title: 'Call', starts_at: '2026-10-01T09:00:00Z' });
  const updated = await store.updatePlannerItem({ id: 'plan-1', status: 'done', title: 'Client call' });
  assert.equal(updated.status, 'done');
  assert.equal(updated.title, 'Client call');
  assert.equal((await store.listPlannerItems({ status: 'done' })).length, 1);
  assert.equal((await store.deletePlannerItem('plan-1')).id, 'plan-1');
  assert.deepEqual(await store.listPlannerItems(), []);
});

test('planner rejects invalid ranges and unknown sync sources', async () => {
  const store = createPlannerStore({ command: fakePlannerRedis(), idFactory: () => 'plan-1' });
  await assert.rejects(() => store.createPlannerItem({ title: 'Bad', starts_at: 'not-a-date' }), /valid date/u);
  await assert.rejects(() => store.createPlannerItem({ title: 'Backwards', starts_at: '2026-10-02T10:00:00Z', ends_at: '2026-10-02T09:00:00Z' }), /before/u);
  await assert.rejects(() => store.createPlannerItem({ title: 'Unknown', starts_at: '2026-10-02T10:00:00Z', source: 'random_app' }), /source/u);
});
