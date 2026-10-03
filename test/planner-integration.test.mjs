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
  assert.match(boardApi, /getRequestUser\(req\)/u);
  assert.match(boardApi, /create_week_draft/u);
  assert.match(boardApi, /apply_week_draft/u);
  assert.match(boardApi, /action === 'preview'/u);
});

test('Nex can read and mutate the same planner as the UI', () => {
  assert.match(brain, /\.\.\.PLANNER_TOOLS/u);
  assert.match(brain, /block\.name === 'read_planner'/u);
  assert.match(brain, /block\.name === 'create_planner_item'/u);
  assert.match(categories, /planner: \{/u);
  assert.match(categories, /'read_planner'/u);
});

test('Schedule is reachable from the sidebar and the home card', () => {
  assert.match(workspace, /data-view="planner"/u);
  assert.match(workspace, /\['Open Schedule', 'Time blocks, weeks, and routines', null, 'planner'\]/u);
  assert.match(workspace, /id="ownerBriefBtn"[^>]*>.*What needs me\?/u);
  assert.match(views, /planner: \{/u);
  assert.match(views, /renderScheduleCalendar\(ctx, \{balance:scheduleBalance\}\)/u);
});

test('Schedule offers click-first planning, editable rollover, and Nexus Life entry points', () => {
  assert.match(workspace, /function openScheduleStudio/u);
  assert.match(workspace, /function openWeekStudio/u);
  assert.match(workspace, /function openWeekRollover/u);
  assert.match(workspace, /Apply \$\{period\}/u);
  assert.match(workspace, /Generate my schedule/u);
  assert.match(boardApi, /generate_schedule_draft/u);
  assert.match(workspace, /checkScheduleReminders/u);
  assert.match(views, /renderLife\(ctx\)/u);
});
