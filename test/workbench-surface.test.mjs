import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [workspace, forge, views, workspaceViews] = await Promise.all([
  readFile(new URL('../public/workspace.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge-views.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/workspace-views.js', import.meta.url), 'utf8'),
]);

test('Nex Chat opens panels through the tailored Workbench surface', () => {
  assert.match(workspace, /mode === 'edit' \? 'chat' : 'preview'/u);
  assert.match(workspace, /forge\.html\?surface=workbench&view=chat&new=1/u);
});

test('Workbench exposes only its ordered panel rooms while ordinary Forge keeps its full navigation', () => {
  assert.match(forge, /WORKBENCH_VIEW_ORDER = \['project', 'preview', 'pages', 'stack', 'brief'\]/u);
  assert.match(forge, /return id === 'chat' \|\| !isWorkbench \|\| WORKBENCH_VIEWS\.has\(id\)/u);
  assert.match(forge, /if \(!viewAllowed\(id\)\) id = 'project'/u);
  assert.match(forge, /target && viewAllowed\(target\)/u);
  assert.match(forge, /: Object\.entries\(FORGE_VIEWS\)/u);
  assert.doesNotMatch(forge.match(/const WORKBENCH_VIEW_ORDER = \[[^\]]+\]/u)?.[0] || '', /brain|billing|usage|features/u);
});

test('Workbench copy and rooms stay scoped to the current panel', () => {
  assert.match(forge, /surfaceProduct'\)\.textContent = 'Workbench'/u);
  assert.match(forge, />All projects</u);
  assert.match(views, /ctx\.surface\?\.\(\) === 'workbench'/u);
  assert.match(views, /website, app, business system, or intelligence/u);
  assert.match(views, /Supporting pages, tools, workflows, and intelligences/u);
  assert.match(views, /Connections/u);
});

test('Full Preview renders the current build with owner controls and clean live-site sharing', () => {
  assert.match(forge, /className = 'workbench-full-preview'/u);
  assert.match(forge, /frame\.srcdoc = currentBuild/u);
  assert.match(forge, /id === 'preview' && isWorkbench && renderWorkbenchPreview\(\)/u);
  assert.match(forge, /edit\.textContent = 'Edit with Nex'/u);
  assert.match(forge, /back\.textContent = '← Projects'/u);
  assert.match(forge, /Publish & copy link/u);
  assert.match(forge, /Update & copy link/u);
  assert.match(forge, /Copy live link/u);
  assert.match(forge, /fetch\('\/api\/room-publish'/u);
  assert.match(forge, /navigator\.clipboard\?\.writeText/u);
  assert.doesNotMatch(forge, /Open separately/u);
});

test('Workbench editing pins the live project while only the Nex conversation scrolls', () => {
  assert.match(forge, /class="project-editor-preview"/u);
  assert.match(forge, /classList\.toggle\('workbench-editing', editing\)/u);
  assert.match(forge, /frame\.srcdoc = currentBuild/u);
  assert.match(forge, /if \(isWorkbench\) syncWorkbenchEditor\(\)/u);
  assert.match(forge, /grid-template-columns:minmax\(0,1\.45fr\) minmax\(360px,\.75fr\)/u);
});

test('Workbench composer keeps the full project tool set beside the send button', () => {
  assert.match(forge, /id="helpBtn">Help</u);
  assert.match(forge, /id="previewBtn">Preview</u);
  assert.match(forge, /id="addProjectBtn" hidden>Add</u);
  assert.match(forge, /id="planProjectBtn" hidden>Plan</u);
  assert.match(forge, /id="connectionsProjectBtn" hidden>Connections</u);
  assert.match(forge, /addProjectBtn'\)\.onclick = \(\) => showView\('pages'\)/u);
  assert.match(forge, /planProjectBtn'\)\.onclick = \(\) => showView\('brief'\)/u);
  assert.match(forge, /connectionsProjectBtn'\)\.onclick = \(\) => showView\('stack'\)/u);
  assert.match(forge, /el\(id\)\.hidden = !isWorkbench/u);
});

test('Projects view pairs the current panel preview with a one-tap new-panel tile', () => {
  assert.match(forge, /currentBuild: \(\) => currentBuild/u);
  assert.match(forge, /currentProjectLabel: \(\) => currentProjectLabel/u);
  assert.match(forge, /\.workbench-project-grid\{display:grid/u);
  assert.match(views, /function workbenchProjectTiles\(ctx\)/u);
  assert.match(views, /frame\.srcdoc = ctx\.currentBuild\?\.\(\) \|\| ''/u);
  assert.match(views, /current\.onclick = \(\) => ctx\.go\('preview'\)/u);
  assert.match(views, />New panel<\/strong><small>Add to your Workbench</u);
  assert.match(views, /add\.onclick = \(\) => ctx\.startProject\(\)/u);
});

test('Projects view shows plan usage and the backend receives the Workbench surface for limit enforcement', () => {
  assert.match(workspace, />Projects<span class="badgeplan"/u);
  assert.match(workspaceViews, /projectUsage\(projects\.length, limit, workbench\.planName\)/u);
  assert.match(workspaceViews, /Upgrade for more projects/u);
  assert.match(forge, /surface: surfaceMode/u);
  assert.match(forge, /WORKBENCH_PROJECT_LIMIT/u);
});

test('Live project cards expose the clean public link without opening editor chrome', () => {
  assert.match(workspaceViews, /copy\.textContent = 'Copy link'/u);
  assert.match(workspaceViews, /copyProjectLink\(liveUrl, copy\)/u);
  assert.match(workspaceViews, /navigator\.clipboard\.writeText\(url\)/u);
});
