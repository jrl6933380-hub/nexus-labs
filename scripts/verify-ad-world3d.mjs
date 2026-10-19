#!/usr/bin/env node
// Explicit browser suite; run with npm run test:ad-world3d -- --chromium <path>.
// Requires a WebGL-capable Chromium (software rendering is supported), ffmpeg/ffprobe.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {chromium} from '@playwright/test';
import {composeWorld3DBrief,WORLD3D_SUBJECTS} from '../lib/adWorld3D.js';
import {seedPlayerHtml,projectFromInput,sha256Hex} from '../lib/adExport.js';
import {decodePng} from '../lib/adBenchmark.js';

const a={};for(let i=2;i<process.argv.length;i+=2){if(!['--out','--chromium'].includes(process.argv[i])||!process.argv[i+1])throw Error('Use --out <dir> [--chromium <path>]');a[process.argv[i].slice(2)]=process.argv[i+1];}
const out=resolve(a.out||'test-results/world3d');await mkdir(out,{recursive:true});
const exec=promisify(execFile),player=await readFile(new URL('../public/ad-designs/vocabulary-player.html',import.meta.url),'utf8');
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage'],...((a.chromium||process.env.CHROMIUM_PATH)?{executablePath:a.chromium||process.env.CHROMIUM_PATH}:{})});
const report={at:new Date().toISOString(),browser:browser.version(),viewport:'800x450',checks:[],pictures:[]};
const base=(subject='bottle')=>composeWorld3DBrief({business_name:'3D language test',subject,material:'metal',length_sec:6}).project;
const check=async(name,fn)=>{try{report.checks.push({name,pass:true,...await fn()});}catch(e){report.checks.push({name,pass:false,error:e.message});}console.log(JSON.stringify(report.checks.at(-1)));};
async function open(project,name,query='',options={}){
  projectFromInput(project);const file=join(out,name+'.html');await writeFile(file,seedPlayerHtml(player,project,options.images||{}));
  const ctx=await browser.newContext({viewport:{width:800,height:450},deviceScaleFactor:options.scale||1});
  await ctx.route('**/*',r=>/^(file|data):/.test(r.request().url())?r.continue():r.abort());
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({disable3D})=>{window.__released3d=0;const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){if(disable3D&&args[0]==='webgl')return null;const gl=get.apply(this,args);if(args[0]==='webgl'&&gl){const ext=gl.getExtension.bind(gl);gl.getExtension=function(name){const value=ext(name);if(name==='WEBGL_lose_context'&&value){const lose=value.loseContext.bind(value);return{loseContext(){window.__released3d++;lose();}};}return value;};}return gl;};},{disable3D:!!options.noWebGL});
  await page.goto(pathToFileURL(file).href+'?capture=1'+query);await page.waitForFunction(()=>!!window.__capture);
  return{page,ctx,errors};
}
async function capture(page,ms,file,transparent=false){await page.evaluate(t=>window.__capture(t),ms);const png=await page.screenshot({type:'png',omitBackground:transparent});if(file){await writeFile(join(out,file),png);report.pictures.push(file);}return png;}
const equal=(a,b)=>{const A=decodePng(a),B=decodePng(b);assert.equal(A.width,B.width);assert.equal(A.height,B.height);assert.equal(A.channels,B.channels);assert.ok(A.data.equals(B.data),'decoded pixels differ');};
const delta=(a,b,fromY=0)=>{const A=decodePng(a),B=decodePng(b);let count=0;for(let y=Math.floor(A.height*fromY);y<A.height;y++)for(let x=0;x<A.width;x++){let d=0;for(let c=0;c<3;c++)d+=Math.abs(A.data[(y*A.width+x)*A.channels+c]-B.data[(y*B.width+x)*B.channels+c]);if(d>12)count++;}return count;};
const cli=(script,args)=>exec(process.execPath,[script,...args,...(a.chromium?['--chromium',a.chromium]:[])],{maxBuffer:2e6});
try{
  const assetPage=await browser.newPage();
  const maps=await assetPage.evaluate(()=>{
    const c=document.createElement('canvas');c.width=300;c.height=190;const x=c.getContext('2d');
    x.fillStyle='#eee6cf';x.fillRect(0,0,300,190);x.fillStyle='#137e95';x.fillRect(0,0,300,65);x.fillStyle='#d25132';x.fillRect(0,125,300,65);
    x.fillStyle='#17323d';x.font='bold 35px sans-serif';x.textAlign='center';x.fillText('NEXUS',150,108);const color=c.toDataURL('image/png');
    x.fillStyle='#777777';x.fillRect(0,0,300,190);x.fillStyle='#222222';x.fillRect(0,0,150,190);return{color,rough:x.canvas.toDataURL('image/png')};
  });await assetPage.close();
  const images={'img-0000000001':{src:maps.color,source:'uploaded'},'img-0000000002':{src:maps.rough,source:'uploaded'}};
  const textured=(projection='cylindrical')=>{
    const p=base();p.scenes[0].params.objects.forEach(o=>{if(o.id==='body'){o.color='#ffffff';o.colorMap='img-0000000001';o.mapProjection=projection;o.material='plastic';}});return p;
  };
  await check('all four projections render decoded NPOT maps and shuffled seeks are exact',async()=>{
    const changes={};
    for(const projection of ['box','cylindrical','spherical','planar']){
      const p=textured(projection),first=await open(p,'texture-'+projection,'',{images});let A;
      try{A=await capture(first.page,1500,'texture-'+projection+'.png');assert.deepEqual(first.errors,[]);for(const t of [0,3000,1500])await capture(first.page,t);equal(A,await capture(first.page,1500));}finally{await first.ctx.close();}
      delete p.scenes[0].params.objects.find(o=>o.id==='body').colorMap;delete p.scenes[0].params.objects.find(o=>o.id==='body').mapProjection;
      const second=await open(p,'untextured-'+projection);try{changes[projection]=delta(A,await capture(second.page,1500));assert.ok(changes[projection]>500);}finally{await second.ctx.close();}
    }return{changedPixels:changes};
  });
  await check('roughness maps, repeat and offsets change surface pixels',async()=>{
    const p=textured(),body=p.scenes[0].params.objects.find(o=>o.id==='body');body.roughness=1;
    const first=await open(p,'color-only','',{images});let A;try{A=await capture(first.page,1000);}finally{await first.ctx.close();}
    body.roughnessMap='img-0000000002';const second=await open(p,'roughness-map','',{images});let B;
    try{B=await capture(second.page,1000,'roughness-map.png');assert.ok(delta(A,B)>100);}finally{await second.ctx.close();}
    body.mapScale=2;body.mapOffsetX=.25;body.mapOffsetY=.15;const third=await open(p,'repeated-map','',{images});try{const changed=delta(B,await capture(third.page,1000,'repeated-map.png'));assert.ok(changed>500);return{changedPixels:changed};}finally{await third.ctx.close();}
  });
  await check('texture decode failures refuse capture with the exact image ID',async()=>{
    const p=textured(),bad={'img-0000000001':{src:'data:image/png;base64,AAAA',source:'uploaded'}};
    const {page,ctx}=await open(p,'bad-texture','',{images:bad});try{await assert.rejects(capture(page,0),/3D surface map "img-0000000001": image decode failed\./);return{refused:true};}finally{await ctx.close();}
  });
  await check('texture capture waits for decode, releases contexts and preserves transparent background',async()=>{
    const p=textured();p.scenes[0].params.objects=p.scenes[0].params.objects.filter(o=>o.id!=='floor');
    const {page,ctx}=await open(p,'texture-alpha','&transparent=1',{images});try{
      const A=await capture(page,1500,'texture-alpha.png',true),im=decodePng(A);assert.equal(im.channels,4);assert.equal(im.data[3],0);
      for(let i=0;i<3;i++){await capture(page,5000);equal(A,await capture(page,1500,null,true));}assert.ok(await page.evaluate(()=>window.__released3d)>=3);return{contextsReleased:3};
    }finally{await ctx.close();}
  });
  await check('textured preview, still, sequence and a real H.264 export use the same assets',async()=>{
    const p=textured(),pf=join(out,'textured-project.json'),imf=join(out,'texture-images.json');await writeFile(pf,JSON.stringify(p,null,2));await writeFile(imf,JSON.stringify(images));
    const {page,ctx}=await open(p,'textured-agreement','',{images});try{
      const ref=await capture(page,1500,'textured-capture.png');
      await cli('scripts/export-ad-still.mjs',['--project',pf,'--images',imf,'--out',join(out,'textured-still.png'),'--at','1.5','--scale','1']);equal(ref,await readFile(join(out,'textured-still.png')));
      await cli('scripts/export-ad-sequence.mjs',['--project',pf,'--images',imf,'--out',join(out,'textured-sequence'),'--from','1.5','--to','1.625','--fps','24','--scale','1']);equal(ref,await readFile(join(out,'textured-sequence/frame-000001.png')));
      await cli('scripts/export-ad-mp4.mjs',['--project',pf,'--images',imf,'--out',join(out,'textured.mp4'),'--fps','24','--scale','1']);
      const {stdout}=await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(out,'textured.mp4')]);const r=JSON.parse(stdout),v=r.streams.find(s=>s.codec_type==='video');assert.equal(v.codec_name,'h264');assert.equal(v.width,800);assert.equal(v.height,450);assert.equal(v.avg_frame_rate,'24/1');assert.equal(Number(r.format.duration),6);return{exactComparisons:2,codec:'h264',seconds:6};
    }finally{await ctx.close();}
  });
  for(const subject of WORLD3D_SUBJECTS)await check(subject+' preset produces visible 3D geometry',async()=>{
    const p=base(subject),{page,ctx,errors}=await open(p,subject);
    try{await capture(page,1500,subject+'.png');assert.equal(await page.locator('canvas[data-world3d]').count(),1);assert.deepEqual(errors,[]);assert.deepEqual((await page.evaluate(()=>window.__captureInfo())).errors,[]);return{objects:p.scenes[0].params.objects.length};}finally{await ctx.close();}
  });
  await check('continuous bottle profile and physical device bevel change actual rendered pixels',async()=>{
    const changes={};
    for(const subject of ['bottle','device']){
      const p=base(subject),after=await open(p,'shaped-'+subject);let A;
      try{A=await capture(after.page,1500,'shaped-'+subject+'-after.png');assert.deepEqual(after.errors,[]);}finally{await after.ctx.close();}
      if(subject==='device')p.scenes[0].params.objects.forEach(o=>{if(o.shape==='rounded_box'){o.shape='box';delete o.radius;}});
      else {
        const objects=p.scenes[0].params.objects;p.scenes[0].params.objects=objects.filter(o=>o.id!=='body');
        p.scenes[0].params.objects.push({id:'body',parent:'product',shape:'cylinder',y:.6,w:.7,h:1.2,d:.7,material:'metal',color:'#49a7c9'},
          {id:'shoulder',parent:'product',shape:'sphere',y:1.18,w:.7,h:.32,d:.7,material:'metal',color:'#49a7c9'},
          {id:'neck',parent:'product',shape:'cylinder',y:1.4,w:.27,h:.34,d:.27,material:'metal',color:'#49a7c9'});
      }
      const before=await open(p,'primitive-'+subject);try{changes[subject]=delta(A,await capture(before.page,1500,'shaped-'+subject+'-before.png'));assert.ok(changes[subject]>100);}finally{await before.ctx.close();}
    }
    return{changedPixels:changes};
  });
  await check('distinct lathe profiles do not share the wrong cached mesh',async()=>{
    const p=base(),profile=[{r:.45,y:-.5},{r:.5,y:0},{r:.25,y:.5}];
    p.scenes[0].params={objects:[-1,1].map((side,i)=>({id:'body-'+i,shape:'lathe',x:side*.7,y:.6,w:.7,h:1.2,d:.7,profile:structuredClone(profile),color:'#49a7c9',material:'metal',castShadow:false})),cameraPath:[{t:0,x:0,y:.6,z:5,lookY:.6}],ambient:.6};
    const first=await open(p,'profile-cache-a');let A;try{A=decodePng(await capture(first.page,1000));}finally{await first.ctx.close();}
    p.scenes[0].params.objects[1].profile=[{r:.1,y:-.5},{r:.2,y:0},{r:.5,y:.5}];
    const second=await open(p,'profile-cache-b');try{
      const B=decodePng(await capture(second.page,1000,'distinct-profiles.png'));let left=0,right=0;
      for(let y=0;y<A.height;y++)for(let x=0;x<A.width;x++){const at=(y*A.width+x)*A.channels;let d=0;for(let c=0;c<3;c++)d+=Math.abs(A.data[at+c]-B.data[at+c]);if(d>12){if(x<400)left++;else right++;}}
      assert.equal(left,0);assert.ok(right>100);return{unchangedLeftPixels:left,changedRightPixels:right};
    }finally{await second.ctx.close();}
  });
  await check('3D depth occlusion works independently of object draw order',async()=>{
    const p=base();p.scenes[0].params={objects:[{id:'front',shape:'box',y:.7,z:1,w:1,h:1,d:.3,color:'#2255ee',material:'rubber'},{id:'back',shape:'box',y:.7,z:0,w:2,h:2,d:.3,color:'#ee3322',material:'rubber'}],cameraPath:[{t:0,x:0,y:.7,z:5,lookY:.7}],ambient:1,lights:[{type:'directional',x:2,y:5,z:4,color:'#ffffff',intensity:2}]};
    const first=await open(p,'occlusion-a');let A;try{A=await capture(first.page,1000,'occlusion.png');const i=decodePng(A),at=(225*800+400)*i.channels;assert.ok(i.data[at+2]>i.data[at]+40,'front blue object covers red back object');}finally{await first.ctx.close();}
    p.scenes[0].params.objects.reverse();const second=await open(p,'occlusion-b');try{equal(A,await capture(second.page,1000));return{independentOfDrawOrder:true};}finally{await second.ctx.close();}
  });
  await check('directional light produces a floor shadow from actual geometry',async()=>{
    const p=base(),first=await open(p,'shadow-on');let A;try{A=await capture(first.page,1000,'shadow-on.png');}finally{await first.ctx.close();}
    p.scenes[0].params.objects.forEach(o=>{o.castShadow=false;});const second=await open(p,'shadow-off');
    try{const B=await capture(second.page,1000,'shadow-off.png'),changed=delta(A,B,.55);assert.ok(changed>100,'shadow must change visible floor pixels');return{changedFloorPixels:changed};}finally{await second.ctx.close();}
  });
  await check('roughness and metalness alter the rendered surface',async()=>{
    const p=base(),first=await open(p,'metal');let A;try{A=await capture(first.page,1000);}finally{await first.ctx.close();}
    p.scenes[0].params.objects.forEach(o=>{if(o.parent){o.material='rubber';o.metalness=0;o.roughness=.95;}});
    const second=await open(p,'rubber');try{const changed=delta(A,await capture(second.page,1000,'rubber.png'));assert.ok(changed>300);return{changedPixels:changed};}finally{await second.ctx.close();}
  });
  await check('orbit camera changes projection and shuffled seeks reproduce exact frames',async()=>{
    const p=base('sculpture'),{page,ctx}=await open(p,'seeks');
    try{await capture(page,0);const refs=new Map(),times=[0,500,1500,2500,3500];for(const t of times)refs.set(t,await capture(page,t));assert.ok(delta(refs.get(0),refs.get(3500))>1000);for(const t of [3500,2500,1500,500,0,2500,0,1500])equal(refs.get(t),await capture(page,t));return{comparisons:8};}finally{await ctx.close();}
  });
  await check('leaving a 3D scene releases the WebGL context; return seeks remain stable',async()=>{
    const {page,ctx}=await open(base(),'dispose');
    try{const ref=await capture(page,1500);for(let i=0;i<8;i++){await capture(page,5000);equal(ref,await capture(page,1500));}const released=await page.evaluate(()=>window.__released3d);assert.ok(released>=8);return{contextsReleased:released};}finally{await ctx.close();}
  });
  await check('transparent still preserves real alpha outside 3D objects',async()=>{
    const p=base();p.scenes[0].params.objects=p.scenes[0].params.objects.filter(o=>o.id!=='floor');
    const {page,ctx}=await open(p,'alpha','&transparent=1');
    try{const im=decodePng(await capture(page,1000,'alpha.png',true));assert.equal(im.channels,4);assert.equal(im.data[3],0);assert.ok(im.data.some((v,i)=>i%4===3&&v===255));return{channels:4};}finally{await ctx.close();}
  });
  await check('preview, still exporter and sequence frame agree',async()=>{
    const p=base(),pf=join(out,'project.json');await writeFile(pf,JSON.stringify(p,null,2));const {page,ctx}=await open(p,'agreement');
    try{const ref=await capture(page,1500,'capture.png');await page.evaluate(p=>window.renderAdFrame({timeMs:1500,durationMs:6000,sceneId:'studio-3d',sceneProgress:.375,sceneIndex:0,project:p,width:800,height:450,format:'landscape'}),p);equal(ref,await page.screenshot());
      await cli('scripts/export-ad-still.mjs',['--project',pf,'--out',join(out,'still.png'),'--at','1.5','--scale','1']);equal(ref,await readFile(join(out,'still.png')));
      await cli('scripts/export-ad-sequence.mjs',['--project',pf,'--out',join(out,'sequence'),'--from','1.5','--to','1.625','--fps','24','--scale','1']);equal(ref,await readFile(join(out,'sequence/frame-000001.png')));return{comparisons:3,projectSha256:sha256Hex(JSON.stringify(p))};
    }finally{await ctx.close();}
  });
  await check('3D MP4 export encodes a playable 6-second H.264 file',async()=>{
    await cli('scripts/export-ad-mp4.mjs',['--project',join(out,'project.json'),'--out',join(out,'world3d.mp4'),'--fps','24','--scale','1','--crf','18']);
    const {stdout}=await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(out,'world3d.mp4')]);const r=JSON.parse(stdout),v=r.streams.find(s=>s.codec_type==='video');assert.equal(v.codec_name,'h264');assert.equal(v.width,800);assert.equal(v.height,450);assert.equal(v.avg_frame_rate,'24/1');assert.ok(Math.abs(Number(r.format.duration)-6)<.05);return{codec:v.codec_name,seconds:Number(r.format.duration)};
  });
  await check('unavailable WebGL refuses frame capture with a clear error',async()=>{
    const {page,ctx}=await open(base(),'unsupported','',{noWebGL:true});try{await assert.rejects(capture(page,1000),/3D renderer unavailable/);return{refused:true};}finally{await ctx.close();}
  });
}finally{
  await browser.close();report.pass=report.checks.length===20&&report.checks.every(c=>c.pass);
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const pictures=[];for(const name of [...new Set(report.pictures)])pictures.push(`<figure><img alt="${esc(name)}" src="data:image/png;base64,${(await readFile(join(out,name))).toString('base64')}"><figcaption>${esc(name)}</figcaption></figure>`);
  let video='';try{video=`<video controls preload="metadata" src="data:video/mp4;base64,${(await readFile(join(out,'world3d.mp4'))).toString('base64')}"></video>`;}catch{}
  try{video+=`<h2>Textured concept · synthetic test artwork</h2><video controls preload="metadata" src="data:video/mp4;base64,${(await readFile(join(out,'textured.mp4'))).toString('base64')}"></video>`;}catch{}
  await writeFile(join(out,'review.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nexus 3D language review</title><style>body{max-width:1300px;margin:24px auto;padding:0 16px;background:#10141a;color:#eee;font:16px/1.5 system-ui}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}figure{margin:0}img,video{max-width:100%;height:auto}figcaption{margin:4px 0 18px;color:#aab5c4}video{width:800px}li{margin:6px}</style><h1>Nexus visual language 1.3 · Surface maps</h1><p>Procedural geometry, material response, perspective and mapped shadows. Concept assemblies, not supplied product assets or photorealistic-human claims.</p><p>Browser checks: ${report.checks.filter(c=>c.pass).length}/${report.checks.length} passed.</p>${video}<div class="grid">${pictures.join('')}</div><ul>${report.checks.map(c=>`<li>${c.pass?'PASS':'FAIL'} — ${esc(c.name)}</li>`).join('')}</ul></html>`);
  console.log(JSON.stringify({pass:report.pass,report:join(out,'report.json'),failures:report.checks.filter(c=>!c.pass)}));if(!report.pass)process.exitCode=1;
}
