import test from 'node:test';
import assert from 'node:assert/strict';
import {collaborationFixture, credentials, pair} from '../test-support/collaborationFixture.mjs';
const note = (f, who, extra) => f.store.update({...credentials(who), operation: 'note', ...extra});
const check = (f, who, text = 'step done') => f.store.update({...credentials(who), operation: 'checkpoint', text});
test('a note reaches the partner on their very next checkpoint, once', async () => {
  const f = collaborationFixture(), {a, b} = await pair(f);
  const sent = await note(f, b, {text: 'Stop adding outside providers.', note_kind: 'instruction', to: 'chatgpt'});
  assert.deepEqual(sent.inbox, []);
  const got = await check(f, a);
  assert.equal(got.inbox.length, 1);
  assert.equal(got.inbox[0].text, 'Stop adding outside providers.');
  assert.equal(got.inbox[0].from, 'claude');
  assert.equal(got.inbox[0].kind, 'instruction');
  assert.deepEqual((await check(f, a)).inbox, []);
});
test('notes are not echoed to the sender, respect the addressee, and show unread count', async () => {
  const f = collaborationFixture(), {a, b} = await pair(f);
  await note(f, a, {text: 'Claude only', to: 'claude'});
  await note(f, a, {text: 'Everyone', to: 'all'});
  assert.deepEqual((await check(f, a)).inbox, []);
  const read = await f.store.read(credentials(b));
  assert.equal(read.session.unread_notes, 2);
  const got = await check(f, b);
  assert.deepEqual(got.inbox.map(n => n.text), ['Claude only', 'Everyone']);
  assert.equal((await f.store.read(credentials(b))).session.unread_notes, 0);
  assert.equal(got.session.members.find(m => m.agent === 'claude').read_seq >= got.inbox[1].seq, true);
});
test('a waiting partner wakes on a note and receives it', async () => {
  const f = collaborationFixture(), {a, b} = await pair(f);
  const cursor = (await f.store.read(credentials(a))).session.seq;
  f.onWait(() => note(f, b, {text: 'Review ready', note_kind: 'question', to: 'chatgpt'}));
  const woke = await f.store.wait({...credentials(a), after_seq: cursor, wait_ms: 5000});
  assert.equal(woke.timed_out, false);
  assert.equal(woke.inbox[0].text, 'Review ready');
  assert.equal(woke.inbox[0].kind, 'question');
});
test('note validation rejects empty text, bad kinds, self-addressing, and strangers', async () => {
  const f = collaborationFixture(), {a} = await pair(f);
  await assert.rejects(note(f, a, {text: '   '}), {status: 400});
  await assert.rejects(note(f, a, {text: 'x', note_kind: 'order'}), {status: 400});
  await assert.rejects(note(f, a, {text: 'x', to: 'chatgpt'}), {status: 400});
  await assert.rejects(note(f, a, {text: 'x', to: 'someone'}), {status: 400});
  await assert.rejects(f.store.update({session_id: a.session.id, member_id: a.membership.member_id, member_token: 'x'.repeat(20), operation: 'note', text: 'hi'}), {status: 403});
});
