import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
const redirects=new Map((config.redirects||[]).map(item=>[item.source,item.destination]));
test('Retired Thoughtspace bookmark resolves to canonical Messages',()=>{
 assert.equal(redirects.get('/thoughtspace.html'),'/workspace.html?view=messages');
 assert.equal(fs.existsSync(new URL('../public/thoughtspace.html',import.meta.url)),false);
 assert.equal(fs.existsSync(new URL('../public/workspace.html',import.meta.url)),true);
});
test('Legacy hash-sensitive visual space remains available until migrated safely',()=>{
 assert.equal(fs.existsSync(new URL('../public/nexus-space.html',import.meta.url)),true);
});
