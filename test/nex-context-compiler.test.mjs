import test from 'node:test';
import assert from 'node:assert/strict';

import { compileNexContext, dedupeMemories } from '../lib/nexContextCompiler.js';
import { rankMemories } from '../lib/memory.js';

test('context compiler labels provenance, trust, and freshness', () => {
  const compiled = compileNexContext({
    memories: [{ id: 'm1', category: 'project', tags: ['nex'], content: 'Nex uses a Board.' }],
    liveWorkspaceContext: 'Active room: conference',
    snapshot: { snapshot_id: 's1', generated_at: 123, project: { name: 'Nexus' } },
    cognitivePlan: { lane: 'code' },
  });
  assert.match(compiled.text, /provenance=nex:memories/);
  assert.match(compiled.text, /trust=untrusted-live-data/);
  assert.match(compiled.text, /freshness=generated-at-123/);
  assert.match(compiled.text, /id=m1/);
  assert.equal(compiled.manifest.lane, 'code');
  assert.equal(compiled.manifest.sources.length, 4);
});

test('duplicate memories are included only once', () => {
  const memories = [
    { id: 'old', content: 'Use the safe branch.' },
    { id: 'new', content: 'Use   the safe branch!' },
  ];
  assert.deepEqual(dedupeMemories(memories).map((item) => item.id), ['old']);
});

test('the packet and its individual sources are bounded', () => {
  const compiled = compileNexContext({
    memories: [{ id: 'm1', content: 'm'.repeat(20000) }],
    liveWorkspaceContext: 'l'.repeat(20000),
    snapshot: { snapshot_id: 's1', generated_at: 1, data: 's'.repeat(20000) },
    cognitivePlan: { lane: 'chat' },
    maxChars: 5000,
  });
  assert.ok(compiled.text.length <= 5000);
  assert.equal(compiled.manifest.truncated, true);
});

test('memory ranking is bounded and keeps urgent handoff memory first', () => {
  const memories = [
    { id: 'fact', category: 'fact', content: 'The dashboard is blue.', tags: ['dashboard'], created_at: 1 },
    { id: 'project', category: 'project', content: 'Deploy the dashboard safely.', tags: ['deployment'], created_at: 2 },
    { id: 'handoff', category: 'for_claude', content: 'Repair the broken deployment tool.', tags: ['tool'], created_at: 3 },
  ];
  const ranked = rankMemories(memories, 'deployment', 2);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, 'handoff');
  assert.equal(ranked[1].id, 'project');
});
