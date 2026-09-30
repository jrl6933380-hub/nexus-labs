import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [boardApi, brain, categories, config, workspace, views] = await Promise.all([
  readFile(new URL('../api/board.js', import.meta.url), 'utf8'),
  readFile(new URL('../lib/nexBrain.js', import.meta.url), 'utf8'),
  readFile(new URL('../lib/nex/toolCategories.js', import.meta.url), 'utf8'),
  readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  readFile(new URL('../public/workspace.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/workspace-views.js', import.meta.url), 'utf8'),
]);

test('the authenticated planner API is routed through the shared function', () => {
  assert.match(config, /"source": "\/api\/planner"/u);
  assert.match(boardApi, /path\.startsWith\('\/api\/planner'\)/u);
  assert.match(boardApi, /getNexusOwner\(req\)/u);
});

test('Nex can read and mutate the same planner as the UI', () => {
  assert.match(brain, /\.\.\.PLANNER_TOOLS/u);
  assert.match(brain, /block\.name === 'read_planner'/u);
  assert.match(brain, /block\.name === 'create_planner_item'/u);
  assert.match(categories, /planner: \{/u);
  assert.match(categories, /'read_planner'/u);
});

test('Planner is reachable from the sidebar and the home card', () => {
  assert.match(workspace, /data-view="planner"/u);
  assert.match(workspace, /\['Plan my time', 'Days, events, and schedules', null, 'planner'\]/u);
  assert.match(workspace, /id="ownerBriefBtn"[^>]*>.*What needs me\?/u);
  assert.match(views, /planner: \{/u);
  assert.match(views, /getJSON\('\/api\/planner'\)/u);
});
