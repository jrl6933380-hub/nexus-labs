import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LANES,
  laneFor,
  modelForRole,
  contractFor,
  parseReviewVerdict,
  runRole,
  GROUNDING_CONTRACT,
  WRITE_CONTRACT,
} from '../lib/nexLanes.js';

test('the reviewer is a different model family from the implementer', () => {
  // A model reviewing its own output re-derives its own blind spot and
  // reports agreement. Cross-family review is the whole point of the role.
  const implementer = modelForRole('implementer');
  const reviewer = modelForRole('reviewer');
  assert.notEqual(implementer.split('/')[0], reviewer.split('/')[0]);
});

test('role models are env-overridable without a deploy', () => {
  assert.equal(
    modelForRole('reviewer', { NEX_ROLE_REVIEWER_MODEL: 'meta/llama-3.3-70b-instruct' }),
    'meta/llama-3.3-70b-instruct'
  );
  assert.equal(modelForRole('scout', {}), 'google/gemini-2.5-flash');
});

test('an unknown role falls back to responder rather than crashing', () => {
  assert.equal(modelForRole('nonsense', {}), modelForRole('responder', {}));
});

test('the chat lane cannot write to the repo; the code lane can', () => {
  assert.equal(laneFor('chat').canWrite, false);
  assert.equal(laneFor('code').canWrite, true);
});

test('every lane starts with the scout, so grounding precedes opinion', () => {
  for (const id of Object.keys(LANES)) {
    assert.equal(laneFor(id).crew[0], 'scout');
  }
});

test('the code lane ends with the reviewer, after the implementer', () => {
  const { crew } = laneFor('code');
  assert.equal(crew[crew.length - 1], 'reviewer', 'review must be the final gate');
  assert.ok(crew.indexOf('implementer') < crew.indexOf('reviewer'));
});

test('lane ids are case-insensitive but unknown lanes are rejected', () => {
  assert.equal(laneFor('CODE').id, 'code');
  assert.throws(() => laneFor('deploy'), /Unknown lane/);
  assert.throws(() => laneFor(''), /Unknown lane/);
});

test('only writing lanes receive the write contract', () => {
  const code = contractFor('code');
  const chat = contractFor('chat');
  assert.ok(code.includes(WRITE_CONTRACT));
  assert.ok(code.includes(GROUNDING_CONTRACT));
  assert.ok(chat.includes(GROUNDING_CONTRACT));
  assert.ok(!chat.includes(WRITE_CONTRACT));
});

test('the grounding contract forbids describing unread files', () => {
  // Phrasing matters here: a soft preference loses to confident recall.
  assert.match(GROUNDING_CONTRACT, /have NOT been shown/);
  assert.match(GROUNDING_CONTRACT, /do not describe its contents/);
});

test('the write contract steers away from whole-file rewrites', () => {
  assert.match(WRITE_CONTRACT, /patch_repo_file/);
  assert.match(WRITE_CONTRACT, /Do NOT use update_file/);
});

test('an explicit verdict is honored in both directions', () => {
  assert.equal(parseReviewVerdict('Looks correct.\nVERDICT: APPROVE').blocking, false);
  assert.equal(parseReviewVerdict('Deletes 900 lines.\nVERDICT: BLOCK').blocking, true);
});

test('review FAILS CLOSED: anything unparseable blocks', () => {
  // An unreadable review must never read as consent, or a malformed
  // response becomes the cheapest way to bypass the check entirely.
  for (const text of ['', 'Seems fine to me!', 'I approve of this change', null, undefined, 'VERDICT: MAYBE']) {
    assert.equal(parseReviewVerdict(text).blocking, true, `"${text}" must not approve`);
  }
});

test('review FAILS CLOSED: a reply containing both verdicts blocks', () => {
  const result = parseReviewVerdict('VERDICT: APPROVE\nOn reflection, no.\nVERDICT: BLOCK');
  assert.equal(result.blocking, true);
});

test('verdict parsing tolerates case and spacing', () => {
  assert.equal(parseReviewVerdict('verdict : approve').verdict, 'approve');
});

test('runRole sends to the role-assigned model and returns its output', async () => {
  const calls = [];
  const result = await runRole({
    role: 'reviewer',
    system: 'review this',
    messages: [{ role: 'user', content: 'diff' }],
    env: {},
    routeFn: async (args) => {
      calls.push(args);
      return { data: { content: [{ type: 'text', text: 'VERDICT: BLOCK' }] } };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, modelForRole('reviewer', {}));
  assert.equal(result.role, 'reviewer');
  assert.equal(result.data.content[0].text, 'VERDICT: BLOCK');
});

test('runRole surfaces a delegation failure instead of silently degrading', async () => {
  // No fallback chain is deliberate: a review that quietly ran on a
  // substitute model still carries the authority of a review.
  await assert.rejects(
    runRole({
      role: 'reviewer',
      messages: [{ role: 'user', content: 'diff' }],
      env: {},
      routeFn: async () => { throw new Error('model unavailable'); },
    }),
    /model unavailable/
  );
});

test('runRole rejects malformed input rather than sending an empty request', async () => {
  await assert.rejects(() => runRole({ role: 'scout', messages: [], env: {} }), /at least one message/);
  await assert.rejects(() => runRole({ messages: [{ role: 'user', content: 'x' }], env: {} }), /requires a role/);
});
