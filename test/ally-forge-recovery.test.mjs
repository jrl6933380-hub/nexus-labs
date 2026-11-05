import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {acquireResearchLock} from '../scripts/ally/forge-recovery.mjs';
const fixture=async fn=>{const root=await mkdtemp(join(tmpdir(),'forge-recover-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}};
test('live worker lock blocks another runner; release cannot remove another owner lock',()=>fixture(async root=>{
 const one=await acquireResearchLock(root);await assert.rejects(acquireResearchLock(root),/already running/);
 const path=join(root,'active.lock');const replacement={version:2,pid:1,token:'another-owner'};await writeFile(path,JSON.stringify(replacement));
 await one.release();assert.deepEqual(JSON.parse(await readFile(path)),replacement);
}));
test('dead worker lock is archived and recovered without replay; other active worker blocks recovery',()=>fixture(async root=>{
 await writeFile(join(root,'active.lock'),JSON.stringify({version:2,pid:1234,token:'dead'}));
 await assert.rejects(acquireResearchLock(root,{isAlive:()=>false,hasOtherWorkers:async()=>true}),/already running/);
 const lock=await acquireResearchLock(root,{isAlive:()=>false,hasOtherWorkers:async()=>false});assert.equal(lock.recovered,true);
 assert.ok((await readdir(root)).some(n=>n.startsWith('active.lock.recovered-')));await lock.release();
 assert.ok(!(await readdir(root)).includes('active.lock'));
}));
test('recent empty locks are protected; an old legacy lock recovers only after worker inspection',()=>fixture(async root=>{
 const path=join(root,'active.lock');await writeFile(path,'');
 await assert.rejects(acquireResearchLock(root,{hasOtherWorkers:async()=>false}),/starting/);
 await utimes(path,new Date(0),new Date(0));const lock=await acquireResearchLock(root,{hasOtherWorkers:async()=>false});
 assert.equal(lock.recovered,true);await lock.release();
}));
test('unknown lock data is preserved for inspection',()=>fixture(async root=>{
 await writeFile(join(root,'active.lock'),'not valid');await assert.rejects(acquireResearchLock(root),/Unrecognized lock/);
 assert.equal(await readFile(join(root,'active.lock'),'utf8'),'not valid');
}));
