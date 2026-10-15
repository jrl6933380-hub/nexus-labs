import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardKitStore} from '../lib/boardKits.js';

const spec={title:'Old launch',audience:'Owner',purpose:'Draft',workflow:['Plan'],collections:[{id:'notes',label:'Notes',fields:[{id:'body',label:'Note',type:'text',required:true}]}],skill:'Plan.',guidance:'Start here.',requirements:[],html:'<html><body>Draft</body></html>'};
function fixture(){
 const hashes=new Map(),calls=[];let revision=0,beforeDelete;
 const command=async cmd=>{
  calls.push(cmd);const [op,key,...args]=cmd;
  if(op==='HGET')return hashes.get(key)?.get(args[0]) ?? null;
  if(op==='HVALS')return [...(hashes.get(key)?.values() || [])];
  if(op==='EVAL'){
   const hashKey=cmd[3],id=cmd[4],expected=cmd[5],hash=hashes.get(hashKey) || new Map();
   if(key.includes('board-kit-delete-cas-v1')){
    if(beforeDelete){const hook=beforeDelete;beforeDelete=null;hook(hash,id);}
    if(!hash.has(id) || hash.get(id)!==expected)return 0;
    hash.delete(id);return 1;
   }
   if((hash.get(id) || '')!==expected)return 0;
   hash.set(id,cmd[6]);hashes.set(hashKey,hash);return 1;
  }
  throw Error('Unexpected command '+op);
 };
 return {store:createBoardKitStore({command,idFactory:()=>`version-${++revision}`}),hashes,calls,race:hook=>{beforeDelete=hook;}};
}
test('deleting an identified board removes its entries and preserves other boards and accounts',async()=>{
 const {store}=fixture();let old=await store.save('justin',{board_id:'old-launch',spec});
 await store.saveEntry('justin',{board_id:'old-launch',collection_id:'notes',entry_id:'note-one',data:{body:'Saved note'}});
 old=await store.read('justin','old-launch');await store.save('justin',{board_id:'keep',spec});await store.save('other',{board_id:'old-launch',spec});
 const result=await store.remove('justin',{board_id:old.board_id,baseline:old.baseline});assert.equal(result.deleted,true);assert.equal(result.deleted_entries,1);
 assert.deepEqual((await store.list('justin')).boards.map(b=>b.board_id),['keep']);assert.equal((await store.read('other','old-launch')).board_id,'old-launch');
 await assert.rejects(store.read('justin','old-launch'),/Board not found/);await assert.rejects(store.entries('justin',{board_id:'old-launch',collection_id:'notes'}),/Board not found/);
});
test('missing or stale baselines cannot delete a board or saved work',async()=>{
 const {store}=fixture();const old=await store.save('justin',{board_id:'old-launch',spec});await store.saveEntry('justin',{board_id:'old-launch',collection_id:'notes',entry_id:'note-one',data:{body:'New information'}});
 for(const baseline of [undefined,'',old.baseline])await assert.rejects(store.remove('justin',{board_id:'old-launch',baseline}),/current board baseline/);
 assert.equal((await store.entries('justin',{board_id:'old-launch',collection_id:'notes'})).entries.length,1);
});
test('a concurrent write between read and delete is preserved by the atomic comparison',async()=>{
 const f=fixture(),old=await f.store.save('justin',{board_id:'old-launch',spec});
 f.race((hash,id)=>{const board=JSON.parse(hash.get(id));board.baseline='concurrent-version';board.spec.title='A changed board';hash.set(id,JSON.stringify(board));});
 await assert.rejects(f.store.remove('justin',{board_id:'old-launch',baseline:old.baseline}),/board changed/);
 assert.equal((await f.store.read('justin','old-launch')).title,'A changed board');
});
test('invalid identifiers and unauthenticated or wrong-account deletes do not touch storage',async()=>{
 const f=fixture(),old=await f.store.save('justin',{board_id:'old-launch',spec});
 await assert.rejects(f.store.remove('other',{board_id:'old-launch',baseline:old.baseline}),/Board not found/);
 await assert.rejects(f.store.remove('',{board_id:'old-launch',baseline:old.baseline}),/Authenticated/);
 await assert.rejects(f.store.remove('justin',{board_id:'../all',baseline:old.baseline}));
 assert.equal((await f.store.read('justin','old-launch')).baseline,old.baseline);
 assert.equal(f.calls.filter(c=>c[0]==='EVAL' && c[1].includes('board-kit-delete-cas-v1')).length,0);
});
