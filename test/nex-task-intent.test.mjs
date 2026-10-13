import test from 'node:test';import assert from 'node:assert/strict';
import {requestFingerprint,newBuildRequest,startsNewAssignment} from '../lib/nexTaskIntent.js';
test('a new build request cannot inherit the previous task project but continuations and edits retain it',()=>{
 const goal='Build a workout timer',state={resumed:true,goal,requestFingerprint:requestFingerprint(goal)};
 assert.equal(startsNewAssignment('Build a different calendar app',state),true);
 for(const message of [goal,'Continue','Make it blue','Edit this existing project','How do I build a website?'])assert.equal(startsNewAssignment(message,state),false,message);
 assert.equal(newBuildRequest('Can you build a fresh website?'),true);assert.equal(startsNewAssignment(goal,{resumed:false}),false);
});
