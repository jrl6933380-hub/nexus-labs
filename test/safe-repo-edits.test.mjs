import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { applyExactReplacements, assertSafeFileReplacement, findCatastrophicDiffs } from '../lib/github.js';
import { TOOLS } from '../lib/nexBrain.js';

test('PR 172-style destructive replacement is blocked server-side', () => {
  const existing = Array.from({ length: 1600 }, (_, index) => `<section id="line-${index}">working feature</section>`).join('\n');
  const replacement = Array.from({ length: 300 }, (_, index) => `<section id="mock-${index}">static shell</section>`).join('\n');

  assert.throws(
    () => assertSafeFileReplacement(existing, replacement, { path: 'public/room.html' }),
    /SAFE_REPLACEMENT_BLOCKED.*1600 to 300 lines.*patch_repo_file/s,
  );
});

test('normal full-file edits that preserve the file are allowed', () => {
  const existing = `${'const stable = true;\n'.repeat(800)}old label`;
  const replacement = existing.replace('old label', 'new label');
  const metrics = assertSafeFileReplacement(existing, replacement, { path: 'app.js' });
  assert.ok(metrics.after_lines >= metrics.before_lines - 1);
});

test('exact patching preserves content the model never loaded', () => {
  const unseenPrefix = 'preserve me\n'.repeat(500);
  const source = `${unseenPrefix}<button>Old</button>\n${'preserve me too\n'.repeat(500)}`;
  const patched = applyExactReplacements(source, [
    { find: '<button>Old</button>', replace: '<button>New</button>', expected_occurrences: 1 },
  ]);
  assert.ok(patched.startsWith(unseenPrefix));
  assert.match(patched, /<button>New<\/button>/);
  assert.equal(patched.split('preserve me too').length, source.split('preserve me too').length);
});

test('exact patching fails closed on missing or ambiguous source', () => {
  assert.throws(
    () => applyExactReplacements('same same', [{ find: 'same', replace: 'new' }]),
    /expected 1 exact match\(es\), found 2/,
  );
  assert.throws(
    () => applyExactReplacements('current', [{ find: 'stale', replace: 'new' }]),
    /found 0/,
  );
});

test('PR 172-style diff is flagged before a pull request can open', () => {
  const flagged = findCatastrophicDiffs([
    { filename: 'public/room.html', status: 'modified', additions: 237, deletions: 1314, changes: 1551 },
    { filename: 'small.js', status: 'modified', additions: 4, deletions: 3, changes: 7 },
  ]);
  assert.deepEqual(flagged, [
    { path: 'public/room.html', additions: 237, deletions: 1314, changes: 1551 },
  ]);
});

test('large balanced refactors are not mislabeled as catastrophic deletion', () => {
  assert.deepEqual(findCatastrophicDiffs([
    { filename: 'refactor.js', status: 'modified', additions: 900, deletions: 1000, changes: 1900 },
  ]), []);
});

test('Nex exposes and dispatches the safe patch tool', async () => {
  const patchTool = TOOLS.find((tool) => tool.name === 'patch_repo_file');
  const inspectTool = TOOLS.find((tool) => tool.name === 'inspect_branch_diff');
  assert.ok(patchTool);
  assert.ok(inspectTool);
  assert.deepEqual(patchTool.input_schema.required, ['owner', 'repo', 'path', 'branch', 'replacements']);
  assert.match(patchTool.description, /preserves all unseen content server-side/i);

  const brainSource = await readFile(new URL('../lib/nexBrain.js', import.meta.url), 'utf8');
  assert.match(brainSource, /block\.name === 'patch_repo_file'/);
  assert.match(brainSource, /patch_repo_file only edits non-live branches/);
  assert.match(brainSource, /block\.name === 'inspect_branch_diff'/);
});
