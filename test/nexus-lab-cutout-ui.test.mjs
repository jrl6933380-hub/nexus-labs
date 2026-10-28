import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The browser loads its own copy of the refiner from public/. It must never drift from lib/.
test('the browser copy of the segmentation refiner matches lib/', () => {
  const lib=readFileSync(new URL('../lib/nexusLabSegment.js',import.meta.url),'utf8');
  const pub=readFileSync(new URL('../public/nexus-lab-segment.js',import.meta.url),'utf8');
  assert.equal(pub,lib,'run: cp lib/nexusLabSegment.js public/nexus-lab-segment.js');
});

test('the Cutout task screen offers refinement only for cutout tasks that have outlines', () => {
  const agent=readFileSync(new URL('../public/nexus-lab-agent.js',import.meta.url),'utf8');
  assert.match(agent,/cap\.id==='cutout'&&t\.result\.cutouts/);
  assert.match(agent,/import \{renderCutoutRefiner\} from '\.\/nexus-lab-cutout\.js'/);
});

test('saving goes through the existing asset upload with derived provenance and a parent', () => {
  const ui=readFileSync(new URL('../public/nexus-lab-cutout.js',import.meta.url),'utf8');
  for(const action of ['asset_read','asset_download','asset_begin','asset_chunk','asset_finish'])assert.ok(ui.includes(`'${action}'`),action);
  assert.match(ui,/origin:'derived',parent_ids:\[parentId\]/);
  assert.match(ui,/Nothing is saved yet/);
});

test('paint strokes become a keep/remove hint map, later strokes win', async()=>{
  const {buildHints,strokeWords}=await import('../public/nexus-lab-cutout.js');
  const h=buildHints([{tool:'keep',r:3,pts:[[10,10]]},{tool:'remove',r:2,pts:[[10,10],[14,10]]}],30,20);
  assert.equal(h.length,600);assert.ok(h instanceof Int8Array);
  assert.equal(h[10*30+10],0);assert.equal(h[10*30+14],0);assert.equal(h[10*30+12],0);
  assert.equal(h[10*30+7],1);assert.equal(h[0],-1);
  const edge=buildHints([{tool:'keep',r:5,pts:[[-3,-3],[40,30]]}],30,20);assert.equal(edge.length,600);
  assert.equal(strokeWords(1),'1 hand stroke');assert.equal(strokeWords(2),'2 hand strokes');
});
