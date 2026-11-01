import test from 'node:test';
import assert from 'node:assert/strict';
import {groupVideos,pendingFor,captionOf,validPostUrl,videoFields} from '../public/social-post-flow-core.mjs';
test('one video branches into distinct platform records without mixing captions',()=>{
 const a={id:'sf-abc-tiktok',campaign_id:'batch',platform:'tiktok',caption:'First',hashtags:'#first',status:'posted'},b={...a,id:'sf-abc-instagram',platform:'instagram',status:'idea'},c={...a,id:'sf-def-tiktok',caption:'Second',status:'idea'};
 const groups=groupVideos([a,b,c,{...c,campaign_id:'other'}],'batch');
 assert.equal(groups.length,2);assert.equal(groups[0].records.length,2);
 assert.deepEqual(pendingFor(groups,'tiktok'),[c]);assert.deepEqual(pendingFor(groups,'instagram'),[b]);
 assert.equal(captionOf(a),'First\n\n#first');assert.equal(captionOf(c),'Second\n\n#first');
});
test('live link must belong to the selected social platform',()=>{
 assert.equal(validPostUrl('https://www.tiktok.com/@nexus/video/123','tiktok'),true);
 for(const u of ['javascript:alert(1)','https://tiktok.com.evil.test/a','http://tiktok.com/a','https://www.tiktok.com/','https://instagram.com/p/1'])assert.equal(validPostUrl(u,'tiktok'),false);
});
test('strip metadata while preserving planner data and baseline ownership',()=>{
 assert.deepEqual(videoFields({id:'id',baseline:'v2',kind:'v',created_at:1,updated_at:2,title:'Keep',scope:{ready:false,brief:null},claimed_by:'claude'}),{title:'Keep',scope:{ready:false,brief:null},claimed_by:'claude'});
});
