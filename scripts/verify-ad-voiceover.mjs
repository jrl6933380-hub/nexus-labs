// Local HTTP + real browser check. Uses isolated in-memory account data, never production.
import express from 'express';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fixture} from '../test/helpers/ad-voiceover-fixture.mjs';
const f=await fixture(),app=express();
app.use(express.json({limit:'1mb'}));
app.post('/api/ad-voiceover',(req,res)=>{req.user='alice';return f.handler(req,res);});
app.post('/api/ad-campaigns',async(req,res)=>{const {action}=req.body;res.json({ok:true,data:action==='read'?f.record:action==='images'?{images:{}}:{campaigns:[]}});});
app.use(express.static(new URL('../public',import.meta.url).pathname));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const origin='http://127.0.0.1:'+server.address().port;
// A valid PCM WAV forces multiple upload chunks and lets the browser preview actual sound.
const pcm=Buffer.alloc(600000),wav=Buffer.alloc(44+pcm.length);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
let browser;
try{
 console.log('Launching browser');browser=await chromium.launch({headless:true,timeout:15000,...(process.env.NEXUS_BROWSER_LOW_MEMORY==='1'?{args:['--single-process','--no-zygote','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage','--js-flags=--max-old-space-size=128']}: {})});
 const context=await browser.newContext({viewport:{width:393,height:852},acceptDownloads:true}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 console.log('Opening page');await page.goto(origin+'/ad-view.html?ad=voice-ad#voiceover');
 console.log('Waiting for voice controls');await page.locator('#voiceover:visible').waitFor();
 assert.equal(await page.locator('#voice-export').isDisabled(),true);
 console.log('Uploading multi-chunk WAV');await page.locator('#voice-file').setInputFiles({name:'ElevenLabs fixture.wav',mimeType:'audio/wav',buffer:wav});
 await page.getByText('Voiceover attached. Listen above, then export the video.').waitFor();
 assert.ok(await page.locator('#voice-audio').evaluate(async a=>{if(a.readyState<1)await new Promise(r=>a.addEventListener('loadedmetadata',r,{once:true}));return a.duration>10;}));
 await page.reload();await page.getByText('ElevenLabs fixture.wav',{exact:true}).waitFor();
 await page.locator('#voice-export').click();await page.getByText('Export queued.',{exact:false}).waitFor();
 const queued=(await f.jobs.list('alice')).jobs[0];assert.equal(queued.options.audio_media_id,(await f.voices.get('alice','voice-ad')).media_id);
 await page.reload();await page.getByText('Export queued.',{exact:false}).waitFor();
 const claimed=await f.jobs.claim('browser-fixture');assert.ok(claimed);
 // Provide a real decodable MP4, as the production worker does after capture/encoding.
 const out='/tmp/nexus-voice-fixture.mp4';
 const enc=spawnSync('ffmpeg',['-y','-loglevel','error','-f','lavfi','-i','color=c=black:s=360x640:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-threads','1','-c:a','aac','-movflags','+faststart','-shortest',out]);
 assert.equal(enc.status,0,enc.stderr?.toString());
 const video=await readFile(out);
 await f.jobs.putFile('alice',queued.job_id,{name:'ad.mp4',mime:'video/mp4',buffer:video});await f.jobs.complete('alice',queued.job_id,{audio:'yes',duration_sec:1});
 await page.locator('#voice-load:visible').waitFor({timeout:15000});await page.locator('#voice-load').click();await page.locator('#voice-download:visible').waitFor();
 await page.locator('#voice-video').evaluate(async v=>{if(v.readyState<1)await new Promise(r=>v.addEventListener('loadedmetadata',r,{once:true}));});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const downloaded=page.waitForEvent('download');await page.locator('#voice-download').click();const file=await downloaded;assert.match(file.suggestedFilename(),/voiceover\.mp4$/);assert.deepEqual(await readFile(await file.path()),video);
 await mkdir('test-results/ad-voiceover',{recursive:true});await page.screenshot({path:'test-results/ad-voiceover/mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'test-results/ad-voiceover/desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS mobile upload → audio preview → reload → export with audio → reload while queued → finished MP4 preview → verified download; desktop layout');
}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
