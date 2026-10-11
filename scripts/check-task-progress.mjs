import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
const server=await createServer({root:'public',server:{host:'127.0.0.1',port:4175}});
await server.listen();
let browser;
try {
  browser=await chromium.launch({...(process.env.NEXUS_TEST_BROWSER_PATH?{executablePath:process.env.NEXUS_TEST_BROWSER_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto('http://127.0.0.1:4175/task-progress.css');
  await page.evaluate(async()=>{
    document.body.innerHTML='<link rel="stylesheet" href="/task-progress.css"><article id="answer"><p id="final">Your finished answer.</p></article>';
    const {createTaskProgress}=await import('/task-progress.js');
    window.task=createTaskProgress([],{running:true});
    document.querySelector('#answer').prepend(task.element);
    task.add({text:'Checking the result.',thinking:'never visible'});
    task.add({text:'Checking the result.'});
    task.add('<img src=x onerror=alert(1)>');
  });
  assert.equal(await page.locator('details').getAttribute('open'),'');
  assert.equal(await page.locator('li').count(),2);
  assert.equal(await page.locator('details img').count(),0);
  assert.equal(await page.locator('body').innerText().then(text=>text.includes('never visible')),false);
  await page.evaluate(()=>task.finish());
  assert.equal(await page.locator('details').getAttribute('open'),null);
  const toggle=page.locator('summary');
  assert.match(await toggle.innerText(),/Show progress/);
  const toggleBox=await toggle.boundingBox(),finalBox=await page.locator('#final').boundingBox();
  assert.ok(toggleBox.y<finalBox.y);
  await toggle.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('details').open);
  await page.waitForFunction(()=>document.querySelector('summary').textContent.startsWith('Hide progress'));
  assert.match(await toggle.innerText(),/Hide progress/);
  await toggle.click();await page.waitForFunction(()=>!document.querySelector('details').open);
  console.log('Mobile progress: above answer, collapsed on completion, expandable by keyboard/touch, deduplicated and safe text.');
} finally {await browser?.close();await server.close();}
