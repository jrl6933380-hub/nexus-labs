import test from 'node:test';
import assert from 'node:assert/strict';

import { reviewCrewEvidence, runCrewPreflight } from '../lib/nexCrewExecutor.js';

function roleResult(role, text) {
  return { role, model: `model/${role}`, data: { content: [{ type: 'text', text }] } };
}

test('crew preflight executes scout then architect with grounded handoff', async () => {
  const calls = [];
  const result = await runCrewPreflight({
    message: 'Refactor auth.',
    context: 'api/auth.js exists',
    runRoleFn: async (input) => {
      calls.push(input);
      return roleResult(input.role, input.role === 'scout' ? 'Read api/auth.js first.' : 'Patch, test, inspect diff.');
    },
  });
  assert.deepEqual(calls.map((call) => call.role), ['scout', 'architect']);
  assert.match(calls[1].messages[0].content, /Read api\/auth\.js first/);
  assert.match(result.brief, /Real Brain Crew preflight/);
});

test('independent crew review fails closed on an unclear verdict', async () => {
  const result = await reviewCrewEvidence({
    task: 'Fix auth.', transcript: 'Tests maybe passed.', receipt: { status: 'incomplete' },
    runRoleFn: async () => roleResult('reviewer', 'I am not sure.'),
  });
  assert.equal(result.blocking, true);
  assert.equal(result.verdict, 'unclear');
});

test('crew preflight fails closed when a specialist returns no usable text', async () => {
  await assert.rejects(
    runCrewPreflight({
      message: 'Refactor auth.',
      context: 'api/auth.js exists',
      runRoleFn: async (input) => input.role === 'scout'
        ? { role: 'scout', model: 'model/scout', data: { content: [] } }
        : roleResult('architect', 'Patch and test.'),
    }),
    /scout returned no usable report/,
  );
});
