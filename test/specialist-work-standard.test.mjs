import test from 'node:test';
import assert from 'node:assert/strict';
import {specialistWorkDirective} from '../lib/specialistWorkStandard.js';
import {formatLiveWorkspaceContext} from '../lib/nexBrain.js';

for(const [role,name,expected] of [
  ['research','Atlas',/Choose one recommended solution/],
  ['build','Mason',/one coherent finished draft/],
  ['life','Vida',/Check existing items before creating another/],
  ['review','Vera',/Review the actual deliverable/],
])test(`${name} receives its work standard in a direct chat`,()=>{
  const text=formatLiveWorkspaceContext({clientContext:{conversation:{kind:'specialist',name,role,job:'Help with the task',scopes:['conversation']}}});
  assert.match(text,expected);
  assert.match(text,/Never present guesses as verified facts/);
});
test('group coordinator chooses a next step without inventing teammate work',()=>{
  const text=formatLiveWorkspaceContext({clientContext:{conversation:{kind:'group',title:'Launch',members:[],scopes:['conversation']}}});
  assert.match(text,/Use the researcher’s recommended direction/);
  assert.match(text,/do not simulate their work/);
  assert.equal(specialistWorkDirective('unknown'),'');
});

test('main Nex chat receives the same coordination standard',()=>{
  assert.match(formatLiveWorkspaceContext({}),/Bring the team to one useful outcome/);
});
