import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectBrief, answerProjectBrief, publicProjectBrief, compileBriefForModel, createMemoryBriefStore, ensureProjectBrief, saveBriefAnswer, getProjectBrief, approveProjectBrief } from '../lib/forge/projectBrief.js';
const make = () => createProjectBrief({ ownerUsername: 'alice', projectId: 'adaptive' });
const answer = (brief, id, values) => answerProjectBrief(brief, { questionId: id, values });
const next = brief => publicProjectBrief(brief).next_question?.id;

function personal() {
  const brief = make();
  answer(brief, 'idea', 'A calculator just for me to compare freelance jobs');
  answer(brief, 'project_type', 'personal_tool');
  return brief;
}

test('simple personal tool finishes in five relevant questions and reaches builder', () => {
  const brief = personal();
  assert.equal(next(brief), 'workflow');
  answer(brief, 'workflow', 'Enter hours and rate, compare net earnings per job');
  answer(brief, 'features', ['none']);
  assert.equal(next(brief), 'success');
  answer(brief, 'success', 'Compare three jobs on one screen using my own expense formula');
  const result = publicProjectBrief(brief);
  assert.equal(result.progress.required, 5);
  assert.equal(result.progress.ready, true);
  assert.equal(result.summary.some(item => item.field === 'content_ready'), false);
  assert.match(compileBriefForModel(brief), /my own expense formula/);
  assert.match(compileBriefForModel(brief), /Just me \(from your description\)/);
});

test('shared tools confirm audience instead of assuming personal ownership', () => {
  const brief = make();
  answer(brief, 'idea', 'A tool for my team');
  answer(brief, 'project_type', 'personal_tool');
  assert.equal(next(brief), 'audience');
  answer(brief, 'audience', 'members');
  answer(brief, 'workflow', 'Track assigned tasks');
  answer(brief, 'features', ['accounts', 'database']);
  assert.equal(next(brief), 'data_rules');
  assert.match(publicProjectBrief(brief).next_question.helper, /who can read or change/);
});

test('intelligence scopes real inputs, knowledge, permissions and privacy', () => {
  const brief = make();
  answer(brief, 'idea', 'An AI assistant for myself to study uploaded notes');
  assert.match(publicProjectBrief(brief).next_question.question, /intelligence/);
  answer(brief, 'project_type', 'intelligence');
  assert.match(publicProjectBrief(brief).next_question.question, /take in/);
  answer(brief, 'workflow', 'Upload notes and ask questions with citations');
  answer(brief, 'features', ['uploads', 'database']);
  assert.equal(next(brief), 'intelligence_rules');
  answer(brief, 'intelligence_rules', 'Only my notes; ask before sending anything; judge accuracy against citations');
  assert.equal(next(brief), 'data_rules');
  answer(brief, 'data_rules', 'Private notes; delete them on request');
  answer(brief, 'success', 'Correctly cite my test notes');
  assert.equal(publicProjectBrief(brief).progress.ready, true);
  assert.match(compileBriefForModel(brief), /ask before sending/);
  assert.match(compileBriefForModel(brief), /delete them on request/);
});

test('transaction features deepen the plan; removing them removes irrelevant followups', () => {
  const brief = personal();
  answer(brief, 'project_type', 'app');
  answer(brief, 'workflow', 'Take payment for appointments');
  answer(brief, 'features', ['payments']);
  assert.equal(next(brief), 'operating_rules');
  const longer = publicProjectBrief(brief).progress.required;
  answer(brief, 'operating_rules', 'No double bookings; refundable deposits');
  answer(brief, 'features', ['none']);
  assert.equal(next(brief), 'success');
  assert.equal(publicProjectBrief(brief).progress.required, longer - 1);
  assert.equal(brief.answers.operating_rules, undefined);
});

test('unknown ideas ask for clarification; websites retain visual and content decisions', () => {
  const brief = make();
  answer(brief, 'idea', 'Something useful');
  assert.equal(next(brief), 'project_type');
  answer(brief, 'project_type', 'business_website');
  answer(brief, 'audience', 'local_customers');
  answer(brief, 'workflow', 'Read our menu and phone us');
  answer(brief, 'features', ['hours']);
  assert.equal(next(brief), 'style');
  answer(brief, 'style', 'warm');
  assert.equal(next(brief), 'content');
});

test('changing starting idea invalidates stale decisions and approval', () => {
  const brief = personal();
  answer(brief, 'workflow', 'Calculate');
  answer(brief, 'features', ['none']);
  answer(brief, 'success', 'Correct calculation');
  brief.approved_at = 1;
  answer(brief, 'idea', 'A public online store');
  assert.deepEqual(brief.answers, { idea: 'A public online store' });
  assert.equal(brief.approved_at, undefined);
  assert.equal(next(brief), 'project_type');
  assert.equal(compileBriefForModel(brief), '');
});

test('rejects invalid choices and mutually exclusive none without changing the plan', () => {
  const brief = personal();
  assert.throws(() => answer(brief, 'features', ['none', 'database']), /not both/);
  assert.throws(() => answer(brief, 'features', ['invented']), /listed answer/);
  assert.equal(brief.answers.features, undefined);
});

test('adaptive answers persist, unfinished plan cannot approve, and completed plan can', async () => {
  const store = createMemoryBriefStore();
  const input = { ownerUsername: 'alice', projectId: 'one', store };
  await saveBriefAnswer({ ...input, questionId: 'idea', values: 'A calculator for myself' });
  await assert.rejects(approveProjectBrief(input), /Complete/);
  for (const [questionId, values] of [['project_type', 'personal_tool'], ['workflow', 'Add expenses'], ['features', ['none']], ['success', 'Correct totals']]) {
    await saveBriefAnswer({ ...input, questionId, values });
  }
  await approveProjectBrief(input);
  const saved = await getProjectBrief(input);
  assert.ok(saved.approved_at);
  assert.equal(publicProjectBrief(saved).progress.ready, true);
});

test('saved version-one interviews and existing addition flow keep their questions', () => {
  const legacy = make(); legacy.version = 1;
  assert.equal(publicProjectBrief(legacy).progress.required, 7);
  const addon = createProjectBrief({ ownerUsername: 'alice', mode: 'addon' });
  answer(addon, 'idea', 'Add a calculator for myself');
  assert.equal(next(addon), 'placement');
  assert.equal(publicProjectBrief(addon).progress.required, 4);
});


test('unfinished legacy interviews adopt adaptive questions without losing saved answers', async () => {
  const store = createMemoryBriefStore();
  const brief = make(); brief.version = 1;
  brief.answers = { idea: 'A tool for myself', project_type: 'app', primary_goals: ['submit'] };
  await store.set('nexus:forge:brief:alice', 'adaptive', brief);
  const updated = await ensureProjectBrief({ ownerUsername: 'alice', projectId: 'adaptive', store });
  assert.equal(updated.version, 2);
  assert.equal(next(updated), 'workflow');
  assert.deepEqual(updated.answers.primary_goals, ['submit']);
  assert.ok(publicProjectBrief(updated).summary.some(item => item.value === 'Send information'));
});
