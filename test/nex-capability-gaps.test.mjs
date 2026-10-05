import test from 'node:test';
import assert from 'node:assert/strict';

import { pageFileContent } from '../lib/github.js';
import { TOOLS } from '../lib/nexBrain.js';
import { formatBuildEvent, formatDeployment } from '../lib/vercel.js';

test('large GitHub files return explicit line-page continuation metadata', () => {
  const source = Array.from({ length: 250 }, (_, index) => `line-${index + 1}`).join('\n');
  const first = pageFileContent(source);

  assert.equal(first.start_line, 1);
  assert.equal(first.end_line, 120);
  assert.equal(first.total_lines, 250);
  assert.equal(first.truncated, true);
  assert.equal(first.next_start_line, 121);
  assert.equal(first.next_start_char, null);

  const second = pageFileContent(source, { start_line: first.next_start_line, end_line: 240 });
  assert.match(second.content, /^line-121/);
  assert.equal(second.next_start_line, 241);
});

test('oversized single lines can continue by absolute character offset', () => {
  const source = 'x'.repeat(15000);
  const first = pageFileContent(source, { max_chars: 6000 });
  assert.equal(first.content.length, 6000);
  assert.equal(first.next_start_char, 6000);
  assert.equal(first.next_start_line, null);

  const second = pageFileContent(source, { start_char: first.next_start_char, max_chars: 6000 });
  assert.equal(second.start_char, 6000);
  assert.equal(second.next_start_char, 12000);
});

test('Nex exposes queue inspection and Vercel read tools with dispatch-safe schemas', () => {
  const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
  for (const name of [
    'direct_story_actor',
    'list_pending_actions',
    'read_pending_action',
    'list_vercel_projects',
    'list_vercel_deployments',
    'get_vercel_build_logs',
    'merge_pull_request',
    'check_deployment_status',
    'test_code',
    'get_reference_link',
    'attach_task_result',
  ]) {
    assert.ok(byName.has(name), `${name} should be exposed`);
  }
  assert.deepEqual(byName.get('read_pending_action').input_schema.required, ['id']);
  assert.deepEqual(byName.get('list_vercel_deployments').input_schema.required, ['project_id']);
  assert.deepEqual(byName.get('get_vercel_build_logs').input_schema.required, ['deployment_id']);
  assert.deepEqual(byName.get('direct_story_actor').input_schema.required, ['panel_index','actor','direction']);
  assert.deepEqual(byName.get('merge_pull_request').input_schema.required, ['owner', 'repo', 'pull_number']);
  assert.deepEqual(byName.get('test_code').input_schema.required, ['language', 'code']);
  assert.deepEqual(byName.get('attach_task_result').input_schema.required, ['id', 'result']);
});

test('Vercel deployment summaries preserve branch, commit, and failure status', () => {
  const deployment = formatDeployment({
    uid: 'dpl_123',
    name: 'nexus-labs',
    state: 'ERROR',
    target: 'production',
    createdAt: 123,
    meta: {
      githubCommitRef: 'main',
      githubCommitSha: 'abc123',
      githubRepo: 'nexus-labs',
      githubOrg: 'jrl6933380-hub',
    },
  });

  assert.equal(deployment.id, 'dpl_123');
  assert.equal(deployment.branch, 'main');
  assert.equal(deployment.commit_sha, 'abc123');
  assert.equal(deployment.failed, true);
  assert.equal(deployment.ready, false);
});

test('Vercel build events normalize nested payload text', () => {
  assert.deepEqual(formatBuildEvent({ type: 'stderr', created: 456, payload: { text: 'build failed' } }), {
    type: 'stderr',
    created_at: 456,
    status_code: null,
    text: 'build failed',
    build_id: null,
  });
});
