import test from 'node:test';
import assert from 'node:assert/strict';
import {parseActorInput} from '../lib/researchJobs.js';
test('Review Intelligence needs pasted reviews or a review page link before any credits are taken',()=>{
 assert.throws(()=>parseActorInput('reviews_intel',{business:'Planet Fitness',focus:'billing'}),e=>e.status===400&&e.code==='RESEARCH_INVALID'&&/Nothing was charged/.test(e.message));
 assert.equal(parseActorInput('reviews_intel',{business:'Planet Fitness',reviews:'Great gym, 5 stars.'}).actor.id,'reviews_intel');
 assert.equal(parseActorInput('reviews_intel',{business:'Planet Fitness',place:'https://maps.google.com/?cid=1'}).actor.id,'reviews_intel');
});
