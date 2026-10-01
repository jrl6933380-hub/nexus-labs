import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [workspace, forge, views] = await Promise.all([
  readFile(new URL('../public/workspace.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge-views.js', import.meta.url), 'utf8'),
]);

test('Nex Chat opens panels through the tailored Workbench surface', () => {
  assert.match(workspace, /forge\.html\?surface=workbench&view=chat&build=/u);
  assert.match(workspace, /forge\.html\?surface=workbench&view=chat&new=1/u);
});

test('Workbench exposes only its ordered panel rooms while ordinary Forge keeps its full navigation', () => {
  assert.match(forge, /WORKBENCH_VIEW_ORDER = \['project', 'brief', 'pages', 'preview', 'stack', 'help'\]/u);
  assert.match(forge, /return id === 'chat' \|\| !isWorkbench \|\| WORKBENCH_VIEWS\.has\(id\)/u);
  assert.match(forge, /if \(!viewAllowed\(id\)\) id = 'project'/u);
  assert.match(forge, /target && viewAllowed\(target\)/u);
  assert.match(forge, /: Object\.entries\(FORGE_VIEWS\)/u);
  assert.doesNotMatch(forge.match(/const WORKBENCH_VIEW_ORDER = \[[^\]]+\]/u)?.[0] || '', /brain|billing|usage|features/u);
});

test('Workbench copy and rooms stay scoped to the current panel', () => {
  assert.match(forge, /surfaceProduct'\)\.textContent = 'Workbench'/u);
  assert.match(forge, />All panels</u);
  assert.match(views, /ctx\.surface\?\.\(\) === 'workbench'/u);
  assert.match(views, /Your other panels stay separate|without touching your other panels/u);
  assert.match(views, /Full Stack/u);
});
