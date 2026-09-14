import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_TOOL_NAMES,
  TOOL_RESULT_REPORTING_POLICY,
  TOOLS,
  formatNexExchangeLogSummary,
  inferPreloadedToolCategories,
  normalizeHybridSystemPrompt,
} from '../lib/nexBrain.js';

test('obvious coding work is preloaded before the model has to search', () => {
  assert.deepEqual(
    inferPreloadedToolCategories('List my repos and inspect the GitHub code on a branch'),
    ['coding'],
  );
});

test('room navigation receives room tools on the first model call', () => {
  assert.deepEqual(
    inferPreloadedToolCategories('Take me to the conference room'),
    ['rooms'],
  );
});

test('casual chat does not trigger semantic discovery or preload unrelated tools', () => {
  assert.deepEqual(inferPreloadedToolCategories('yo, how are you doing?'), []);
});

test('rolling-context logging is backend managed, not a core reasoning-loop tool', () => {
  assert.equal(CORE_TOOL_NAMES.has('log_exchange'), false);
  assert.ok(TOOLS.some((tool) => tool.name === 'log_exchange'), 'manual repair capability stays registered');
});

test('substantive tool results are explicitly required in the final reply', () => {
  assert.match(TOOL_RESULT_REPORTING_POLICY, /report the substantive result/iu);
  assert.match(TOOL_RESULT_REPORTING_POLICY, /log_exchange is never the requested outcome/iu);
});

test('legacy prompt instructions cannot send logging back into the reasoning loop', () => {
  const legacy = [
    'before',
    '## Automatic exchange logging — call log_exchange after every reply.',
    '## Tool search: most tools are hidden and must be searched before every use.',
    'after',
  ].join('\n');
  const normalized = normalizeHybridSystemPrompt(legacy);
  assert.doesNotMatch(normalized, /call log_exchange after every reply/iu);
  assert.match(normalized, /backend records rolling context after the substantive reply/iu);
  assert.match(normalized, /obvious categories are preloaded by the backend/iu);
});

test('automatic rolling-context summary is bounded and preserves both sides', () => {
  const summary = formatNexExchangeLogSummary('Open the dashboard room', 'Opened /dashboard successfully.');
  assert.match(summary, /Justin asked: Open the dashboard room/);
  assert.match(summary, /Nex answered: Opened \/dashboard successfully\./);

  const bounded = formatNexExchangeLogSummary('x'.repeat(5000), 'y'.repeat(5000));
  assert.ok(bounded.length < 2000);
});
