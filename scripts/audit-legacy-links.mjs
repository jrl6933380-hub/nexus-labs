#!/usr/bin/env node
// Read-only references report: intended to guide migration, not automatically remove pages.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const legacy=(cfg.redirects||[]).filter(r=>r.source.endsWith('.html')).map(r=>({source:r.source,destination:r.destination}));
const included=['public','api','lib','android','test','e2e'];
function walk(dir){
 if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  if(['node_modules','dist','.git'].includes(e.name))return [];
  const full=path.join(dir,e.name);
  return e.isDirectory()?walk(full):[full];
 });
}
const files=included.flatMap(d=>walk(path.join(root,d))).filter(f=>/\.(?:html|js|mjs|ts|tsx|jsx|java|kt|css)$/.test(f));
const refs=legacy.map(route=>{
 const basename=path.basename(route.source);
 const references=[];
 for(const file of files){
  const relative=path.relative(root,file).replaceAll(path.sep,'/');
  if(relative==='public/'+basename)continue;
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);
  for(let n=0;n<lines.length;n++){
   if(lines[n].includes(route.source)||lines[n].includes(basename)){
    references.push({file:relative,line:n+1,excerpt:lines[n].trim().slice(0,220)});
   }
  }
 }
 return {...route,staticFilePresent:fs.existsSync(path.join(root,'public',basename)),referenceCount:references.length,references};
});
const output={generatedAt:new Date().toISOString(),notice:'Static references include tests and fallback links. No-reference does not prove safe retirement; verify traffic, dynamically assembled URLs, redirects and hash-based routes.',routes:refs};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(output,null,2)+'\n');
else console.log(JSON.stringify(output,null,2));
