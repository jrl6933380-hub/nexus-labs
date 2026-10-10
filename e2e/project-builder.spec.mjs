import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {fixture,samplePage} from '../test/project-builder-fixture.mjs';
test.use({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
async function setup(page,{workspace=false}={}){
 const f=fixture(),errors=[],modelCalls=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/_vercel/insights/script.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/room-history'){const res=await f.request(request.method()==='POST'?request.postDataJSON():null,{method:request.method(),query:Object.fromEntries(url.searchParams)});return route.fulfill({status:res.code,json:res.data});}
  if(['/api/room-chat','/api/forge-help','/api/room-assistant'].includes(url.pathname) && request.method()==='POST')modelCalls.push(url.pathname);
  let data={};if(url.pathname==='/api/room-auth')data={username:'alice'};
  if(url.pathname==='/api/forge-brain')data={connected:true,provider:'test',plan:'unlimited'};
  if(url.pathname==='/api/room-conversation')data={turns:[]};
  if(url.pathname==='/api/nexus-auth')data={authenticated:true,owner:{id:'alice'}};
  if(url.pathname==='/api/chat')data={messages:[],threads:[]};
  if(url.pathname==='/api/nexus-messages')data=url.searchParams.has('group_id')?{group:{id:'group-garden',kind:'group'},runs:[{id:'run-garden',message:'Build a garden site.',steps:[{name:'Mason',result:'The garden site is complete.\n```html\n'+samplePage+'\n```'}]}]}:{specialists:[],groups:[],roles:{},scopes:[],pinned_system_ids:[]};
  if(url.pathname==='/api/nexus-controls')data={preferences:{accent:'gold'}};
  await route.fulfill({json:data});
 });
 await page.goto(workspace?'/workspace.html?view=workbench':'/forge.html?surface=workbench&view=chat&build=b1');
 return {...f,errors,modelCalls};
}
test('mobile modes preserve the conversation draft, preview state and unsaved fine-tune; saves and restore use one slot',async({page})=>{
 const f=await setup(page);await expect(page.locator('.projectbuilder')).toBeVisible();expect(f.modelCalls).toEqual([]);
 await expect(page.getByText('Build a garden site.',{exact:true})).toBeVisible();await page.locator('#input').fill('Keep this unsent request');
 await page.getByRole('button',{name:'Preview',exact:true}).click();const preview=page.frameLocator('.pb-canvas iframe');await preview.getByRole('button',{name:'Test button',exact:true}).click();await expect(preview.getByRole('button',{name:'Clicked'})).toBeVisible();
 await page.getByRole('button',{name:'Build with Nex',exact:true}).click();expect(await page.locator('#input').inputValue()).toBe('Keep this unsent request');await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(preview.getByRole('button',{name:'Clicked'})).toBeVisible();
 await preview.locator('body').evaluate(()=>scrollTo(0,400));await page.waitForTimeout(150);await page.getByRole('button',{name:'Build with Nex',exact:true}).click();await page.getByRole('button',{name:'Preview',exact:true}).click();expect(await preview.locator('body').evaluate(()=>scrollY)).toBe(400);
 await preview.locator('body').evaluate(()=>scrollTo(0,0));await page.getByRole('button',{name:'Fine-tune',exact:true}).click();await preview.getByRole('heading',{name:'Creekside Lawn',exact:true}).click();await page.getByRole('textbox',{name:'Element text'}).fill('Garden team');
 await page.getByRole('button',{name:'Build with Nex',exact:true}).click();await page.getByRole('button',{name:'Fine-tune',exact:true}).click();expect(await page.getByRole('textbox',{name:'Element text'}).inputValue()).toBe('Garden team');
 await page.getByRole('button',{name:'Preview change',exact:true}).click();await expect(preview.getByRole('heading',{name:'Garden team',exact:true})).toBeVisible();expect(f.writes.length).toBe(0);
 await page.getByRole('button',{name:'Before / after',exact:true}).click();await expect(preview.getByRole('heading',{name:'Creekside Lawn',exact:true})).toBeVisible();
 f.setFailure(true);await page.getByRole('button',{name:'Save change',exact:true}).click();await expect(page.getByRole('status')).toContainText('That change could not be saved');expect(f.writes.length).toBe(0);f.setFailure(false);
 await page.getByRole('button',{name:'Save change',exact:true}).click();await expect(page.getByRole('status')).toContainText('Saved');expect(f.projects().length).toBe(1);expect(f.writes.length).toBe(1);expect(f.writes[0].html).toContain('Garden team');expect(f.writes[0].html).not.toContain('nexusBuilder');
 await page.getByRole('button',{name:'Build with Nex',exact:true}).click();await page.locator('.pb-project-shelf summary').click();await page.getByRole('button',{name:'Versions',exact:true}).click();await page.getByRole('button',{name:'Restore',exact:true}).click();await expect(page.getByRole('status')).toContainText('Version restored');expect(f.writes[1].html).toBe(samplePage);expect(f.projects().length).toBe(1);
 await page.getByRole('button',{name:'Preview',exact:true}).click();await page.screenshot({path:'test-results/project-builder-mobile.png'});
 await page.getByRole('button',{name:'Build with Nex',exact:true}).click();await expect(page.locator('.pb-canvas')).toBeVisible();await expect(page.frameLocator('.pb-canvas iframe').locator('h1')).toHaveText('Creekside Lawn');await page.screenshot({path:'test-results/project-builder-chat-mobile.png'});
 expect(f.errors).toEqual([]);expect(f.modelCalls).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const a11y=await new AxeBuilder({page}).include('.projectbuilder').withTags(['wcag2a','wcag2aa']).analyze();expect(a11y.violations.filter(v=>['critical','serious'].includes(v.impact))).toEqual([]);
 await page.locator('.projectbuilder').getByRole('button',{name:'Back to project',exact:true}).click();await expect(page.locator('.projectbuilder')).toHaveAttribute('data-mode','overview');await page.getByRole('button',{name:'Back to Projects',exact:true}).click();await expect(page.locator('.projectshelf')).toBeVisible();await expect(page.locator('.projectfilters')).toContainText('1 of 10 project slots');await expect(page.locator('.teammission')).toHaveCount(0);
 await page.locator('.projectcard').getByRole('button',{name:'Open Creekside Lawn',exact:true}).click();await expect(page.locator('.projectbuilder')).toHaveAttribute('data-mode','overview');await expect(page.locator('.pb-canvas')).toBeVisible();await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(preview.getByRole('heading',{name:'Creekside Lawn',exact:true})).toBeVisible();
});
test('back navigation restores the project conversation and can leave Projects',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Fine-tune',exact:true}).click();
 await page.locator('.projectbuilder').getByRole('button',{name:'Back to Build with Nex',exact:true}).click();
 await expect(page.locator('.pb-chat')).toBeVisible();
 await page.locator('.projectbuilder').getByRole('button',{name:'Back to project',exact:true}).click();
 await expect(page.locator('.projectbuilder')).toHaveAttribute('data-mode','overview');
 await page.locator('.projectbuilder').getByRole('button',{name:'Back to Projects',exact:true}).click();
 await expect(page.locator('.projectshelf')).toBeVisible();
 await page.locator('.projectcard').getByRole('button',{name:'Open Creekside Lawn',exact:true}).click();
 await expect(page.locator('.projectbuilder')).toHaveAttribute('data-mode','overview');
 await page.getByRole('button',{name:'Build with Nex',exact:true}).click();
 await expect(page.locator('.pb-chat .projectshelf')).toHaveCount(0);
 await expect(page.getByText('Build a garden site.',{exact:true})).toBeVisible();
 await page.locator('.projectbuilder').getByRole('button',{name:'Back to project',exact:true}).click();
 await page.locator('.projectbuilder').getByRole('button',{name:'Back to Projects',exact:true}).click();
 await Promise.all([
   page.waitForURL('**/workspace.html?view=workbench'),
   page.getByRole('button',{name:'Back to Nexus',exact:true}).click(),
 ]);
});
test('Fine-tune returns to its entry screen and collapsed chat stays on the middle tab',async({page})=>{
 const f=await setup(page);
 const builder=page.locator('.projectbuilder');
 await page.locator('#input').fill('Keep this draft while fine-tuning');
 for(let attempt=0;attempt<2;attempt++){
  await page.getByRole('button',{name:'Fine-tune',exact:true}).click();
  await builder.getByRole('button',{name:'Back to Build with Nex',exact:true}).click();
  await expect(builder).toHaveAttribute('data-mode','build');
  await expect(page.locator('.pb-chat')).toBeVisible();
  await expect(page.locator('#input')).toHaveValue('Keep this draft while fine-tuning');
  await expect(page.getByText('Build a garden site.',{exact:true})).toBeVisible();
 }
 await builder.getByRole('button',{name:'Back to project',exact:true}).click();
 await expect(page.getByRole('button',{name:'Build with Nex',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Fine-tune',exact:true}).click();
 await builder.getByRole('button',{name:'Back to project',exact:true}).click();
 await expect(builder).toHaveAttribute('data-mode','overview');
 await page.getByRole('button',{name:'Build with Nex',exact:true}).click();
 await expect(builder).toHaveAttribute('data-mode','build');
 expect(f.errors).toEqual([]);expect(f.modelCalls).toEqual([]);
});
test('full site stays in place as chat opens, typing lifts it, and chat closes',async({page})=>{
 const f=await setup(page);
 await page.getByRole('button',{name:'Hide chat ↓',exact:true}).click();
 const canvas=page.locator('.pb-canvas iframe');
 const preview=page.frameLocator('.pb-canvas iframe');
 await preview.getByRole('button',{name:'Test button',exact:true}).click();
 await preview.locator('body').evaluate(()=>scrollTo(0,300));
 await expect.poll(()=>preview.locator('body').evaluate(()=>scrollY)).toBe(300);
 const before=await canvas.boundingBox();
 expect(before.width).toBe(393);expect(before.height).toBeGreaterThan(350); // The restored card shelf shares the screen with the site.
 await page.getByRole('button',{name:'Chat with Nex ↑',exact:true}).click();
 await expect(page.locator('.projectbuilder')).toHaveAttribute('data-mode','build');
 expect(await canvas.boundingBox()).toEqual(before);
 expect(await preview.locator('body').evaluate(()=>scrollY)).toBe(300);
 await page.getByRole('button',{name:'Hide chat ↓',exact:true}).click();
 await page.locator('#input').fill('Keep the site behind my chat');
 await expect(page.locator('.projectbuilder')).toHaveAttribute('data-mode','build');
 expect(await canvas.boundingBox()).toEqual(before);
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:500});visualViewport.dispatchEvent(new Event('resize'));});
 expect(await canvas.boundingBox()).toEqual(before);
 const input=await page.locator('#input').boundingBox();expect(input.y+input.height).toBeLessThanOrEqual(500);
 await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
 await page.getByRole('button',{name:'Hide chat ↓',exact:true}).click();
 expect(await preview.locator('body').evaluate(()=>scrollY)).toBe(300);
 await expect(preview.getByRole('button',{name:'Clicked',exact:true})).toHaveCount(1);
 expect(f.errors).toEqual([]);expect(f.modelCalls).toEqual([]);
});
test('photo gallery edits prepare an embedded photo and survive reopening the project',async({page})=>{
 const f=await setup(page);await page.getByRole('button',{name:'Fine-tune',exact:true}).click();const preview=page.frameLocator('.pb-canvas iframe');await preview.getByRole('img',{name:'Garden',exact:true}).click();
 await page.getByLabel('Choose image from Photos').setInputFiles({name:'gallery.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});await expect(page.getByRole('status')).toContainText('Photo ready');await page.getByRole('button',{name:'Save change',exact:true}).click();await expect(page.getByRole('status')).toContainText('Saved');expect(f.writes[0].html).toContain('data:image/webp;base64,');expect(f.writes[0].html.length).toBeLessThan(100000);
 await page.goto('/forge.html?surface=workbench&view=preview&build='+f.writes[0].id);await expect(page.frameLocator('.pb-canvas iframe').getByRole('img',{name:'Garden'})).toHaveAttribute('src',/^data:image\/webp;base64,/);expect(f.errors).toEqual([]);
});
test('Projects shelf uses two columns on phone, owns filters and stays separate from chat activity',async({page})=>{
 const f=await setup(page,{workspace:true});await expect(page.locator('.projectshelf')).toBeVisible();await expect(page.locator('.teammission')).toHaveCount(0);await expect(page.locator('.foot')).toBeHidden();await expect(page.locator('.projectcardtitle')).toHaveText('Creekside Lawn');
 await expect(page.locator('.projectcardactions')).toHaveCount(0);await expect(page.getByRole('button',{name:'More ways to build'})).toBeVisible();const columns=await page.locator('.projectgrid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);expect(columns).toBe(2);await page.getByRole('button',{name:'Live',exact:true}).click();await expect(page.locator('.projectcard')).toBeHidden();await page.getByRole('button',{name:'Drafts',exact:true}).click();await expect(page.locator('.projectcard')).toBeVisible();await page.getByRole('button',{name:'Open Creekside Lawn',exact:true}).click();await expect(page.locator('.projectbuilder')).toHaveAttribute('data-mode','overview');await expect(page.locator('.pb-canvas')).toBeVisible();await expect(page.getByRole('button',{name:'Chat with Nex ↑',exact:true})).toBeVisible();await page.screenshot({path:'test-results/project-home-mobile.png'});expect(f.errors).toEqual([]);
});
test('desktop and short screens keep preview controls inside the usable canvas',async({page})=>{
 const f=await setup(page);for(const viewport of [{width:1440,height:900},{width:393,height:600}]){await page.setViewportSize(viewport);await page.getByRole('button',{name:'Preview',exact:true}).click();const top=await page.locator('.pb-top').boundingBox(),frame=await page.locator('.pb-canvas iframe').boundingBox(),dock=await page.locator('.pb-dock').boundingBox();expect(frame.y).toBeGreaterThanOrEqual(top.y+top.height);expect(frame.y+frame.height).toBeLessThanOrEqual(dock.y+1);await page.frameLocator('.pb-canvas iframe').getByRole('button',{name:/Test button|Clicked/}).click();await expect(page.locator('.pb-project-shelf')).toBeHidden();}expect(f.errors).toEqual([]);
});

test('automatic draft saving reports a failed save, retries, and deduplicates repeated rendering',async({page})=>{
 const f=await setup(page,{workspace:true});f.setFailure(true);
 const render=()=>page.evaluate(async html=>{const {appendChatVisual}=await import('/chat-visual.js');const host=document.createElement('div');host.className='test-result';host.style='position:fixed;inset:120px 12px 140px;z-index:500;background:#152219;overflow:auto';document.body.append(host);appendChatVisual(host,'```html\n'+html+'\n```','Mason',{saveKey:'browser-build',onPromote:async payload=>{const response=await fetch('/api/room-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save_chat_visual',promotionId:'browser-build',html:payload.html})});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}});},samplePage);
 await render();await expect(page.locator('.test-result').getByRole('button',{name:'Retry saving',exact:true})).toBeVisible();expect(f.writes.length).toBe(0);f.setFailure(false);await page.locator('.test-result').getByRole('button',{name:'Retry saving',exact:true}).click();await expect(page.locator('.test-result').getByRole('button',{name:'Open project',exact:true})).toBeVisible();await render();await expect(page.locator('.test-result').getByRole('button',{name:'Open project',exact:true})).toHaveCount(2);expect(f.writes.length).toBe(1);await page.reload();await render();await expect(page.locator('.test-result').getByRole('button',{name:'Open project',exact:true})).toBeVisible();expect(f.writes.length).toBe(1);expect(f.errors).toEqual([]);
});

