import test from 'node:test';
import assert from 'node:assert/strict';

import {
  budgetForTier,
  looksComplete,
  stripRepeatedPrefix,
  continuationMessages,
  MAX_CONTINUATION_ROUNDS,
} from '../lib/forge/brainProviders.js';

// --- tier budgets ----------------------------------------------------------

test('the free tier asks for less, because its models can deliver less', () => {
  const free = budgetForTier('free');
  const strong = budgetForTier('strong');
  assert.ok(free.maxTokens < strong.maxTokens);
  assert.equal(free.compact, true, 'free must also be told to scope down');
  assert.equal(strong.compact, false);
});

test('an unknown tier falls back to the safe paid budget rather than throwing', () => {
  const budget = budgetForTier('nonsense');
  assert.ok(budget.maxTokens > 0);
});

// --- completion ------------------------------------------------------------

test('completion is the closing tag, not the model going quiet', () => {
  assert.equal(looksComplete('<html><body>hi</body></html>'), true);
  assert.equal(looksComplete('<html><body>hi</body>'), false);
  assert.equal(looksComplete('<html><body>hi</body></HTML >'), true, 'casing and spacing tolerated');
});

// --- seams -----------------------------------------------------------------

test('a continuation that restarts the document is discarded', () => {
  const accumulated = '<!DOCTYPE html><html><body>one';
  const next = '<!DOCTYPE html><html><body>one two three';
  assert.equal(stripRepeatedPrefix(accumulated, next), '');
});

test('an overlapping seam is trimmed', () => {
  const accumulated = '<div class="hero"><h1>Welcome to the store</h1>';
  const next = '<h1>Welcome to the store</h1><p>Now open</p>';
  assert.equal(stripRepeatedPrefix(accumulated, next), '<p>Now open</p>');
});

test('a clean continuation passes through untouched', () => {
  assert.equal(stripRepeatedPrefix('<div class="hero">', '<h1>Hi</h1></div>'), '<h1>Hi</h1></div>');
});

test('a mid-token seam is preserved rather than mangled', () => {
  assert.equal(stripRepeatedPrefix('<div class="con', 'tainer">rest</div>'), 'tainer">rest</div>');
});

test('an empty continuation is safe', () => {
  assert.equal(stripRepeatedPrefix('<html>', ''), '');
});

// --- continuation request --------------------------------------------------

test('the partial document is handed back as the model own prior turn', () => {
  const messages = continuationMessages([{ role: 'user', content: 'build it' }], '<html><body>');
  assert.equal(messages.length, 3);
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, '<html><body>', 'passed back verbatim so the seam is clean');
  assert.match(messages[2].content, /Continue the document/);
  assert.match(messages[2].content, /[Dd]o not repeat/);
});

test('there is a hard round cap', () => {
  assert.ok(MAX_CONTINUATION_ROUNDS >= 2 && MAX_CONTINUATION_ROUNDS <= 6,
    'must allow real continuation but never unbounded looping on a customer credit');
});

// --- the round loop --------------------------------------------------------
// Mirrors continuedStream's decision logic against simulated upstream rounds.

function runRounds(rounds) {
  let accumulated = '';
  let round = 1;
  const emitted = [];
  const requests = [];
  for (const current of rounds) {
    let roundText = '';
    for (let text of current.chunks) {
      if (round > 1 && !roundText) {
        text = stripRepeatedPrefix(accumulated, text);
        if (!text) continue;
      }
      roundText += text;
      accumulated += text;
      emitted.push(text);
    }
    const truncated = current.finish === 'max_tokens';
    const canContinue = truncated && !looksComplete(accumulated) && round < MAX_CONTINUATION_ROUNDS;
    if (!canContinue) {
      return {
        doc: emitted.join(''),
        rounds: round,
        requests,
        stop: looksComplete(accumulated) ? 'stop' : (current.finish || 'stop'),
      };
    }
    round += 1;
    requests.push(continuationMessages([{ role: 'user', content: 'build' }], accumulated));
  }
  return { doc: emitted.join(''), rounds: round, requests, stop: 'stop' };
}

test('a build split across rounds reassembles into one clean document', () => {
  const out = runRounds([
    { chunks: ['<!DOCTYPE html><html><body><h1>Store', '</h1>'], finish: 'max_tokens' },
    { chunks: ['<p>Open daily</p></body></html>'], finish: 'stop' },
  ]);
  assert.equal(out.doc, '<!DOCTYPE html><html><body><h1>Store</h1><p>Open daily</p></body></html>');
  assert.equal(out.stop, 'stop', 'a build completed across rounds must NOT report truncation');
});

test('a model that restarts mid-build does not produce a duplicated page', () => {
  const out = runRounds([
    { chunks: ['<!DOCTYPE html><html><body>one'], finish: 'max_tokens' },
    { chunks: ['<!DOCTYPE html><html><body>one'], finish: 'max_tokens' },
    { chunks: ['<p>real continuation</p></body></html>'], finish: 'stop' },
  ]);
  assert.equal((out.doc.match(/<!DOCTYPE/gi) || []).length, 1, 'exactly one doctype survives');
  assert.match(out.doc, /real continuation/);
});

test('a model that never closes the document stops at the cap and still reports truncation', () => {
  const out = runRounds(Array.from({ length: 8 }, () => ({ chunks: ['<div>more</div>'], finish: 'max_tokens' })));
  assert.equal(out.rounds, MAX_CONTINUATION_ROUNDS);
  assert.equal(out.stop, 'max_tokens', 'a genuinely unfinished build must still be rejected downstream');
});

test('a build that finishes in one round costs no extra request', () => {
  const out = runRounds([{ chunks: ['<html><body>done</body></html>'], finish: 'stop' }]);
  assert.equal(out.rounds, 1);
  assert.equal(out.requests.length, 0);
});

test('a document completed despite a max_tokens stop is not continued', () => {
  const out = runRounds([
    { chunks: ['<html><body>hi</body></html>'], finish: 'max_tokens' },
    { chunks: ['SHOULD NOT APPEAR'], finish: 'stop' },
  ]);
  assert.ok(!out.doc.includes('SHOULD NOT APPEAR'));
  assert.equal(out.stop, 'stop');
});
