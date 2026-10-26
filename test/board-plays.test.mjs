import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayStore, buildPlay, playId, PLAY_LIMIT, PLAYS_KEY } from '../lib/boardPlays.js';
import { redactSecrets } from '../lib/secretScan.js';

// Tiny stand-in for the Redis shim: one hash is all the store uses.
function fakeRedis() {
  const hash = new Map();
  const command = async (parts) => {
    const [op, , field, value] = parts;
    if (op === 'HGET') return hash.get(field) ?? null;
    if (op === 'HSET') { hash.set(field, value); return 1; }
    if (op === 'HDEL') return hash.delete(field) ? 1 : 0;
    if (op === 'HLEN') return hash.size;
    if (op === 'HGETALL') return [...hash].flat();
    throw new Error('unexpected command ' + op);
  };
  return { command, hash };
}

const base = { title: 'Wake a fresh Claude session per request', when: 'A customer action should start its own Claude run', steps: ['Make the task', 'Fire it'], author: 'claude' };

test('playId makes a short readable slug and rejects empty titles', () => {
  assert.equal(playId('Wake a Fresh Claude Session!'), 'wake-a-fresh-claude-session');
  assert.throws(() => playId('  !! '), /title/);
});

test('buildPlay cleans lists, caps sizes and lowercases tags', () => {
  const play = buildPlay({ ...base, steps: ['  one  ', '', { text: 'two' }, ...Array(60).fill('x')], tags: ['Routines', 'WAKE'] }, { now: 5, author: 'claude' });
  assert.equal(play.steps.length, 30);
  assert.equal(play.steps[0], 'one');
  assert.deepEqual(play.tags, ['routines', 'wake']);
  assert.equal(play.version, 1);
  assert.equal(play.created_at, 5);
});

test('buildPlay requires a title, a step and a known author', () => {
  assert.throws(() => buildPlay({ steps: ['a'] }, { author: 'claude' }), /title/);
  assert.throws(() => buildPlay({ title: 'Thing', steps: [] }, { author: 'claude' }), /step/);
  assert.throws(() => buildPlay({ title: 'Thing', steps: ['a'] }, { author: 'someone' }), /author/);
});

test('secrets in a play are redacted and flagged, including Anthropic tokens', () => {
  assert.equal(redactSecrets('use sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-bbbb now').redacted, true);
  const play = buildPlay({ ...base, steps: ['Send Bearer abcdefghijklmnopqrstuvwxyz0123 in the header', 'token sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-bbbb'] }, { author: 'claude' });
  assert.ok(play.steps.every((step) => !/abcdefghijklmnop|sk-ant/.test(step)));
  assert.equal(play.secret_check.flagged, true);
});

test('save then read, update keeps created_at and uses and bumps the version', async () => {
  const { command } = fakeRedis();
  let clock = 100;
  const store = createPlayStore(command, { now: () => clock });
  const saved = await store.save(base);
  assert.equal(saved.id, 'wake-a-fresh-claude-session-per-request');
  clock = 200;
  await store.use({ id: saved.id, by: 'chatgpt' });
  clock = 300;
  const updated = await store.save({ id: saved.id, steps: ['Make the task', 'Fire it', 'Check it'], author: 'chatgpt' });
  assert.equal(updated.version, 2);
  assert.equal(updated.created_at, 100);
  assert.equal(updated.uses, 1);
  assert.equal(updated.author, 'claude');
  assert.equal(updated.updated_by, 'chatgpt');
  assert.equal(updated.title, base.title);
  assert.equal((await store.read(saved.id)).steps.length, 3);
});

test('a stale expected_version is refused with 409', async () => {
  const { command } = fakeRedis();
  const store = createPlayStore(command);
  const first = await store.save(base);
  await store.save({ id: first.id, when: 'changed', author: 'chatgpt' });
  await assert.rejects(() => store.save({ id: first.id, steps: ['x'], expected_version: 1, author: 'claude' }), (err) => err.status === 409);
  const ok = await store.save({ id: first.id, steps: ['x'], expected_version: 2, author: 'claude' });
  assert.equal(ok.version, 3);
});

test('list searches by every word and sorts newest change first', async () => {
  const { command } = fakeRedis();
  let clock = 1;
  const store = createPlayStore(command, { now: () => clock++ });
  await store.save({ ...base, tags: ['routines'] });
  await store.save({ title: 'Ship a change the Nexus way', steps: ['Branch', 'PR', 'Wait for merge'], author: 'claude' });
  const all = await store.list();
  assert.equal(all[0].title, 'Ship a change the Nexus way');
  assert.equal((await store.list({ query: 'routines fire' })).length, 1);
  assert.equal((await store.list({ query: 'routines nonsense' })).length, 0);
});

test('use needs a real author, remove deletes, missing ids are 404', async () => {
  const { command, hash } = fakeRedis();
  const store = createPlayStore(command);
  const play = await store.save(base);
  await assert.rejects(() => store.use({ id: play.id, by: 'stranger' }), /author/);
  assert.deepEqual(await store.remove({ id: play.id }), { id: play.id, title: base.title, deleted: true });
  assert.equal(hash.size, 0);
  await assert.rejects(() => store.read(play.id), (err) => err.status === 404);
});

test('the play book has a size limit', async () => {
  const { command, hash } = fakeRedis();
  for (let i = 0; i < PLAY_LIMIT; i += 1) hash.set('p' + i, '{}');
  const store = createPlayStore(command);
  await assert.rejects(() => store.save(base), (err) => err.status === 429);
  assert.equal(PLAYS_KEY, 'nexus:board:plays');
});