test('a completed Nex edit that could not save stays marked unsaved and can retry without another model call',async({page})=>{
 const f=await setup(page);let modelCalls=0;
 await page.route('**/api/room-assistant',route=>route.fulfill({json:{kind:'build',instruction:'Make the heading clearer.'}}));
 await page.route('**/api/room-chat',route=>{modelCalls++;return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({action:'html',html:samplePage.replace('We care for your garden.','Your garden, cared for.')})+'\n\ndata: '+JSON.stringify({action:'save_error',message:'Storage is temporarily unavailable.'})+'\n\n'});});
 await page.locator('#input').fill('Make this copy clearer');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('status')).toContainText('Unsaved');await expect(page.getByRole('button',{name:'Publish',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(page.getByRole('button',{name:'Retry saving',exact:true})).toBeVisible();await page.getByRole('button',{name:'Retry saving',exact:true}).click();await expect(page.getByRole('status')).toContainText('Saved draft');expect(modelCalls).toBe(1);expect(f.writes.length).toBe(1);expect(f.projects().length).toBe(1);expect(f.writes[0].html).toContain('Your garden, cared for.');expect(f.errors).toEqual([]);
});

test('project cards restore the visual overview without resetting the site',async({page})=>{
 const f=await setup(page);
 const controls=page.locator('.pb-tools');
 await expect(controls).toBeHidden();
 await page.locator('.pb-project-shelf summary').click();
 for(const name of ['Home page','Add a piece','Team activity','All pieces','Versions','Project options'])await expect(controls.getByRole('button',{name,exact:true})).toBeVisible();
 await expect(controls.locator('.pb-home-card iframe')).toHaveAttribute('srcdoc',samplePage);
 await expect(controls).toContainText('Main landing page');
 await expect(controls).toContainText('Restore a previous version');
 expect((await controls.boundingBox()).height).toBeLessThanOrEqual(852*.34+1);
 await page.screenshot({path:'test-results/project-cards-mobile.png'});
 await controls.getByRole('button',{name:'Home page',exact:true}).click();
 const preview=page.frameLocator('.pb-canvas iframe');await preview.getByRole('button',{name:'Test button',exact:true}).click();
 await page.getByRole('button',{name:'Build with Nex',exact:true}).click();
 await controls.getByRole('button',{name:'Team activity',exact:true}).click();
 await expect(page.locator('.pb-sheet')).toContainText('Mason: The garden site is complete.');
 await page.locator('.pb-sheet').getByRole('button',{name:'Close',exact:true}).click();
 await controls.getByRole('button',{name:'All pieces',exact:true}).click();
 await expect(page.locator('.pb-sheet').getByRole('heading',{name:'Project pieces'})).toBeVisible();
 await page.locator('.pb-sheet').getByRole('button',{name:'Close',exact:true}).click();
 await controls.getByRole('button',{name:'Home page',exact:true}).click();
 await expect(preview.getByRole('button',{name:'Clicked',exact:true})).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('project shelf collapses and only appears on the middle tab',async({page})=>{
 const f=await setup(page),shelf=page.locator('.pb-project-shelf'),cards=page.locator('.pb-tools');
 await expect(shelf).toBeVisible();await expect(cards).toBeHidden();
 const collapsed=await page.locator('.pb-canvas').boundingBox();
 await shelf.locator('summary').click();await expect(cards).toBeVisible();
 await expect.poll(async()=>(await page.locator('.pb-canvas').boundingBox()).height).toBeLessThan(collapsed.height);
 for(const mode of ['Preview','Fine-tune']){
  await page.getByRole('button',{name:mode,exact:true}).click();await expect(shelf).toBeHidden();
  expect((await page.locator('.pb-dock').boundingBox()).height).toBeLessThan(90);
 }
 await page.getByRole('button',{name:'Build with Nex',exact:true}).click();await expect(cards).toBeVisible();
 await shelf.locator('summary').click();await expect(cards).toBeHidden();
 await expect.poll(async()=>(await page.locator('.pb-canvas').boundingBox()).height).toBe(collapsed.height);
 await shelf.locator('summary').click();await page.getByRole('button',{name:'Continue with Nex',exact:true}).click();
 await expect(cards).toBeHidden();await expect(page.locator('#input')).toBeFocused();expect(f.errors).toEqual([]);
});
