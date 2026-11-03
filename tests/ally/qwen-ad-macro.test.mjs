import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeTool} from '../../scripts/ally/qwen-terminal-agent.mjs';
async function fixture(run){
 const workspace=await mkdtemp(join(tmpdir(),'qwen-macros-'));
 const old=process.env.USERPROFILE;process.env.USERPROFILE='C:\\Users\\test';
 try {await run(workspace);}finally{if(old===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=old;await rm(workspace,{recursive:true,force:true});}
}
test('ad catalog and start use argv not a shell',async()=>{
 await fixture(async workspace=>{
  const calls=[];
  const commandRunner=async(file,argv,opts)=>{calls.push({file,argv,opts});return {stdout:'ok',stderr:''};};
  const a=await executeTool({tool:'ad_macro',args:{action:'catalog'}},{workspace,commandRunner});
  const b=await executeTool({tool:'ad_macro',args:{action:'start_ad',name:'Barber Preview'}},{workspace,commandRunner});
  assert.equal(a.status,'succeeded');assert.equal(b.status,'succeeded');
  assert.equal(calls.length,2);assert.equal(calls[0].file,'powershell.exe');assert.equal(calls[1].opts.shell,false);
  assert.deepEqual(calls[1].argv.slice(-4),['-Action','start_ad','-Name','Barber Preview']);
 });
});
test('reject unsafe paths and extra args',async()=>{
 await fixture(async workspace=>{
  for(const args of [{action:'preview_ad',project_id:'../secrets'},{action:'preview_ad',project_id:'C:\\Windows'},{action:'start_ad',name:'bad; rm'},{action:'catalog',project_id:'extra'},{action:'variants_ad',project_id:'good-project',name:'extra'}]){
   await assert.rejects(()=>executeTool({tool:'ad_macro',args},{workspace}));
  }
 });
});
test('final rendering is approval-gated',async()=>{
 await fixture(async workspace=>{
  let called=false;const r=await executeTool({tool:'ad_macro',args:{action:'render_ad',project_id:'good-project'}},{workspace,commandRunner:async()=>{called=true;}});
  assert.equal(r.approval_required,true);assert.equal(called,false);
 });
});
