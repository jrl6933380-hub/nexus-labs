import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryHandler} from '../api/room-history.js';
const res=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('ordinary Pro user can save three fresh projects, then hits the real API limit; another tenant has its own allowance',async()=>{
 const data=new Map();const own=user=>data.get(user)||[];
 const handler=createHistoryHandler({resolveUser:async req=>req.headers.user,resolvePlan:async()=> 'hosted',readProjects:async user=>own(user),readList:async user=>own(user),readLatestProject:async(user,id)=>own(user).find(p=>p.projectId===id),readLiveSites:async()=>[],writeBuild:async(user,input)=>{const build={...input,id:'build-'+input.projectId};data.set(user,[...own(user),build]);return build;}});
 const save=async(user,projectId)=>{const result=res();await handler({method:'POST',headers:{user},body:{action:'save_project_draft',projectId,html:'<html><title>Ordinary Pro project</title><body>Real draft</body></html>'}},result);return result;};
 for(const id of ['one','two','three'])assert.equal((await save('ordinary-pro',id)).code,201);
 const denied=await save('ordinary-pro','four');assert.equal(denied.code,402);assert.equal(denied.body.code,'PROJECT_LIMIT_REACHED');assert.equal(own('ordinary-pro').length,3);
 assert.equal((await save('another-pro','one')).code,201);assert.equal(own('another-pro').length,1);
 const listing=res();await handler({method:'GET',headers:{user:'ordinary-pro'},query:{}},listing);assert.equal(listing.body.workbench.limit,3);assert.equal(listing.body.workbench.canCreate,false);
});
