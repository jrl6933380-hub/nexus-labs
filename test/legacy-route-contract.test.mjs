import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
const redirects=new Map((config.redirects||[]).map(({source,destination})=>[source,destination]));
const canonical = new Map([
 ['/mission-control.html','/workspace.html?view=deck'],
 ['/conference-room.html','/workspace.html?view=agents'],
 ['/memory.html','/workspace.html?view=memory'],
 ['/queue.html','/workspace.html?view=approvals'],
 ['/connectors.html','/workspace.html?view=skills'],
 ['/tenants.html','/workspace.html?view=forge'],
 ['/nexus-canvas.html','/workspace.html?view=messages'],
 ['/thoughtspace.html','/workspace.html?view=messages']
]);
test('Legacy operator bookmarks retain canonical Vercel redirects',()=>{
 for(const [oldPath,newPath] of canonical) assert.equal(redirects.get(oldPath),newPath,oldPath);
});
test('Canonical workspace file still exists',()=>{
 assert.ok(fs.existsSync(new URL('../public/workspace.html',import.meta.url)));
});
test('Edge-redirected legacy URLs remain covered',()=>{
 for(const route of canonical.keys()) assert.ok(redirects.has(route),route);
});
test('Nexus Space remains browser handled to preserve fragments',()=>{
 assert.ok(!redirects.has('/nexus-space.html'));
 assert.ok(fs.existsSync(new URL('../public/nexus-space.html',import.meta.url)));
});
