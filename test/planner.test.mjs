import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerStore } from '../lib/planner.js';

function fakePlannerRedis() {
  const hashes = new Map();
  const strings = new Map();
  return async ([verb, key, ...args]) => {
    const hash = hashes.get(key) || new Map();
    if (verb === 'GET') return strings.get(key) ?? null;
    if (verb === 'SET') { strings.set(key, args[0]); return 'OK'; }
    if (verb === 'HGETALL') return [...hash.entries()].flat();
    if (verb === 'HGET') return hash.get(args[0]) ?? null;
    if (verb === 'HSET') { for (let index = 0; index < args.length; index += 2) hash.set(args[index], args[index + 1]); hashes.set(key, hash); return args.length / 2; }
    if (verb === 'HDEL') return hash.delete(args[0]) ? 1 : 0;
    throw new Error(`Unexpected command: ${verb}`);
  };
}

function testStore(command = fakePlannerRedis()) {
  let clock = 1000;
  let id = 0;
  return createPlannerStore({ command, now: () => clock++, idFactory: () => `plan-${++id}` });
}

test('Schedule creates rich normalized items and lists them chronologically', async () => {
  const store = testStore();
  const later = await store.createPlannerItem({ title: ' Dinner ', starts_at: '2026-10-02T18:00:00-05:00', category: 'family', flexibility: 'flexible', reminder_minutes: 30 });
  const sooner = await store.createPlannerItem({ title: 'Workout', starts_at: '2026-10-01T07:00:00-05:00', ends_at: '2026-10-01T08:00:00-05:00', notes: 'Leg day', category: 'gym', repeat_mode: 'every_week' });
  assert.equal(later.source, 'nex_chat');
  assert.equal(later.status, 'planned');
  assert.equal(later.category, 'family');
  assert.equal(later.flexibility, 'flexible');
  assert.equal(later.reminder_minutes, 30);
  assert.deepEqual((await store.listPlannerItems()).map((item) => item.id), [sooner.id, later.id]);
});

test('Schedule keeps accounts isolated even when item ids match', async () => {
  const store = createPlannerStore({ command: fakePlannerRedis(), now: () => 2000, idFactory: () => 'same-id' });
  await store.createPlannerItem({ title: 'Alpha only', starts_at: '2026-10-01T09:00:00Z' }, 'room:alpha');
  await store.createPlannerItem({ title: 'Beta only', starts_at: '2026-10-01T10:00:00Z' }, 'room:beta');
  assert.deepEqual((await store.listPlannerItems({}, 'room:alpha')).map((item) => item.title), ['Alpha only']);
  assert.deepEqual((await store.listPlannerItems({}, 'room:beta')).map((item) => item.title), ['Beta only']);
});

test('the owner legacy planner migrates once without leaking into customer schedules', async () => {
  const command = fakePlannerRedis();
  await command(['HSET', 'nexus:planner:items:v1', 'old-1', JSON.stringify({ id:'old-1', title:'Old reminder', starts_at:'2026-10-01T09:00:00Z', status:'planned', source:'nex_chat', created_at:100 })]);
  const store = testStore(command);
  const ownerItems = await store.listPlannerItems({}, 'owner:justin', { allowLegacyMigration:true });
  assert.deepEqual(ownerItems.map((item) => item.title), ['Old reminder']);
  assert.deepEqual(await store.listPlannerItems({}, 'room:customer'), []);
});

test('Schedule updates, filters, and deletes one exact item', async () => {
  const store = testStore();
  const item = await store.createPlannerItem({ title: 'Call', starts_at: '2026-10-01T09:00:00Z' });
  const updated = await store.updatePlannerItem({ id: item.id, status: 'done', title: 'Client call', protected: true });
  assert.equal(updated.status, 'done');
  assert.equal(updated.title, 'Client call');
  assert.equal(updated.protected, true);
  assert.equal((await store.listPlannerItems({ status: 'done' })).length, 1);
  assert.equal((await store.deletePlannerItem(item.id)).id, item.id);
  assert.deepEqual(await store.listPlannerItems(), []);
});

test('Schedule overview reports category time and conflicts', async () => {
  const store = testStore();
  await store.createPlannerItem({ title: 'Focus', starts_at: '2026-10-01T09:00:00Z', ends_at: '2026-10-01T11:00:00Z', category: 'work' });
  await store.createPlannerItem({ title: 'Call', starts_at: '2026-10-01T10:30:00Z', ends_at: '2026-10-01T11:30:00Z', category: 'social' });
  const overview = await store.getScheduleOverview();
  assert.equal(overview.summary.category_minutes.work, 120);
  assert.equal(overview.summary.category_minutes.social, 60);
  assert.equal(overview.summary.conflicts.length, 1);
  const preview = await store.previewPlannerItem({ title: 'Overlap preview', starts_at: '2026-10-01T09:30:00Z', ends_at: '2026-10-01T10:15:00Z', category: 'appointment' });
  assert.deepEqual(preview.conflicts.map((item) => item.title), ['Focus']);
});

