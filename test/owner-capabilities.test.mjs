import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerCapabilitiesHandler, ownerCapabilityCatalog } from '../api/owner-capabilities.js';

function response(){return {headers:{},setHeader(key,value){this.headers[key]=value;return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}

test('owner capability catalog exposes readable packs, tools, skills, commands, and saved chains',async()=>{
  const catalog=await ownerCapabilityCatalog({owner:'justin',listSkills:async()=>[{name:'memory-manager',description:'Keeps durable memory useful.',triggers:['remember'],instructions:'Review memory carefully.',sourcePath:'/app/nex-skills/memory-manager/SKILL.md'}],commandStore:{list:async()=>[{id:'command-test',name:'Check it',description:'Check status',trigger:'When asked',instructions:'Read first',tool_names:['read_board'],scopes:['conversation']}]}});
  assert.ok(catalog.tools.length>50);
  assert.ok(catalog.tools.every(tool=>tool.name && tool.sideEffect && tool.risk && !tool.schema));
  assert.ok(catalog.tools.every(tool=>tool.input_schema));
  assert.equal(catalog.skills[0].instructions,'Review memory carefully.');
  assert.equal(catalog.skills[0].source,'memory-manager/SKILL.md');
  assert.ok(catalog.capability_packs.some(pack=>pack.id==='professional-builder' && pack.workflows.length));
  assert.ok(catalog.commands.some(command=>command.name==='Hand off to dev team'));
  assert.ok(!catalog.commands.some(command=>/Claude|Hyperfocus|disengage/iu.test(`${command.name} ${command.description}`)));
  assert.ok(catalog.commands.some(command=>command.name==='@agent task'));
  assert.ok(catalog.commands.some(command=>command.name==='Check it' && command.type==='saved'));
});

test('owner capability catalog retires provider-specific tools and saved handoff commands',async()=>{
  const catalog=await ownerCapabilityCatalog({owner:'justin',listSkills:async()=>[],commandStore:{list:async()=>[
    {id:'command-old',name:'Wake Claude',description:'Old flow',trigger:'Nex disengage',instructions:'Use hyperfocus',tool_names:['wake_claude_code'],scopes:['conversation']},
  ]}});
  const serialized=JSON.stringify(catalog);
  assert.ok(catalog.tools.some(tool=>tool.name==='prepare_dev_handoff'));
  assert.ok(!catalog.tools.some(tool=>['wake_claude_code','open_hyperfocus','prepare_build_handoff'].includes(tool.name)));
  assert.ok(!catalog.commands.some(command=>command.id==='command-old'));
  assert.doesNotMatch(serialized,/wake_claude_code|open_hyperfocus|prepare_build_handoff/iu);
});

test('owner capability API creates validated saved command chains',async()=>{
  let input=null;const handler=createOwnerCapabilitiesHandler({getOwner:async()=>({id:'justin'}),commandStore:{create:async(owner,value,validTools)=>{input={owner,value,validTools};return {id:'command-one',name:value.name};},remove:async()=>true,list:async()=>[]}}),res=response();
  await handler({method:'POST',body:{action:'create_command',name:'Deploy check',instructions:'Check it',tool_names:['read_board']}},res);
  assert.equal(res.code,201);assert.equal(input.owner,'justin');assert.ok(input.validTools.has('read_board'));assert.equal(res.body.command.name,'Deploy check');
});

test('owner capability API refuses non-owner requests',async()=>{
  const handler=createOwnerCapabilitiesHandler({getOwner:async()=>null,catalog:async()=>({})}),res=response();
  await handler({method:'GET'},res);
  assert.equal(res.code,401);
  assert.match(res.body.error,/owner authentication required/u);
});

test('owner capability API returns the private catalog to an authenticated owner',async()=>{
  const expected={tools:[{name:'read_planner'}],skills:[],commands:[]};
  const handler=createOwnerCapabilitiesHandler({getOwner:async()=>({id:'justin'}),catalog:async()=>expected}),res=response();
  await handler({method:'GET'},res);
  assert.equal(res.code,200);
  assert.deepEqual(res.body,expected);
  assert.equal(res.headers['Cache-Control'],'private, no-store');
});
