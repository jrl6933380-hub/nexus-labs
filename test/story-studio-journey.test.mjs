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

test('the first golden path supports chapter input, rights confirmation, generation, editing, saving, export, and deletion', () => {
  for (const marker of ['source-file','source-text','rights-confirmed','generate-btn','Save edits','Export JSON','Delete','Read full comic','Speech bubbles','Add bubble']) {
    assert.match(source,new RegExp(marker));
  }
  assert.match(source,/action:'generate'/);
  assert.match(source,/action:'save'/);
  assert.match(source,/action:'illustrate'/);
  assert.match(source,/illustrateAll/);
  assert.match(source,/panel-image/);
  assert.match(source,/Regenerate art/);
  assert.match(source,/createBubbleLayer/);
  assert.match(source,/openReader/);
  assert.match(source,/reader-page/);
  assert.match(source,/method:'DELETE'/);
});

test('the finished reader presents every panel together with captions and editable bubble styles', () => {
  assert.match(source,/comic\.panels\.forEach\(\(panel,index\) =>/);
  assert.match(source,/dialogueFromCard/);
  assert.match(source,/\['speech','Speech'\],\['thought','Thought'\],\['shout','Shout'\]/);
  assert.match(source,/reader-caption/);
  assert.match(source,/sideBySpeaker/);
  assert.match(source,/bubble\.dataset\.placement/);
  assert.match(source,/bubble\.dataset\.size/);
  assert.match(source,/data-placement\^="middle-"/);
  assert.match(source,/END OF ISSUE/);
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
  assert.match(api,/appearance/);
  assert.match(api,/continuity/);
  assert.match(api,/store\.saveProject\(username/);
  assert.doesNotMatch(api,/req\.body\?\.userId/);
});
