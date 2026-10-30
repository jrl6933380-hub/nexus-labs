#!/usr/bin/env node
// Read-only route and reference audit. No files are deleted or modified.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
function walk(dir){if(!fs.existsSync(dir))return [];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{if(entry.name==='node_modules'||entry.name==='.git'||entry.name==='dist')return [];const p=path.join(dir,entry.name);return entry.isDirectory()?walk(p):[p];});}
const files=[...walk(path.join(root,'public')),...walk(path.join(root,'api')),...walk(path.join(root,'lib')),...walk(path.join(root,'android')),...walk(path.join(root,'scripts')),...walk(path.join(root,'test'))].filter(f=>/\.(html|js|mjs|json|java|kt)$/.test(f));
const entries=files.map(f=>({file:path.relative(root,f).replaceAll(path.sep,'/'),text:fs.readFileSync(f,'utf8')}));
const html=entries.filter(x=>x.file.startsWith('public/')&&x.file.endsWith('.html'));
const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const redirects=(config.redirects||[]).map(({source,destination,permanent})=>({source,destination,permanent}));
const candidates=html.map(x=>{
 const url='/'+x.file.slice('public/'.length);
 const matches=entries.filter(item=>item.file!==x.file && (item.text.includes(url)||item.text.includes(path.basename(x.file)))).map(item=>item.file);
 const redirect=redirects.find(r=>r.source===url);
 return {url,file:x.file,redirect:redirect?.destination||null,referenceCount:matches.length,referenceExamples:matches.slice(0,12),classification:redirect?'redirected-review-only':matches.length===0?'unreferenced-investigate':'referenced-keep-until-verified'};
});
const output={generatedAt:new Date().toISOString(),note:'Static reference heuristic only: absence of textual references is NOT proof a route is unused; external bookmarks, dynamic route assembly, integrations and server rewrites need manual validation.',counts:{scannedFiles:entries.length,publicHtml:html.length,redirects:redirects.length,apiFiles:entries.filter(x=>x.file.startsWith('api/')).length,libraryFiles:entries.filter(x=>x.file.startsWith('lib/')).length},redirects,candidates};
const dest=process.argv[2];if(dest)fs.writeFileSync(dest,JSON.stringify(output,null,2)+'\n');else console.log(JSON.stringify(output,null,2));
