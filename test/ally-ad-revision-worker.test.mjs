import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRevision,patchStarter} from '../scripts/ally/review-revision-worker.mjs';

const ad={name:'Sample',brand:'SAMPLE',headline:'Original hook',offer:'Original offer',cta:'Learn more',accent:'#abc123',background:'#091827',durationMs:15000,source:'ad.html',concept:true,width:540,height:960};
const html='<script id="ad-config" type="application/json">'+JSON.stringify(ad)+'</script><main>Original player</main>';
test('local Qwen patch preserves timeline and existing player',()=>{
 const result=patchStarter(JSON.stringify(ad),html,'{"headline":"Revised hook","accent":"#fedcba"}');
 assert.equal(JSON.parse(result.project).headline,'Revised hook');
 assert.equal(JSON.parse(result.project).durationMs,15000);
 assert.equal(JSON.parse(result.project).brand,ad.brand);
 assert.match(result.html,/Original player/);
 assert.match(result.html,/Revised hook/);
});
test('only known copy and color fields are accepted',()=>{
 assert.deepEqual(parseRevision('{"cta":"Explore"}'),{cta:'Explore'});
 for(const invalid of ['{"durationMs":12000}','{"cta":""}','{"accent":"blue"}','{"headline":123}','{}','[]'])assert.throws(()=>parseRevision(invalid));
 assert.throws(()=>patchStarter(JSON.stringify(ad),'<main>No ad configuration</main>','{"cta":"Explore"}'));
});
