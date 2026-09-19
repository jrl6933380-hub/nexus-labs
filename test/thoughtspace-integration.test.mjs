import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('owner dashboard is one visual workspace instead of a stack of static room panels', () => {
  const index = read('../public/index.html');
  const workspace = read('../public/nexus-workspace.js');
  assert.match(index, /id="nexus-visual-stage"/u);
  assert.match(index, /nexus-workspace\.js/u);
  assert.doesNotMatch(index, /mountCanvas|canvas\.addPanel|portalHref/u);
  assert.match(workspace, /Nexus Forge/u);
  assert.match(workspace, /Blank Canvas/u);
  assert.match(workspace, /window\.addEventListener\('nexus:navigate'/u);
  assert.match(workspace, /do not navigate to a legacy page/u);
});

test('the static engines are hidden behind a developer fallback instead of driving the workspace', () => {
  const workspace = read('../public/nexus-workspace.js');
  for (const route of ['mission-control', 'conference-room', 'room', 'story-studio', 'memory', 'connectors']) {
    assert.match(workspace, new RegExp(`/${route}\\.html`, 'u'));
  }
  assert.match(workspace, /Developer fallback/u);
  assert.match(workspace, /Open live panel/u);
  assert.match(workspace, /Change this/u);
});

test('the Nex dock is universal across operator pages and always has a Nexus return control', () => {
  const chat = read('../public/nex-chat-bar.js');
  assert.match(chat, /id="nexHomeButton"/u);
  assert.match(chat, /operatorPaths/u);
  assert.match(chat, /nex-thoughtspace-dock/u);
  assert.match(chat, /nexus:open-dock/u);
  assert.match(chat, /NexusWorkspace\.showView\('overview'\)/u);
});

test('pinned Nex visuals become the primary workspace surface', () => {
  const panel = read('../public/pinned-visual-panel.js');
  const styles = read('../public/pinned-visual-panel.css');
  assert.match(panel, /getElementById\('nexus-visual-stage'\)/u);
  assert.match(panel, /nexus:visual-updated/u);
  assert.match(panel, /data-nexus-action/u);
  assert.match(panel, /\/api\/nex\/action/u);
  assert.match(panel, /event\.source !== frame\.contentWindow/u);
  assert.match(panel, /window\.confirm/u);
  assert.match(styles, /\.pinned-visual-panel\.is-workspace-surface/u);
  assert.match(styles, /\.pinned-visual-panel\.workspace-hidden/u);
});
