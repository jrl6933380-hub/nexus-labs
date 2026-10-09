import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

// Keep the full workspace CSS cascade: the team chat preview styles used to
// override the home roster and stretch every card in the horizontal row.
const shell=readFileSync(new URL('../public/workspace.html',import.meta.url),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
for(const width of [320,393,780])test(`live home cards stay compact with team chat CSS at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:852});
  await page.route('**/workspace.html',route=>route.fulfill({contentType:'text/html',body:shell}));
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    const data=path==='/api/nexus-messages'?{
      specialists:[{id:'atlas',name:'Atlas',role:'research'},{id:'mason',name:'Mason',role:'build'}],
      groups:[{id:'team',title:'My team',member_ids:['atlas','mason'],include_nex:true}],roles:{},scopes:[],pinned_system_ids:[],
    }:path==='/api/room-history'?{projects:[{projectId:'garden',label:'Garden site',versionCount:2}],usage:{count:1,limit:10}}:{items:[],pulses:[]};
    return route.fulfill({json:data});
  });
  await page.goto('/workspace.html');
  await page.evaluate(async()=>{
    document.documentElement.classList.remove('workspace-loading');
    document.body.dataset.view='messages';
    const {renderMessages}=await import('/nexus-messages.js');
    document.querySelector('.thread').replaceChildren(await renderMessages({recentThreads:()=>[],go(){},openConversation(){}}));
  });
  const cards=page.locator('.homelivecard');
  await expect(cards).toHaveCount(4);
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
