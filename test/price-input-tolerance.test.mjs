import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPriceResult,parseUrls} from '../lib/priceBaselines.js';
const urls=parseUrls('https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html');
const run=item=>buildPriceResult({urls,items:[{url:urls[0],status:'ok',product:'A Light in the Attic',available:'in_stock',evidence:'£51.77',...item}],baselines:new Map(),at:Date.UTC(2026,10,2)});
test('a clean item is checked',()=>assert.equal(run({price:51.77,currency:'GBP'}).checked,1));
test('numeric strings and lowercase currency codes are accepted',()=>{
 for(const price of ['51.77','£51.77',' $51.77 '])assert.equal(run({price,currency:'gbp'}).checked,1,String(price));
 assert.equal(run({price:'1,299.00',currency:'USD'}).updates[0].rec.price,1299);
});
test('unclear prices and currencies are still refused, never guessed',()=>{
 for(const price of ['call us','1.299,00','12 to 15','',null,-3])assert.equal(run({price,currency:'GBP'}).checked,0,String(price));
 for(const currency of ['£','pounds',null])assert.equal(run({price:51.77,currency}).checked,0,String(currency));
});
test('a failed run explains each link',()=>{
 const b=buildPriceResult({urls,items:[{url:urls[0],status:'blocked'}],baselines:new Map(),at:1});
 assert.equal(b.checked,0);
 assert.match(b.result.sections.find(s=>s.title==='Could not check').items[0],/blocked the check/);
});
