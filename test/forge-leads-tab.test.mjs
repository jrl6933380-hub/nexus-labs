import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../public/'+p,import.meta.url),'utf8');

test('Forge hub exposes a Leads tab that loads lazily, after the existing tabs',async()=>{
 const hub=await read('forge-hub.html');
 assert.match(hub,/id="leads-tab"[^>]*aria-controls="leads-panel"/);
 assert.match(hub,/'leads-tab': '\/forge-leads\.html'/);
 assert.ok(hub.indexOf('id="templates-tab"')<hub.indexOf('id="leads-tab"'),'existing tab order must not change');
 assert.ok(!/<iframe[^>]+id="leads-frame"[^>]+src=/.test(hub),'Leads panel must not load before owner access succeeds');
});

test('Leads page is owner-gated and never runs code or sends anything',async()=>{
 const page=await read('forge-leads.html');
 assert.match(page,/<div id="app" class="wrap" hidden>/);
 assert.match(page,/fetch\('\/api\/room-history'/);
 assert.match(page,/workbench\.operator/);
 assert.ok(!/innerHTML|eval\(|new Function\(|document\.write/.test(page));
 assert.ok(!/fetch\('\/api\/(?!room-history)/.test(page),'page only checks access; it submits nothing');
 assert.match(page,/never|Nothing is sent/i);
});
