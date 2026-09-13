import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCognitiveDirective,
  planCognitiveRun,
  resolveCognitiveTier,
} from '../lib/nexCognitiveController.js';

test('casual conversation stays on the cheap direct chat path', () => {
  const plan = planCognitiveRun({ message: 'How are you doing today?' });
  assert.equal(plan.lane, 'chat');
  assert.equal(plan.mode, 'direct');
  assert.equal(plan.minimumTier, 'cheap');
  assert.deepEqual(plan.crew, ['nex']);
  assert.deepEqual(plan.requireEvidence, []);
});

test('a normal code change uses the code lane without summoning the full crew', () => {
  const plan = planCognitiveRun({ message: 'Fix the login button component and add a regression test.' });
  assert.equal(plan.lane, 'code');
  assert.equal(plan.mode, 'direct');
  assert.equal(plan.minimumTier, 'standard');
  assert.ok(plan.requireEvidence.includes('source_read'));
  assert.ok(plan.requireEvidence.includes('relevant_tests'));
});

test('complex risky work activates the ordered Brain Crew', () => {
  const plan = planCognitiveRun({
    message: 'Migrate the production auth database, then update tenant permissions and deploy it.',
    toolContext: { deepThoughtRequested: true },
  });
  assert.equal(plan.lane, 'code');
  assert.equal(plan.mode, 'crew');
  assert.equal(plan.risk, 'high');
  assert.deepEqual(plan.crew, ['scout', 'architect', 'implementer', 'reviewer']);
  assert.ok(plan.requireEvidence.includes('explicit_approval_for_gated_action'));
});

test('an explicit council request activates crew mode', () => {
  const plan = planCognitiveRun({ message: 'Have the brain crew give me a second opinion on this architecture.' });
  assert.equal(plan.mode, 'crew');
  assert.ok(plan.reasons.includes('explicit_council'));
});

test('automatic routing respects the plan floor while explicit model choice wins', () => {
  const codePlan = planCognitiveRun({ message: 'Build a new API endpoint.' });
  assert.equal(resolveCognitiveTier('cheap', null, codePlan), 'standard');

  const crewPlan = planCognitiveRun({ message: 'Use multiple models to migrate production auth.' });
  assert.equal(resolveCognitiveTier('standard', null, crewPlan), 'heavy');
  assert.equal(resolveCognitiveTier('cheap', 'cheap', crewPlan), 'cheap');
});

test('the backend directive carries the selected lane contract and evidence gate', () => {
  const directive = formatCognitiveDirective(planCognitiveRun({ message: 'Fix the API test.' }));
  assert.match(directive, /Runtime cognitive plan/);
  assert.match(directive, /Lane: code/);
  assert.match(directive, /source_read/);
  assert.match(directive, /patch_repo_file/);
});
