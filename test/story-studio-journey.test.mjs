import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/story-studio.html',import.meta.url),'utf8');
const api = await readFile(new URL('../api/story-studio.js',import.meta.url),'utf8');

test('Story Studio is one locked Nexus canvas cubicle with a private auth gate', () => {
  assert.match(source,/canvasId:'story-studio'/);
  assert.match(source,/locked:true/);
  assert.match(source,/\/room-login\.html\?next=\/story-studio\.html/);
  assert.match(api,/getRequestUser/);
});

test('the first golden path gives customers chapter input and a finished comic without production controls', () => {
  for (const marker of ['source-file','source-text','rights-confirmed','generate-btn','Delete comic','Read full comic']) {
    assert.match(source,new RegExp(marker));
  }
  assert.match(source,/action:'generate'/);
  assert.match(source,/action:'illustrate'/);
  assert.match(source,/illustrateAll/);
  assert.match(source,/buildLetteringPreview/);
  assert.match(source,/reviewPanelLettering/);
  assert.match(source,/action:'review-lettering'/);
  assert.match(source,/panel-image/);
  assert.match(source,/createBubbleLayer/);
  assert.match(source,/sampleLetteringTimeline/);
  assert.match(source,/dataset\.letteringRevision/);
  assert.match(source,/data-positioned="true"/);
  assert.match(source,/openReader/);
  assert.match(source,/reader-page/);
  assert.match(source,/method:'DELETE'/);
  for (const hidden of ['Save edits','Export JSON','Regenerate art','Reset position','Add bubble','data-field="artDirection"','enableBubbleDrag','dialogueSide']) {
    assert.doesNotMatch(source,new RegExp(hidden));
  }
});

test('the finished reader presents every panel together with captions and Nex-owned bubble styles', () => {
  assert.match(source,/comic\.panels\.forEach\(\(panel,index\) =>/);
  assert.match(source,/\['thought','shout'\]\.includes\(entry\.type\)/);
  assert.match(source,/reader-caption/);
  assert.match(source,/END OF ISSUE/);
  assert.match(source,/word-break:normal/);
  assert.match(source,/hyphens:none/);
});

test('every Story Studio DOM reference is wired to a camel-case element alias', () => {
  const declared = new Set(
    [...source.matchAll(/\['([A-Za-z]\w*)','[a-z0-9-]+'\]/g)].map((match) => match[1]),
  );
  const referenced = new Set(
    [...source.matchAll(/\bels\.([A-Za-z]\w*)/g)].map((match) => match[1]),
  );

  assert.deepEqual(
    [...referenced].filter((name) => !declared.has(name)),
    [],
    'every els.* reference must have a declared DOM alias',
  );
  assert.match(source,/if \(!element\) throw new Error\(`Story Studio could not initialize \$\{key\}\.`\);/);
});

test('Story Studio asks for six continuity-aware panels and preserves tenant ownership server-side', () => {
  assert.match(api,/Produce exactly 6 panels/);
  assert.match(api,/never more than two/);
  assert.match(api,/prepareBasicComicPlan/);
  assert.match(api,/reviewPanelLettering/);
  assert.match(api,/action === 'direct-lettering'/);
  assert.match(api,/applyNexLetteringOperations/);
  assert.match(api,/appearance/);
  assert.match(api,/continuity/);
  assert.match(api,/worldBible/);
  assert.match(api,/animationLanguage/);
  assert.match(api,/comicDirectorGuidance\('planning'\)/);
  assert.match(api,/analyzePanelVisual/);
  assert.match(api,/visual lettering pass failed/);
  assert.match(api,/store\.saveProject\(username/);
  assert.doesNotMatch(api,/req\.body\?\.userId/);
});
