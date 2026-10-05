import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/legacy-route.js',import.meta.url),'utf8');
function destination(pathname,hash=''){
  let value=null;
  vm.runInNewContext(source,{location:{pathname,hash,replace(next){value=next;}}});
  return value;
}

test('retired operator pages open the matching current Nexus workspace view',()=>{
  assert.equal(destination('/mission-control.html'),'/workspace.html?view=deck');
  assert.equal(destination('/conference-room.html'),'/workspace.html?view=agents');
  assert.equal(destination('/memory.html'),'/workspace.html?view=memory');
  assert.equal(destination('/queue.html'),'/workspace.html?view=approvals');
  assert.equal(destination('/connectors.html'),'/workspace.html?view=skills');
  assert.equal(destination('/tenants.html'),'/workspace.html?view=forge');
  assert.equal(destination('/nexus-space.html','#story'),'/workspace.html?view=story');
});

test('current product pages are not redirected by the legacy fallback',()=>{
  assert.equal(destination('/workspace.html'),null);
  assert.equal(destination('/forge.html'),null);
  assert.equal(destination('/story-studio.html'),null);
});
