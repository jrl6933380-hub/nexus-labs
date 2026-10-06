import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexCommandChainStore,formatNexCommandChains} from '../lib/nexCommandChains.js';

function fixture(){const saved=new Map();return createNexCommandChainStore({run:async command=>command[0]==='GET'?(saved.get(command[1]) || null):(saved.set(command[1],command[2]),'OK'),idFactory:()=> 'command-test-1'});}

test('owner commands persist ordered registered tool chains',async()=>{
  const store=fixture(),valid=new Set(['read_board','find_board_task']);
  const created=await store.create('justin',{name:'Check the board',description:'Find urgent work',trigger:'When I ask what needs attention',instructions:'Read the board, then inspect the most urgent task.',tool_names:['read_board','find_board_task'],scopes:['conversation','groups']},valid);
  assert.deepEqual(created.tool_names,['read_board','find_board_task']);
  assert.equal((await store.get('justin',created.id)).name,'Check the board');
  assert.match(formatNexCommandChains(await store.list('justin')),/read_board → find_board_task/u);
});

test('saved command validation rejects unknown tools and stays owner scoped',async()=>{
  const store=fixture();
  await assert.rejects(store.create('justin',{name:'Bad',instructions:'Do it',tool_names:['imaginary_tool']},new Set(['read_board'])),/registered Nexus tool/u);
  assert.deepEqual(await store.list('different-owner'),[]);
});
