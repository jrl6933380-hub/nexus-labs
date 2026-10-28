import test from 'node:test';
import assert from 'node:assert/strict';
import {createNexusLab,rankCandidates} from '../lib/nexusLab.js';
import {stem,canonical,SYNONYM_GROUPS} from '../lib/nexusLabSynonyms.js';

const owner={id:'justin'};
function memory(){const lists=new Map();return async([op,key,...args])=>{if(op==='LRANGE')return (lists.get(key)||[]).slice(Number(args[0]),Number(args[1])+1);if(op==='LPUSH'){lists.set(key,[args[0],...(lists.get(key)||[])]);return lists.get(key).length;}if(op==='LTRIM'){lists.set(key,(lists.get(key)||[]).slice(Number(args[0]),Number(args[1])+1));return 'OK';}throw Error(op);};}
const docs=texts=>texts.map((text,i)=>({id:String(i),name:`Option ${i+1}`,text}));

test('stems make plurals and endings agree',()=>{
  assert.equal(stem('shoes'),stem('shoe'));
  assert.equal(stem('families'),'family');
  assert.equal(stem('calming'),'calm');
  assert.equal(stem('stopped'),'stop');
  assert.equal(stem('glass'),'glass');
  assert.equal(stem('bus'),'bus');
});

test('synonym groups have no word in two groups and are lowercase single words',()=>{
  const seen=new Map();
  SYNONYM_GROUPS.forEach((line,i)=>{for(const w of line.split(' ')){assert.match(w,/^[a-z]+$/,w);const s=stem(w);assert.ok(!seen.has(s)||seen.get(s)===i,`${w} appears in groups ${seen.get(s)} and ${i}`);seen.set(s,i);}});
  assert.equal(canonical('Peaceful'),canonical('calm'));
  assert.notEqual(canonical('calm'),canonical('loud'));
});

test('Rank matches synonyms when no exact word is shared, and still prefers exact words',()=>{
  const ranked=rankCandidates('calm peaceful ad for a senior living home',docs([
    'Loud sneaker drop with fast cuts',
    'Serene tranquil commercial for an elderly residence',
    'Peaceful Living senior home calm morning ad',
    'Life insurance explainer for families',
  ]),{synonyms:true});
  assert.deepEqual(ranked.map(d=>d.name),['Option 3','Option 2','Option 1','Option 4'],'ties keep input order');
  assert.ok(ranked[1].score>0,'a pure-synonym option must score above zero');
  assert.ok(ranked[0].score>ranked[1].score,'exact words beat synonyms');
  assert.ok(ranked[1].synonyms.some(s=>s.term==='calm'&&s.word==='serene'));
  assert.equal(ranked[2].score,0,'the unrelated options score zero');assert.equal(ranked[3].score,0);
});

test('exact word beats its synonym',()=>{
  const ranked=rankCandidates('calm',docs(['peaceful','calm']),{synonyms:true});
  assert.equal(ranked[0].name,'Option 2');assert.equal(ranked[0].score,1);assert.equal(ranked[1].score,.8);
});

test('filler words do not count toward a match, and an all-filler brief still works',()=>{
  const ranked=rankCandidates('for a',docs(['for a','blue']),{synonyms:true});
  assert.equal(ranked[0].score,1);
  const r=rankCandidates('shoes for the gym',docs(['family insurance for the home']),{synonyms:true});
  assert.equal(r[0].score,0);
});

test('without the option, ranking is the old exact-word behavior (Search is unchanged)',()=>{
  const plain=rankCandidates('calm',docs(['peaceful']));
  assert.equal(plain[0].score,0);assert.equal(plain[0].synonyms,undefined);
});

test('the Lab Rank run uses synonyms, labels its engine, and Search keeps keyword matching',async()=>{
  const lab=createNexusLab({command:memory(),env:{},catalog:async()=>[{id:'1',name:'Peaceful tool',text:'peaceful scheduler'}]});
  const rank=await lab.run(owner,{capability:'rank',query:'calm',candidates:['peaceful morning','loud drop']});
  assert.equal(rank.engine,'token-coverage-synonyms-v1');
  assert.equal(rank.output.results[0].text,'peaceful morning');assert.equal(rank.output.results[0].score,.8);
  assert.match(rank.output.note,/synonym/);
  const search=await lab.run(owner,{capability:'search',query:'calm'});
  assert.equal(search.engine,'token-coverage-v1');assert.equal(search.output.results.length,0);
});
