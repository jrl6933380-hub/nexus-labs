import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('the living visual bridge exposes only named actions through the trusted host', () => {
  const panel = read('../public/pinned-visual-panel.js');
  assert.match(panel, /new Set\(\['open-system','prompt','snapshot','create-task','update-task','approve','reject'\]\)/u);
  assert.match(panel, /event\.isTrusted/u);
  assert.match(panel, /event\.source !== frame\.contentWindow/u);
  assert.match(panel, /window\.confirm/u);
  assert.match(panel, /credentials: 'same-origin'/u);
});

test('the visual action endpoint is owner-authenticated and allowlisted', () => {
  const board = read('../api/board.js');
  const vercel = JSON.parse(read('../vercel.json'));
  assert.match(board, /async function handleNexAction/u);
  assert.match(board, /getNexusOwner\(req\)/u);
  assert.match(board, /verb === 'snapshot'/u);
  assert.match(board, /verb === 'create_task'/u);
  assert.match(board, /verb === 'update_task'/u);
  assert.match(board, /verb === 'approve' \|\| verb === 'reject'/u);
  assert.deepEqual(
    vercel.rewrites.find((rewrite) => rewrite.source === '/api/nex/action'),
    { source: '/api/nex/action', destination: '/api/board' },
  );
});

test('Nex is taught to produce actionable visual controls', () => {
  const rooms = read('../lib/nex/tools/rooms.js');
  assert.match(rooms, /data-nexus-action="prompt"/u);
  assert.match(rooms, /data-nexus-action="create-task"/u);
  assert.match(rooms, /nexus-action-result/u);
});