test('next-week rollover creates an editable draft and preserves history', async () => {
  const store = testStore();
  const original = await store.createPlannerItem({ title: 'Gym', starts_at: '2026-09-28T14:00:00Z', ends_at: '2026-09-28T15:00:00Z', category: 'gym', repeat_mode: 'every_week' });
  const draft = await store.createWeekDraft({ mode: 'normal', source_start: '2026-09-28T00:00:00Z', source_end: '2026-10-05T00:00:00Z', target_start: '2026-10-05T00:00:00Z', target_end: '2026-10-12T00:00:00Z' });
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].status, 'draft');
  assert.equal(draft.items[0].rolled_from_id, original.id);
  assert.equal(draft.items[0].starts_at, '2026-10-05T14:00:00.000Z');
  assert.equal((await store.listPlannerItems()).find((item) => item.id === original.id).status, 'planned');
  const applied = await store.applyWeekDraft(draft.draft_id);
  assert.equal(applied.items[0].status, 'planned');
  assert.equal(applied.items[0].draft_id, null);
});

test('Schedule rejects invalid ranges and unknown structured values', async () => {
  const store = testStore();
  await assert.rejects(() => store.createPlannerItem({ title: 'Bad', starts_at: 'not-a-date' }), /valid date/u);
  await assert.rejects(() => store.createPlannerItem({ title: 'Backwards', starts_at: '2026-10-02T10:00:00Z', ends_at: '2026-10-02T09:00:00Z' }), /before/u);
  await assert.rejects(() => store.createPlannerItem({ title: 'Unknown', starts_at: '2026-10-02T10:00:00Z', source: 'random_app' }), /source/u);
  await assert.rejects(() => store.createPlannerItem({ title: 'Unknown', starts_at: '2026-10-02T10:00:00Z', category: 'doomscrolling' }), /category/u);
});

test('automatic planning spreads sessions, avoids commitments, and saves drafts only', async () => {
  const store = testStore();
  await store.createPlannerItem({title:'Protected work',starts_at:'2026-10-05T09:00:00Z',ends_at:'2026-10-05T11:00:00Z',protected:true}, 'alpha');
  const draft = await store.generateScheduleDraft({
    period_label:'next week',
    windows:[{starts_at:'2026-10-05T09:00:00Z',ends_at:'2026-10-05T13:00:00Z'},{starts_at:'2026-10-06T09:00:00Z',ends_at:'2026-10-06T13:00:00Z'}],
    requests:[{title:'Gym',category:'gym',count:2,minutes:60}],
  }, 'alpha');
  assert.equal(draft.items.length, 2);
  assert.equal(draft.items[0].starts_at, '2026-10-05T11:00:00.000Z');
  assert.equal(draft.items[1].starts_at, '2026-10-06T09:00:00.000Z');
  assert.ok(draft.items.every((item) => item.status === 'draft'));
  assert.equal((await store.listPlannerItems({}, 'alpha')).length, 3);
  assert.deepEqual(await store.listPlannerItems({}, 'beta'), []);
  assert.deepEqual(draft.unplaced, []);
  const applied = await store.applyWeekDraft(draft.draft_id, 'alpha');
  assert.equal(applied.items.length, 2);
});

test('automatic planning reports overflow and rejects invalid windows before writing', async () => {
  const store = testStore();
  const draft = await store.generateScheduleDraft({
    windows:[{starts_at:'2026-10-05T09:00:00Z',ends_at:'2026-10-05T10:00:00Z'}],
    requests:[{title:'Focus',category:'work',count:3,minutes:60}],
  });
  assert.equal(draft.items.length, 1);
  assert.equal(draft.unplaced.length, 2);
  await assert.rejects(() => store.generateScheduleDraft({windows:[{starts_at:'2026-10-05T12:00:00Z',ends_at:'2026-10-05T10:00:00Z'}],requests:[{title:'Bad'}]}), /increasing/);
  assert.equal((await store.listPlannerItems()).length, 1);
  await store.discardWeekDraft(draft.draft_id);
  assert.equal((await store.listPlannerItems()).length, 0);
});
