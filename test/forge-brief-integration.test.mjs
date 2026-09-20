import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [forgeHtml, forgeViews, roomChat] = await Promise.all([
  readFile(new URL('../public/forge.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge-views.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/room-chat.js', import.meta.url), 'utf8'),
]);

test('Forge routes a new customer through the Project Brief before building', () => {
  assert.match(forgeHtml, /brief\?\.next_question\?\.id === 'idea'/);
  assert.match(forgeHtml, /await showView\('brief'\)/);
  assert.match(forgeViews, /Start something new.*ctx\.go\('brief'\)/s);
  assert.match(forgeViews, /Build the first version/);
});

test('question panels support choices, focused comments, and accessible selection state', () => {
  assert.match(forgeViews, /question\.type === 'single_select'/);
  assert.match(forgeViews, /const selected = new Set\(\)/);
  assert.match(forgeViews, /Add a focused note for Nex/);
  assert.match(forgeViews, /aria-pressed/);
  assert.match(forgeViews, /Save and continue/);
});

test('first build reads the approved brief on the server-side account boundary', () => {
  assert.match(roomChat, /getProjectBrief\(\{ ownerUsername: username, projectId: resolvedProjectId \}\)/);
  assert.match(roomChat, /compileBriefForModel/);
  assert.match(roomChat, /Approved Project Brief/);
  assert.match(roomChat, /source of truth/);
});

test('Forge no longer promises an owner-funded fallback brain', () => {
  assert.doesNotMatch(forgeViews, /builds run on Forge's own connection/i);
  assert.doesNotMatch(forgeHtml, /go back to Forge's connection/i);
});
