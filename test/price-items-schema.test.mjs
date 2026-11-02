import test from 'node:test';
import assert from 'node:assert/strict';
import {genericResultSchema} from '../lib/researchJobs.js';
import {buildPriceResult,parseUrls} from '../lib/priceBaselines.js';
test('the completion schema lets Price Change Check send its per-link items',()=>{
 const urls=parseUrls('https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html');
 const result={summary:'Checked 1 link',sections:[{title:'Checks',items:[]}],items:[{url:urls[0],status:'ok',product:'A Light in the Attic',price:51.77,currency:'GBP',available:'in_stock',evidence:'£51.77'}]};
 const parsed=genericResultSchema.parse(result);
 assert.equal(parsed.items.length,1);
 const b=buildPriceResult({urls,items:parsed.items,baselines:new Map(),at:1});
 assert.equal(b.checked,1);
 // What gets stored is the server-built result, which carries no raw items.
 assert.equal(genericResultSchema.parse(b.result).items,undefined);
});
test('the schema is still strict about unknown fields and bounded',()=>{
 assert.throws(()=>genericResultSchema.parse({summary:'x',sections:[{title:'a'}],bogus:1}));
 assert.throws(()=>genericResultSchema.parse({summary:'x',sections:[{title:'a'}],items:Array.from({length:21},()=>({}))}));
});
