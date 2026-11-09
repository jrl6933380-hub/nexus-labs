import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('Forge hub exposes a Leads tab that loads lazily, after the existing tabs',async()=>{
 const hub=await read('public/forge-hub.html');
 assert.match(hub,/id="leads-tab"[^>]*aria-controls="leads-panel"/);
 assert.match(hub,/'leads-tab': '\/forge-leads\.html'/);
 assert.ok(hub.indexOf('id="templates-tab"')<hub.indexOf('id="leads-tab"'),'existing tab order must not change');
 assert.ok(!/<iframe[^>]+id="leads-frame"[^>]+src=/.test(hub),'Leads panel must not load before owner access succeeds');
});

test('Leads page is owner-gated, talks only to its own queue, and never runs code from results',async()=>{
 const page=await read('public/forge-leads.html');
 assert.match(page,/<div id="app" class="wrap" hidden>/);
 assert.match(page,/fetch\('\/api\/room-history'/);
 assert.match(page,/workbench\.operator/);
 assert.ok(!/innerHTML|eval\(|new Function\(|document\.write/.test(page));
 const urls=[...page.matchAll(/fetch\(([^,)]+)/g)].map(m=>m[1].trim());
 assert.deepEqual(urls.sort(),["'/api/room-history'",'API','API'].sort());
 assert.match(page,/const API|var API = '\/api\/forge-lead-jobs'/);
 assert.match(page,/setAttribute\('sandbox', ''\)/,'site previews must render in a fully sandboxed frame');
 assert.match(page,/Nothing is sent, called or posted/);
});

test('Ally watcher is wired into the console and pinned by the installer',async()=>{
 const consoleCode=await read('scripts/ally/qwen-console.mjs');
 assert.match(consoleCode,/import \{startForgeLeadWatcher\} from '\.\/forge-lead-watcher\.mjs'/);
 assert.match(consoleCode,/startForgeLeadWatcher\(\{root:ROOT\}\)/);
 assert.match(consoleCode,/leads\.stop\(\)/);
 const installer=await read('scripts/ally/install-qwen-console.ps1');
 assert.match(installer,/\[string\]\$LeadWatcherSha256/);
 assert.match(installer,/\[string\]\$LeadTransportSha256/);
 assert.match(installer,/path='scripts\/ally\/forge-lead-watcher\.mjs';hash=\$LeadWatcherSha256/);
 assert.match(installer,/path='scripts\/ally\/forge-lead-transport\.ps1';hash=\$LeadTransportSha256/);
 const transport=await read('scripts/ally/forge-lead-transport.ps1');
 assert.match(transport,/nexus-labs-sigma\.vercel\.app\/api\/forge-lead-jobs/);
 assert.match(transport,/device-token\.xml/);
 assert.doesNotMatch(transport,/tiktok|instagram|facebook/i);
});
