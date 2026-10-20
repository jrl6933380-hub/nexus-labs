import test from 'node:test';
import assert from 'node:assert/strict';
import {SITE_DESIGN_ATOMS,SITE_DESIGN_LESSONS,describeSiteDesignVocabulary,createSiteDesignLesson} from '../lib/siteDesignVocabulary.js';
import {boardSharedSkills,SITE_STYLIST_GUIDANCE} from '../lib/boardSiteStylist.js';

test('selected source evidence is distinct from runtime proof and render grammar',()=>{
 const described=describeSiteDesignVocabulary();
 assert.equal(described.lessons.length,2);
 assert.equal(new Set(SITE_DESIGN_ATOMS.map(a=>a.id)).size,SITE_DESIGN_ATOMS.length);
 for(const lesson of described.lessons){assert.equal(lesson.selection.state,'user_selected');assert.equal(lesson.verification.browser,false);assert.equal(lesson.verification.device,false);assert.equal(lesson.verification.integrations,false);assert.equal(lesson.source.visibility,'owner_private');assert.equal(lesson.source.url,undefined);assert.match(lesson.reuse,/not_mandatory_layout/);}
 for(const lesson of SITE_DESIGN_LESSONS)assert.match(lesson.source.revision,/^[a-f0-9]{40}$/);
 const wire=JSON.stringify(described);assert.doesNotMatch(wire,/mauveshore6|appgprj_|cb4633c5|Justin/);
 assert.match(described.render_boundary,/not new save_nexus_ad_v2 scene IDs/);
 assert.ok(described.workflow.some(s=>s.id==='design_first'));
 assert.ok(described.workflow.some(s=>s.id==='extract_decisions'));
 assert.ok(described.workflow.some(s=>s.id==='map_and_identify_gaps'));
});
test('lesson records reject unsupported atoms, fake maturity fields and missing selection evidence',()=>{
 const good=structuredClone(SITE_DESIGN_LESSONS[0]);delete good.reuse;delete good.trust;
 assert.equal(createSiteDesignLesson(good).id,good.id);
 assert.throws(()=>createSiteDesignLesson({...good,atom_ids:['made_up_renderer']}),/Unknown design atom/);
 assert.throws(()=>createSiteDesignLesson({...good,selection:{state:'generated',evidence:'No selection'}}),/user-selected/);
 assert.throws(()=>createSiteDesignLesson({...good,selection:{state:'user_selected',evidence:''}}),/evidence/);
 assert.throws(()=>createSiteDesignLesson({...good,verification:{...good.verification,browser:'passed'}}),/boolean/);
 assert.throws(()=>createSiteDesignLesson({...good,source:{...good.source,url:'javascript:alert(1)'}}),/HTTPS/);
 assert.throws(()=>createSiteDesignLesson({...good,proven:true}),/Unsupported/);
 assert.throws(()=>createSiteDesignLesson({...good,permission:'publish'}),/Unsupported/);
});
test('board reference delivery cannot mutate canonical lessons or saved playbook content',()=>{
 const before=SITE_STYLIST_GUIDANCE.content;
 const first=boardSharedSkills();
 assert.equal(first.length,1);assert.equal(first[0].name,'site-stylist');
 assert.equal(first[0].content,before);
 first[0].design_vocabulary.lessons[0].name='Mutated by reader';
 first[0].design_vocabulary.atoms.length=0;
 const next=boardSharedSkills();
 assert.notEqual(next[0].design_vocabulary.lessons[0].name,'Mutated by reader');
 assert.ok(next[0].design_vocabulary.atoms.length>0);
 assert.equal(SITE_STYLIST_GUIDANCE.content,before);
 assert.equal(SITE_DESIGN_LESSONS[0].name,'Sole Exchange — selected sneaker resale concept');
});
