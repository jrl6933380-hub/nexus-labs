import test from 'node:test';
import assert from 'node:assert/strict';
import {rankCandidates} from '../lib/nexusLab.js';
import {dictionaryLink} from '../lib/nexusLabSynonyms.js';

const top=(query,docs)=>rankCandidates(query,docs,{synonyms:true})[0];

test('dictionary links close words in both directions', () => {
  assert.equal(dictionaryLink('calm','serene'),'close');
  assert.equal(dictionaryLink('serene','calm'),'close');
  assert.equal(dictionaryLink('cheap','inexpensive'),'close');
});

test('dictionary links broader words as related, weaker than close', () => {
  assert.equal(dictionaryLink('sneaker','shoe'),'related');
  assert.equal(dictionaryLink('shoe','sneaker'),'related');
});

test('dictionary leaves unrelated words alone', () => {
  assert.equal(dictionaryLink('shoe','banana'),null);
  assert.equal(dictionaryLink('cheap','expensive'),null);
  assert.equal(dictionaryLink('qwertyzzz','calm'),null);
});

test('Rank finds a document that uses different words', () => {
  const docs=[{name:'One',text:'Gaudy cheap jewelry'},{name:'Two',text:'Comfortable sneakers for runners'}];
  assert.equal(top('shoes',docs).name,'Two');
  assert.equal(top('affordable',docs).name,'One');
});

test('close dictionary match scores below an exact word and above a related one', () => {
  const score=(query,text)=>rankCandidates(query,[{name:'x',text}],{synonyms:true})[0].score;
  const exact=score('calm','calm'),close=score('calm','tranquil'),related=score('kid','banter');
  assert.equal(exact,1);
  assert.ok(close<1&&close>related&&related>0);
});

test('unrelated documents still score zero', () => {
  const [r]=rankCandidates('calm',[{name:'x',text:'Truck engine repair manual'}],{synonyms:true});
  assert.equal(r.score,0);
});
