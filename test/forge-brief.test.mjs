import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryBriefStore,
  ensureProjectBrief,
  saveBriefAnswer,
  resetProjectBrief,
  publicProjectBrief,
  compileBriefForModel,
} from '../lib/forge/projectBrief.js';
import { createForgeBriefHandler } from '../api/forge-brief.js';

async function completeBrief(store, ownerUsername = 'alice', projectId = 'default') {
  const answers = [
    ['idea', 'A warm neighborhood restaurant site'],
    ['project_type', 'business_website'],
    ['primary_goals', ['learn', 'book']],
    ['audience', 'local_customers'],
    ['style', 'warm'],
    ['content', ['logo', 'hours']],
    ['features', ['forms', 'hours']],
  ];
  let brief;
  for (const [questionId, values] of answers) {
    brief = await saveBriefAnswer({ ownerUsername, projectId, questionId, values, store });
  }
  return brief;
}

test('brief advances one adaptive question at a time and becomes ready', async () => {
  const store = createMemoryBriefStore();
  let brief = await ensureProjectBrief({ ownerUsername: 'alice', projectId: 'restaurant', store });
  assert.equal(publicProjectBrief(brief).next_question.id, 'idea');

  brief = await saveBriefAnswer({
    ownerUsername: 'alice', projectId: 'restaurant', questionId: 'idea',
    values: 'A restaurant website', store,
  });
  assert.equal(publicProjectBrief(brief).next_question.id, 'project_type');

  brief = await completeBrief(store, 'alice', 'restaurant');
  const result = publicProjectBrief(brief);
  assert.equal(result.progress.ready, true);
  assert.equal(result.progress.percent, 100);
  assert.equal(result.next_question, null);
});

test('feature options adapt to the selected project type', async () => {
  const store = createMemoryBriefStore();
  let brief = await ensureProjectBrief({ ownerUsername: 'alice', store });
  for (const [questionId, values] of [
    ['idea', 'A scheduling product'], ['project_type', 'booking'],
    ['primary_goals', ['book']], ['audience', 'local_customers'],
    ['style', 'clean'], ['content', ['nothing']],
  ]) {
    brief = await saveBriefAnswer({ ownerUsername: 'alice', questionId, values, store });
  }
  const next = publicProjectBrief(brief).next_question;
  assert.equal(next.id, 'features');
  assert.ok(next.options.some((option) => option.value === 'reminders'));
  assert.ok(next.options.some((option) => option.value === 'payments'));
});

test('briefs are isolated by customer and project', async () => {
  const store = createMemoryBriefStore();
  await saveBriefAnswer({ ownerUsername: 'alice', projectId: 'one', questionId: 'idea', values: 'Alice one', store });
  const otherProject = await ensureProjectBrief({ ownerUsername: 'alice', projectId: 'two', store });
  const otherCustomer = await ensureProjectBrief({ ownerUsername: 'bob', projectId: 'one', store });
  assert.equal(otherProject.answers.idea, undefined);
  assert.equal(otherCustomer.answers.idea, undefined);
});

test('compiled brief is only available after required answers are complete', async () => {
  const store = createMemoryBriefStore();
  const partial = await saveBriefAnswer({ ownerUsername: 'alice', questionId: 'idea', values: 'A site', store });
  assert.equal(compileBriefForModel(partial), '');
  const complete = await completeBrief(store);
  const prompt = compileBriefForModel(complete);
  assert.match(prompt, /warm neighborhood restaurant/i);
  assert.match(prompt, /Local customers/);
  assert.match(prompt, /Warm and welcoming/);
});

test('reset removes prior answers', async () => {
  const store = createMemoryBriefStore();
  await saveBriefAnswer({ ownerUsername: 'alice', questionId: 'idea', values: 'Old idea', store });
  const reset = await resetProjectBrief({ ownerUsername: 'alice', store });
  assert.deepEqual(reset.answers, {});
  assert.equal(publicProjectBrief(reset).next_question.id, 'idea');
});

function responseRecorder() {
  return {
    code: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('API scopes brief reads and writes to the signed-in customer', async () => {
  const calls = [];
  const handler = createForgeBriefHandler({
    resolveUser: async () => 'signed-in-user',
    ensure: async (input) => {
      calls.push(input);
      return { version: 1, owner: input.ownerUsername, project_id: input.projectId, status: 'interviewing', answers: {}, comments: {} };
    },
  });
  const res = responseRecorder();
  await handler({ method: 'GET', query: { projectId: 'my-app' } }, res);
  assert.equal(res.code, 200);
  assert.equal(calls[0].ownerUsername, 'signed-in-user');
  assert.equal(calls[0].projectId, 'my-app');
  assert.equal(res.body.project_id, 'my-app');
});

test('API refuses unauthenticated access', async () => {
  const handler = createForgeBriefHandler({ resolveUser: async () => null });
  const res = responseRecorder();
  await handler({ method: 'GET', query: {} }, res);
  assert.equal(res.code, 401);
});
