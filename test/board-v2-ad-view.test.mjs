import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/nexus-workspace-board.html',import.meta.url),'utf8');
test('board opens vocabulary (v2) ads in a sandboxed read-only player instead of the legacy controller',()=>{
  const start=html.indexOf('async function openAd');
  const v2=html.indexOf('result.spec_version===2){',start),legacy=html.indexOf("getElementById('ad-context')",start);
  assert.ok(v2>start&&legacy>v2,'v2 branch must run before the legacy ad-context lookup');
  const branch=html.slice(v2,legacy);
  assert.match(branch,/setAttribute\('sandbox','allow-scripts'\)/);
  assert.match(branch,/Content-Security-Policy/);
  assert.match(branch,/save_nexus_ad_v2/);
  assert.match(branch,/concept label/);
  assert.doesNotMatch(branch,/allow-same-origin/);
});
