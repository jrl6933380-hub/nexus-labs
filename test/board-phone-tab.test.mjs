import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
test('the phone app Board tab opens the Nexus Board page, and that page and its scripts exist',async()=>{
  const tools=await read('android/phone/app/src/main/java/app/nexus/phone/DeviceTools.java'),activity=await read('android/phone/app/src/main/java/app/nexus/phone/MainActivity.java');
  assert.match(tools,/case "boards":return "\/board\.html";/);assert.match(tools,/case "board":return "\/agent-board\.html";/);
  assert.match(activity,/tab\("Board",MUTED,\(\)->openNexus\("boards"\)\)/);
  for(const f of ['board.html','board.css','board.js','board-core.js','board-cut.js'])await access(new URL(`../public/${f}`,import.meta.url));
  const html=await read('public/board.html');for(const needle of ['/board.css','/board.js','id="viewport"','id="dock"'])assert.ok(html.includes(needle),needle);
});
test('the Board page never renders user text as markup and keeps visuals in a sealed frame',async()=>{
  const js=await read('public/board.js'),core=await read('public/board-core.js');
  assert.ok(!/\.innerHTML\s*=/.test(js)&&!/insertAdjacentHTML/.test(js),'no innerHTML in the Board');
  assert.match(js,/sandbox:'allow-scripts'/);assert.ok(!/allow-same-origin/.test(js+core),'visual frames must not share the page origin');
  assert.match(core,/connect-src 'none'/);
});
