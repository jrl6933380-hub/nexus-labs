import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [workspace, forge, views, workspaceViews, messages] = await Promise.all([
  readFile(new URL('../public/workspace.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge-views.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/workspace-views.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/nexus-messages.js', import.meta.url), 'utf8'),
]);

test('Nex Chat opens panels through the tailored Workbench surface', () => {
  assert.match(workspace, /mode === 'edit' \? 'chat' : 'preview'/u);
  assert.match(workspace, /forge\.html\?surface=workbench&view=chat&new=1/u);
});

test('Projects stays inside Workbench while All projects returns to the Nex Chat gallery', () => {
  assert.match(forge, /button\.onclick = \(\) => showView\(id\)/u);
  assert.match(forge, /location\.assign\('\/workspace\.html\?view=workbench'\)/u);
  assert.doesNotMatch(forge, /id === 'project'[\s\S]{0,120}workspace\.html\?view=workbench/u);
});

test('Workbench exposes only its ordered panel rooms while ordinary Forge keeps its full navigation', () => {
  assert.match(forge, /WORKBENCH_VIEW_ORDER = \['project', 'live', 'roadmap', 'stack', 'brief'\]/u);
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
  assert.match(views, /supporting pages, tools, workflows, and intelligences/u);
  assert.match(views, /Connections/u);
});

test('Full Preview renders the current build with owner controls and clean live-site sharing', () => {
  assert.match(forge, /className = 'workbench-full-preview'/u);
  assert.match(forge, /frame\.srcdoc = currentBuild/u);
  assert.match(forge, /id === 'preview' && isWorkbench && renderWorkbenchPreview\(\)/u);
  assert.match(forge, /edit\.textContent = 'Edit with Nex'/u);
  assert.match(forge, /back\.textContent = '← Projects'/u);
  assert.match(forge, /back\.onclick = \(\) => showView\('project'\)/u);
  assert.match(forge, /Publish & copy link/u);
  assert.match(forge, /Update & copy link/u);
  assert.match(forge, /Copy live link/u);
  assert.match(forge, /fetch\('\/api\/room-publish'/u);
  assert.match(forge, /navigator\.clipboard\?\.writeText/u);
  assert.doesNotMatch(forge, /Open separately/u);
});

test('Live Sites owns the post-publish maintenance and growth experience', () => {
  assert.match(forge, /live: 'Live Sites'/u);
  assert.match(views, /live: \{/u);
  assert.match(views, /projects\.filter\(\(project\) => field\(project, 'liveUrl'\)\)/u);
  assert.match(views, /Maintain with Nex/u);
  assert.match(views, /\+ Add a feature/u);
  assert.match(views, /Get Nexus help/u);
  assert.match(views, /ctx\.openExternal\(liveUrl\)/u);
  assert.match(views, /ctx\.copyText\(liveUrl\)/u);
});

test('Workbench editing pins the live project while only the Nex conversation scrolls', () => {
  assert.match(forge, /class="project-editor-preview"/u);
  assert.match(forge, /classList\.toggle\('workbench-editing', editing\)/u);
  assert.match(forge, /frame\.srcdoc = currentBuild/u);
  assert.match(forge, /if \(isWorkbench\) syncWorkbenchEditor\(\)/u);
  assert.match(forge, /grid-template-columns:minmax\(0,1\.45fr\) minmax\(360px,\.75fr\)/u);
});

test('Workbench composer routes preview and additions through Projects', () => {
  assert.match(forge, /id="helpBtn">Help</u);
  assert.match(forge, /id="previewBtn">Preview</u);
  assert.match(forge, /id="addProjectBtn" hidden>Add</u);
  assert.match(forge, /id="planProjectBtn" hidden>Plan</u);
  assert.match(forge, /id="connectionsProjectBtn" hidden>Connections</u);
  assert.match(forge, /addProjectBtn'\)\.onclick = \(\) => showView\('project'\)/u);
  assert.match(forge, /planProjectBtn'\)\.onclick = \(\) => \{ plannerEntry = ''; showView\(currentBuild \? 'roadmap' : 'brief'\); \}/u);
  assert.match(forge, /connectionsProjectBtn'\)\.onclick = \(\) => showView\('stack'\)/u);
  assert.match(forge, /el\('connectionsProjectBtn'\)\.hidden = !isWorkbench \|\| !currentBuild/u);
  assert.match(forge, /el\('addProjectBtn'\)\.hidden = true/u);
  assert.match(forge, /showView\(isWorkbench \? 'project' : 'preview'\)/u);
});

test('Projects view pairs panel previews with a one-tap new-panel tile', () => {
  assert.match(forge, /currentBuild: \(\) => currentBuild/u);
  assert.match(forge, /currentProjectLabel: \(\) => currentProjectLabel/u);
  assert.match(forge, /\.workbench-project-grid\{display:grid/u);
  assert.match(views, /async function workbenchProjectTiles\(ctx\)/u);
  assert.match(views, /frame\.srcdoc = previews\[index\] \|\| ''/u);
  assert.match(views, /ctx\.openBuild\(buildId, 'preview', projectLabel\)/u);
  assert.match(views, />New panel<\/strong><small>Add to your Workbench</u);
  assert.match(views, /add\.onclick = \(\) => ctx\.startProject\(\)/u);
});

test('Projects loads every panel and fans recorded supporting pieces into its stack', () => {
  assert.match(views, /await getJSON\('\/api\/room-history'\)/u);
  assert.match(views, /projects\.forEach\(\(project, index\) =>/u);
  assert.match(views, /workbench-project-stack/u);
  assert.match(views, /supporting piece/u);
  assert.match(views, /classList\.toggle\('open'\)/u);
  assert.match(views, /ctx\.chooseAdditionKind\('page'\)/u);
  assert.match(views, /ctx\.chooseAdditionKind\('tool'\)/u);
  assert.match(views, /ctx\.chooseAdditionKind\('intelligence'\)/u);
  assert.match(forge, /stackItem: pendingStackItem/u);
});

test('Projects view shows plan usage and the backend receives the Workbench surface for limit enforcement', () => {
  assert.match(messages, /id:'workbench',name:'Projects'/u);
  assert.match(workspaceViews, /projectUsage\(projects\.length, limit, workbench\.planName\)/u);
  assert.match(workspaceViews, /See plan options/u);
  assert.match(forge, /surface: surfaceMode/u);
  assert.match(forge, /WORKBENCH_PROJECT_LIMIT/u);
});

test('Live project cards expose the clean public link without opening editor chrome', () => {
  assert.match(workspaceViews, /copy\.textContent = 'Copy link'/u);
  assert.match(workspaceViews, /copyProjectLink\(liveUrl, copy\)/u);
  assert.match(workspaceViews, /navigator\.clipboard\.writeText\(url\)/u);
});
