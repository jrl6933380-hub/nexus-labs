import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [forge, views, assistant] = await Promise.all([
  readFile(new URL('../public/forge.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge-views.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/room-assistant.js', import.meta.url), 'utf8'),
]);

test('Add a piece opens the selected project in the planner instead of injecting chat', () => {
  assert.match(views, /\['Add a piece', 'add-piece'\]/);
  assert.match(forge, /destination === 'add-piece' \? 'brief'/);
  assert.match(views, /What are you adding to this project\?/);
  assert.match(views, /ctx\.chooseAdditionKind\('page'\)/);
  assert.match(views, /ctx\.chooseAdditionKind\('tool'\)/);
  assert.match(views, /ctx\.chooseAdditionKind\('intelligence'\)/);
});

test('Edit with Nex requests project-aware choices and renders clicks as injected replies', () => {
  assert.match(forge, /Show me relevant editing options/);
  assert.match(forge, /decision\.suggestions/);
  assert.match(forge, /askNex\(suggestion\.prompt, \{ displayMessage: suggestion\.label \}\)/);
  assert.match(assistant, /concrete, relevant choices for the current project/);
});

test('Nex can offer a skippable planner and render a bounded checklist in chat', () => {
  assert.match(forge, /decision\.planner/);
  assert.match(forge, /ctx\.openGuidedPlanner/);
  assert.match(forge, /chat-checklist/);
  assert.match(assistant, /Keep it to 3-7 short items/);
  assert.match(assistant, /never authorizes a build/);
});

test('Workbench exposes the stable Project Path only for an opened project', () => {
  assert.match(forge, /WORKBENCH_VIEW_ORDER = \['project', 'live', 'roadmap', 'stack', 'brief'\]/);
  assert.match(forge, /showView\(currentBuild \? 'roadmap' : 'brief'\)/);
  assert.match(views, /label: 'Project Path'/);
  assert.match(views, /\/api\/forge-roadmap\?projectId=/);
  assert.match(views, /Nex keeps the working roadmap flexible behind the scenes/);
});
