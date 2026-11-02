import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const html=await readFile(new URL('../public/ally-launcher.html',import.meta.url),'utf8');
const install=await readFile(new URL('../scripts/ally/install-launcher.ps1',import.meta.url),'utf8');
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
test('offline HTML launcher has valid self-contained JavaScript and essential UI',()=>{
 assert.ok(js);
 assert.doesNotThrow(()=>new Script(js));
 for(const id of ['tiles','settings','tileDialog','wallUpload','wallOptions','fullscreen','import','export','arrange','openQwen'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/<meta name="viewport"/);
 assert.doesNotMatch(html,/<script\s+src=/);
});
test('launcher contains customization, persistence and safe-link controls',()=>{
 for(const keyword of ['localStorage','safeURL','URL.createObjectURL','URL.revokeObjectURL','FileReader','aria-pressed','maxlength="450"','requestFullscreen','textContent','confirm('])assert.ok(js.includes(keyword)||html.includes(keyword),keyword);
 assert.match(js,/u\.protocol==='https:'/);
 assert.match(js,/u\.hostname==='127\.0\.0\.1'/);
 assert.match(js,/u\.username\|\|u\.password/);
 assert.doesNotMatch(js,/\b(?:eval|Function)\s*\(/);
 assert.doesNotMatch(js,/(?:innerHTML|outerHTML)\s*=/);
 assert.doesNotMatch(js,/fetch\s*\(/);
});
test('default tiles open known app locations and preserve Windows',()=>{
 for(const path of ['nexus.html','ad-maker.html','forge.html','ally.html'])assert.ok(js.includes(path),path);
 assert.ok(js.includes('127.0.0.1:9931'));
 assert.match(html,/Windows stays in control/);
 assert.match(html,/No Windows shell replacement/);
});
test('installer pins source and hash, creates app shortcut but never replaces shell or auto starts',()=>{
 assert.match(install,/ValidatePattern\('\^\[a-f0-9\]\{40\}\$'\)/);
 assert.match(install,/Get-FileHash/);
 assert.match(install,/SHA-256 mismatch/);
 assert.match(install,/raw\.githubusercontent\.com\/jrl6933380-hub\/nexus-labs/);
 assert.match(install,/CreateShortcut/);
 assert.match(install,/--app=/);
 assert.doesNotMatch(install,/Set-ItemProperty|Set-ExecutionPolicy|schtasks|CurrentVersion\\Run|Winlogon|explorer\.exe/);
 assert.match(install,/if\(\$Launch\)/);
});
