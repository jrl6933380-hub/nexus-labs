import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BUILDER_WEB_LAYOUT_STANDARD,builderLayoutDirective} from '../lib/builderLayoutStandard.js';
import {formatLiveWorkspaceContext} from '../lib/nexBrain.js';

test('builder guidance defines real responsive page proportions and layering',()=>{
  for(const phrase of ['not a square poster','320px phone','1440px desktop','1120–1280px','Do not stack every item','Normal content stays in document flow','390×844','768×1024','1440×900'])assert.match(BUILDER_WEB_LAYOUT_STANDARD,new RegExp(phrase));
  assert.equal(builderLayoutDirective('research'),'');
  assert.equal(builderLayoutDirective('build'),BUILDER_WEB_LAYOUT_STANDARD);
});

test('a direct builder conversation receives the shared web layout standard',()=>{
  const context=formatLiveWorkspaceContext({clientContext:{conversation:{kind:'specialist',name:'Mason',role:'build',job:'Build websites',scopes:['conversation','projects']}}});
  assert.match(context,/fluid browser page/);
  assert.match(context,/Prevent accidental overlap/);
  const research=formatLiveWorkspaceContext({clientContext:{conversation:{kind:'specialist',name:'Atlas',role:'research',job:'Research',scopes:['conversation']}}});
  assert.doesNotMatch(research,/fluid browser page/);
});

test('team visual previews use a realistic portrait browser viewport on phones',()=>{
  const css=fs.readFileSync(new URL('../public/team-chat.css',import.meta.url),'utf8');
  assert.match(css,/\.teamvisual\{[^}]*height:clamp\(480px,70dvh,720px\)/u);
  assert.match(css,/@media\(max-width:520px\)[\s\S]*\.teamvisual\{height:min\(68dvh,620px\);min-height:460px\}/u);
});
