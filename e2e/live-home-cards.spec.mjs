import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

// Keep the full workspace CSS cascade: the team chat preview styles used to
// override the home roster and stretch every card in the horizontal row.
const shell=readFileSync(new URL('../public/workspace.html',import.meta.url),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
for(const width of [320,393,780])test(`live home cards stay compact with team chat CSS at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:852});
  await page.route('**/workspace.html',route=>route.fulfill({contentType:'text/html',body:shell}));
  await page.route('**/api/**',route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path==='/api/room-history' && url.searchParams.has('id'))return route.fulfill({json:{build:{html:url.searchParams.get('id')==='garden-v2'?'<!doctype html><html><body style="margin:0;background:#d7edcb"><h1>Old garden</h1><script>document.querySelector("h1").textContent="Garden saved version two"</script></body></html>':'<!doctype html><html><body style="margin:0;background:#dbcbea"><h1>Studio saved page</h1></body></html>'}}});
    const data=path==='/api/nexus-messages'?{
      specialists:[{id:'atlas',name:'Atlas',role:'research'},{id:'mason',name:'Mason',role:'build'}],
      groups:[{id:'team',title:'My team',member_ids:['atlas','mason'],include_nex:true}],roles:{},scopes:[],pinned_system_ids:[],
    }:path==='/api/room-history'?{projects:[{projectId:'garden',latestBuildId:'garden-v2',label:'Garden site',versionCount:2},{projectId:'studio',latestBuildId:'studio-v1',label:'Studio site',versionCount:1}],usage:{count:1,limit:10}}:{items:[],pulses:[]};
    return route.fulfill({json:data});
  });
  await page.goto('/workspace.html');
  await page.evaluate(async()=>{
    document.documentElement.classList.remove('workspace-loading');
    document.body.dataset.view='messages';
    const {renderMessages}=await import('/nexus-messages.js');
    document.querySelector('.thread').replaceChildren(await renderMessages({recentThreads:()=>[],go(){},openConversation(){},openWorkbenchPanel(id,mode){window.openedProject={id,mode};}}));
  });
  const cards=page.locator('.homelivecard');
  await expect(cards).toHaveCount(5);
  await expect(page.locator('.homeprojectcard iframe')).toHaveCount(2);
  await expect(page.frameLocator('.homeprojectcard iframe').nth(0).locator('h1')).toHaveText('Garden saved version two');
  await expect(page.frameLocator('.homeprojectcard iframe').nth(1).locator('h1')).toHaveText('Studio saved page');
  for(const frame of await page.locator('.homeprojectcard iframe').all()){
    await expect(frame).toHaveAttribute('sandbox','allow-scripts');
    await expect(frame).toHaveCSS('pointer-events','none');
  }
  expect(await page.locator('.projectvisual').first().evaluate(el=>getComputedStyle(el,'::before').content)).toBe('none');
  const preview=page.locator('.projectvisual').first(),previewBox=await preview.boundingBox(),frameBox=await preview.locator('iframe').boundingBox();
  expect(frameBox.width).toBeCloseTo(previewBox.width-2,0);
  expect(frameBox.height).toBeCloseTo(previewBox.height-2,0);
  await page.locator('.homeprojectcard').first().click();
  expect(await page.evaluate(()=>window.openedProject)).toEqual({id:'garden-v2',mode:'overview'});
  for(const card of await cards.all()){
    const box=await card.boundingBox();
    expect(box.height).toBe(278);
    expect(box.width).toBeLessThan(width);
  }
  const roster=page.locator('.hometeamvisual');
  await expect(roster).toHaveCSS('height','104px');
  await expect(roster).toHaveCSS('display','flex');
  await expect(roster).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  const positions=await roster.locator('.messageavatar').evaluateAll(els=>els.map(el=>({x:el.offsetLeft,y:el.offsetTop})));
  expect(new Set(positions.map(p=>p.y)).size).toBe(1);
  expect(positions[1].x).toBeGreaterThan(positions[0].x);
  await page.locator('.homecards').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await expect.poll(()=>page.locator('.homecards').evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
});
