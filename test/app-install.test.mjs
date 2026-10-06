import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { isIosDevice, isStandalone, nexusInstallState, registerNexusApp } = await import('../public/app-install.js');
const { default: appIcon } = await import('../api/app-icon.js');
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('iPhone and touch iPad devices receive Apple install guidance', () => {
  assert.equal(isIosDevice({ userAgent:'Mozilla/5.0 (iPhone)', platform:'iPhone', maxTouchPoints:5 }), true);
  assert.equal(isIosDevice({ userAgent:'Mozilla/5.0', platform:'MacIntel', maxTouchPoints:5 }), true);
  assert.equal(nexusInstallState({ windowObject:{ matchMedia:()=>({ matches:false }) }, navigatorObject:{ userAgent:'iPhone', platform:'iPhone' } }), 'ios');
});

test('an installed Home Screen app is recognized before offering installation', () => {
  assert.equal(isStandalone({ matchMedia:()=>({ matches:true }) }, {}), true);
  assert.equal(isStandalone({ matchMedia:()=>({ matches:false }) }, { standalone:true }), true);
  assert.equal(nexusInstallState({ windowObject:{ matchMedia:()=>({ matches:true }) }, navigatorObject:{} }), 'installed');
});

test('service worker registration is optional and never blocks Nexus', async () => {
  assert.equal(await registerNexusApp({}), null);
  const calls=[];
  const registration={ scope:'/' };
  assert.equal(await registerNexusApp({ serviceWorker:{ register:async(...args)=>{calls.push(args);return registration;} } }),registration);
  assert.deepEqual(calls,[['/service-worker.js',{scope:'/'}]]);
});

test('iPhone receives a cacheable PNG Home Screen icon', () => {
  const headers={};let statusCode=null;let body=null;
  appIcon({}, {
    setHeader:(name,value)=>{headers[name]=value;},
    status:(value)=>{statusCode=value;return {send:(value)=>{body=value;}};},
  });
  assert.equal(statusCode,200);
  assert.equal(headers['Content-Type'],'image/png');
  assert.match(headers['Cache-Control'],/immutable/u);
  assert.equal(Buffer.isBuffer(body),true);
  assert.equal(body.subarray(1,4).toString(),'PNG');
});

test('the app shell stays installable without caching private API or page data', () => {
  const workspace=read('../public/workspace.html');
  const manifest=JSON.parse(read('../public/manifest.webmanifest'));
  const worker=read('../public/service-worker.js');
  const messages=read('../public/nexus-messages.js');
  assert.match(workspace,/rel="manifest" href="\/manifest\.webmanifest"/u);
  assert.match(workspace,/registerNexusApp\(\)/u);
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/workspace.html');
  assert.equal(manifest.icons.length,1);
  assert.equal(manifest.icons[0].sizes,'any');
  assert.equal(manifest.icons[0].type,'image/svg+xml');
  assert.match(workspace,/rel="apple-touch-icon" href="\/api\/app-icon"/u);
  assert.match(worker,/url\.pathname\.startsWith\('\/api\/'\)/u);
  assert.match(worker,/request\.mode === 'navigate'/u);
  assert.doesNotMatch(worker,/cache\.put\(request, copy\)[\s\S]*request\.mode === 'navigate'/u);
  assert.match(messages,/Install Nexus/u);
  assert.match(messages,/Add to Home Screen/u);
});
