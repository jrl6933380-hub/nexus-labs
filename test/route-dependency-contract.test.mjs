import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
test('Every scheduled API job retains a routable path',()=>{
 const crons=config.crons||[];
 assert.ok(crons.length>0,'Expected existing scheduled jobs');
 for(const cron of crons){
  assert.ok(cron.path.startsWith('/api/'),cron.path);
  assert.ok(cron.schedule,cron.path);
  const pathname=cron.path.split('?')[0];
  const mapped=(config.rewrites||[]).find(r=>r.source===pathname)?.destination||pathname;
  const relative=mapped.split('?')[0].replace(/^\//,'');
  assert.ok(fs.existsSync(new URL('../'+relative+'.js',import.meta.url))||
    fs.existsSync(new URL('../'+relative+'.mjs',import.meta.url)),
    'Cron target missing: '+cron.path+' -> '+mapped);
 }
});
test('OAuth and MCP routing stays configured',()=>{
 const rewrites=new Map((config.rewrites||[]).map(r=>[r.source,r.destination]));
 for(const path of ['/authorize','/token','/register','/revoke','/.well-known/oauth-authorization-server']){
   assert.match(rewrites.get(path)||'',/^\/api\/workspace-oauth\?/,'Missing OAuth route '+path);
 }
});
test('Legacy redirects are not rewritten into API endpoints',()=>{
 for(const route of config.redirects||[]){
   if(['/mission-control.html','/conference-room.html','/memory.html','/queue.html','/connectors.html','/tenants.html','/nexus-canvas.html','/thoughtspace.html','/nexus-space.html'].includes(route.source)){
      assert.match(route.destination,/^\/workspace\.html\?view=/);
   }
 }
});
