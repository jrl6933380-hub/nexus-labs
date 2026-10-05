import test from 'node:test';
import assert from 'node:assert/strict';

import { runNexTrials } from '../lib/nexTrials.js';

test('Nex Trials policy scorecard passes at 100 percent', () => {
  const report = runNexTrials();
  assert.equal(report.failed, 0, JSON.stringify(report.results.filter((item) => !item.passed), null, 2));
  assert.equal(report.score, 100);
  assert.ok(report.total >= 10);
  assert.deepEqual(Object.keys(report.categories).sort(), ['context', 'evidence', 'memory', 'routing']);
});
