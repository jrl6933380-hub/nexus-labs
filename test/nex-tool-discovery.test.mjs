import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_TOOL_NAMES,
  TOOL_RESULT_REPORTING_POLICY,
  TOOLS,
  formatNexExchangeLogSummary,
  inferPreloadedToolCategories,
  initialToolChoiceForRequest,
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

test('explicit room navigation must execute open_room instead of answering from context', () => {
  assert.deepEqual(initialToolChoiceForRequest('Open the Conference Room'), {
    type: 'tool',
    name: 'open_room',
  });
});

test('an explicit visual request must execute render_visual', () => {
  assert.deepEqual(initialToolChoiceForRequest('Render a visual plan and pin it in the conference room'), {
    type: 'tool',
    name: 'render_visual',
  });
});

test('a natural request to show a system breakdown uses the universal visual workspace', () => {
  const request = 'Show me the Forge broken down into sections and where we could upgrade';
  assert.ok(inferPreloadedToolCategories(request).includes('rooms'));
  assert.deepEqual(initialToolChoiceForRequest(request), {
    type: 'tool',
    name: 'render_visual',
  });
});

test('explicit repository listing must execute list_repos', () => {
  assert.deepEqual(initialToolChoiceForRequest('List every repository under my account'), {
    type: 'tool',
    name: 'list_repos',
  });
});

test('an explicit but broader action requires some real tool call', () => {
  assert.deepEqual(initialToolChoiceForRequest('Inspect the code and fix this bug'), { type: 'any' });
});

test('casual chat does not trigger semantic discovery or preload unrelated tools', () => {
  assert.deepEqual(inferPreloadedToolCategories('yo, how are you doing?'), []);
  assert.equal(initialToolChoiceForRequest('yo, how are you doing?'), null);
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
