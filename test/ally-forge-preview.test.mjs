import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {choose,buildPack,writePack,run,latestBatchName,launchOffer} from '../scripts/ally/forge-preview.mjs';

const cand=(name,status,extra={})=>({name,location:'Des Moines, IA',status,notes:'Checked sources.',evidence_urls:['https://example.com/a'],map_url:'https://www.google.com/maps/search/?api=1&query=x',checked_at:'2026-11-08T10:00:00Z',...extra});
const batch=(candidates)=>({version:1,spec:{business:'barbers',city:'Des Moines, IA',count:10},created_at:'2026-11-08T10:00:00Z',status:'ready_for_review',candidates});
const sample=()=>batch([
 cand('North End Barbershop','social_booking_only',{phone_suggestion:'(515) 555-0101'}),
 cand('Corner <b>Cuts</b>','no_dedicated_site_found'),
 cand('Big Chain Barbers','has_website'),
 cand('Maybe Barbers','needs_checking'),
 cand('Old Find Barbers','no_dedicated_site_found',{duplicate:true})
]);

test('eligible means no-site or social-only, never an existing site, duplicate or unchecked lead',()=>{
 const picked=choose(sample(),'eligible');
 assert.deepEqual(picked.map(p=>p.position),[1,2]);
});

test('explicit picks refuse existing websites and duplicates, and require a finished batch',()=>{
 assert.throws(()=>choose(sample(),[3]),/already has a website/);
 assert.throws(()=>choose(sample(),[5]),/earlier batch/);
 assert.throws(()=>choose(sample(),[9]),/Pick 1-10/);
 assert.throws(()=>choose(sample(),[]),/Pick 1-10/);
 assert.throws(()=>choose({...sample(),status:'searching_google'},'eligible'),/finished/);
 assert.equal(choose(sample(),[4])[0].candidate.name,'Maybe Barbers');
 assert.throws(()=>choose(batch([cand('X','has_website')]),'eligible'),/No eligible leads/);
});

test('pack has three previews, a pitch and an index per lead; text is escaped; no unverified phone is placed on a site',()=>{
 const pack=buildPack({batch:sample(),picks:'eligible'});
 const paths=pack.files.map(f=>f.path);
 for(const folder of ['01-north-end-barbershop','02-corner-b-cuts-b']){
  for(const file of ['editorial.html','bold.html','fresh.html','pitch.txt','pitch.json'])assert.ok(paths.includes(`${folder}/${file}`),folder+'/'+file);
 }
 assert.ok(paths.includes('index.html')&&paths.includes('pack.json'));
 const html=pack.files.filter(f=>f.path.endsWith('.html')&&f.path!=='index.html');
 for(const f of html){assert.doesNotMatch(f.content,/555-0101/);assert.doesNotMatch(f.content,/<b>Cuts<\/b>/);}
 const index=pack.files.find(f=>f.path==='index.html').content;
 assert.match(index,/Content-Security-Policy/);assert.doesNotMatch(index,/<b>Cuts<\/b>/);assert.match(index,/Nothing was sent/);
 const pitch=pack.files.find(f=>f.path==='01-north-end-barbershop/pitch.json').content;
 assert.match(pitch,/555-0101/);
});

test('pitch is honest: no research date claim, no invented price unless the launch offer is chosen, nothing sent',()=>{
 const plain=buildPack({batch:sample(),picks:[1]});
 const text=plain.files.find(f=>f.path.endsWith('pitch.txt')).content;
 assert.match(text,/social or booking pages/);assert.doesNotMatch(text,/checked 2026/);
 assert.match(text,/Check the approved Forge offer/);assert.match(text,/Nothing has been sent/);
 const launch=buildPack({batch:sample(),picks:[1],offer:launchOffer()});
 assert.match(launch.files.find(f=>f.path.endsWith('pitch.txt')).content,/\$20 total at signup.*\$10\/month/);
});

test('writePack creates a new folder and never overwrites; run lists and builds from saved batches only',async()=>{
 const root=await mkdtemp(join(tmpdir(),'forge-preview-'));
 try{
  const name='batch-11111111-2222-3333-4444-555555555555';
  await mkdir(join(root,'batches',name),{recursive:true});
  await writeFile(join(root,'batches',name,'batch.json'),JSON.stringify(sample()));
  await mkdir(join(root,'batches','batch-aaaaaaaa-0000-0000-0000-000000000000'),{recursive:true});
  await writeFile(join(root,'batches','batch-aaaaaaaa-0000-0000-0000-000000000000','batch.json'),JSON.stringify({...sample(),status:'needs_attention'}));
  assert.equal(await latestBatchName(root),name);
  const listed=await run({batch:'latest',list:true,root});
  assert.match(listed.lines[0],/^1\. North End Barbershop \| social_booking_only/);
  const now=new Date('2026-11-09T08:00:00Z');
  const result=await run({batch:name,picks:'eligible',root,now});
  assert.equal(result.leads,2);
  assert.match(await readFile(join(result.dir,'index.html'),'utf8'),/North End Barbershop/);
  await assert.rejects(()=>run({batch:name,picks:'eligible',root,now}),/EEXIST/);
  await assert.rejects(()=>run({batch:'..\\evil',picks:'eligible',root}),/Unexpected batch name/);
  await assert.rejects(()=>run({batch:'../../etc',picks:'eligible',root}),/Unexpected batch name/);
  assert.ok((await readdir(join(root,'previews'))).length===1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('previews contain no scripts or network calls that could contact anyone',()=>{
 const pack=buildPack({batch:sample(),picks:'eligible'});
 for(const f of pack.files.filter(x=>x.path.endsWith('.html')&&x.path!=='index.html')){
  assert.doesNotMatch(f.content,/fetch\(|XMLHttpRequest|navigator\.sendBeacon|<form[^>]+action=["']https?:/i,f.path);
 }
});
