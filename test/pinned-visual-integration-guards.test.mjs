import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('render_visual is discoverable, policy-checked, and dispatched', () => {
  const rooms = read('../lib/nex/tools/rooms.js');
  const categories = read('../lib/nex/toolCategories.js');
  const registry = read('../lib/nexToolRegistry.js');
  const brain = read('../lib/nexBrain.js');
  assert.match(rooms, /name: 'render_visual'/u);
  assert.match(categories, /'render_visual'/u);
  assert.match(registry, /'render_visual'/u);
  assert.match(brain, /block\.name === 'render_visual'/u);
});

test('pinned visual API stays behind owner auth and the shared Vercel function', () => {
  const board = read('../api/board.js');
  const vercel = JSON.parse(read('../vercel.json'));
  assert.match(board, /getNexusOwner\(req\)/u);
  assert.match(board, /path\.startsWith\('\/api\/pinned-visuals'\)/u);
  assert.deepEqual(
    vercel.rewrites.find((rewrite) => rewrite.source === '/api/pinned-visuals'),
    { source: '/api/pinned-visuals', destination: '/api/board' },
  );
});

test('the iframe permits scripts but does not grant same-origin access', () => {
  const panel = read('../public/pinned-visual-panel.js');
  assert.match(panel, /sandbox="allow-scripts"/u);
  assert.doesNotMatch(panel, /allow-same-origin/u);
  assert.match(panel, /referrerpolicy="no-referrer"/u);
});
