import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/nexus-messages.js',import.meta.url),'utf8');
const registry=JSON.parse(fs.readFileSync(new URL('../docs/nexus-feature-registry.json',import.meta.url),'utf8'));
test('Owner creative links target actual pages registered by Nexus',()=>{
 for(const [id,label] of [['ad-maker','Ad Maker'],['image-board','Image Board']]){
  const entry=registry.entries.find(e=>e.id===id);
  assert.ok(entry && entry.audience==='owner');
  assert.ok(fs.existsSync(new URL('../public'+entry.route,import.meta.url)));
  assert.ok(source.includes("name:'"+label+"'"));
  assert.ok(source.includes("window.location.assign('"+entry.route+"')"));
 }
});
test('Creative shortcuts live after customer-only More early return',()=>{
 const more=source.slice(source.indexOf('function moreView('));
 const customer=more.indexOf('if(ctx.customer)');
 const returning=more.indexOf('return;}',customer);
 const firstCreative=more.indexOf("name:'Ad Maker'");
 assert.ok(customer>=0 && returning>customer && firstCreative>returning);
});
