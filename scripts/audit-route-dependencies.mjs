#!/usr/bin/env node
// Read-only Vercel route dependency inventory. Never interprets an unreferenced route as safe to delete.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
function destinationCandidates(route){
  const p=route.split('?')[0].replace(/^\//,'');
  if(!p||p.includes(':')||p.includes('*'))return [];
  const out=[path.join(root,'public',p),path.join(root,p)];
  if(p.startsWith('api/'))out.push(path.join(root,p+'.js'),path.join(root,p+'.mjs'));
  return out;
}
const exists=route=>destinationCandidates(route).some(p=>fs.existsSync(p));
const dependencies=[];
const add=(kind,source,target,extra={})=>dependencies.push({
  kind,source,target,localTargetExists:exists(target),...extra
});
for(const r of config.redirects||[])add('redirect',r.source,r.destination,{permanent:!!r.permanent});
for(const r of config.rewrites||[])add('rewrite',r.source,r.destination);
for(const r of config.crons||[])add('cron',r.path,r.path,{schedule:r.schedule});
for(const [file,settings] of Object.entries(config.functions||{}))add('function-config','/'+file,'/'+file,{maxDuration:settings.maxDuration});
const output={
 generatedAt:new Date().toISOString(),
 note:'Read-only route configuration inventory. Missing local file may be dynamic, aliased, or an intentional proxy. Investigate; never automatically delete.',
 counts:Object.fromEntries(['redirect','rewrite','cron','function-config'].map(kind=>[kind,dependencies.filter(x=>x.kind===kind).length])),
 dependencies,
 nonResolvedTargets:dependencies.filter(d=>!d.localTargetExists)
};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(output,null,2)+'\n');
else console.log(JSON.stringify(output,null,2));
