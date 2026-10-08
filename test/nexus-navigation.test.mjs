import test from 'node:test';
import assert from 'node:assert/strict';
import {SPACE_BUNDLES,pinnedBundles,COMPOSER_DESTINATIONS} from '../public/nexus-navigation.js';
test('old related pins map to one bundle and settings spaces leave the inbox',()=>{
  assert.deepEqual(pinnedBundles(['planner','reminders','life','workbench']),['life','workbench']);
  assert.deepEqual(pinnedBundles(['story','ventures','approvals','forge']),['workbench','deck']);
  assert.deepEqual(pinnedBundles(['memory','agents','pod','skills']),[]);
  assert.deepEqual(pinnedBundles(['life','deck']),['life','deck']);
  for(const bundle of SPACE_BUNDLES)assert.ok(bundle.members.includes(bundle.id));
});
test('composer has one Settings destination alongside the bundles',()=>{
  assert.equal(COMPOSER_DESTINATIONS.filter(item=>item.id==='settings').length,1);
  assert.deepEqual(COMPOSER_DESTINATIONS.filter(item=>item.id!=='settings').map(item=>item.id),SPACE_BUNDLES.map(item=>item.id));
  assert.ok(!COMPOSER_DESTINATIONS.some(item=>['usage','preferences','notifications','memory'].includes(item.id)));
});
