import {test,expect} from '@playwright/test';
import {createNexusLabBoards} from '../lib/nexusLabBoards.js';
import {labJobMemory} from '../test-support/labJobMemory.mjs';
for(const width of [360,1280])test('posting flow stays on the board with durable notes and batch at '+width+'px',async({page})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width,height:900});
 const owner={id:'posting-owner'},boards=createNexusLabBoards({command:labJobMemory()});
 const first=await boards.save(owner,{board:{name:'Ad Maker workspace',view:{x:20,y:90,z:1},items:[{id:'brief-one',kind:'note',title:'Actor ad',text:'Make a sample competitor ad. <script>window.pwned=true</script>',x:0,y:0,w:200,h:150,z:1}]}});
 await page.route('**/api/nexus-lab',async route=>{
  const {action,input}=route.request().postDataJSON();let data;
  if(action==='board_list')data=await boards.list(owner);
  else if(action==='board_read')data={board:await boards.read(owner,input.id)};
  else if(action==='board_save')data={board:await boards.save(owner,input)};
  else if(action==='asset_list')data={media:[]};
  else throw Error('Unexpected lab action '+action);
  await route.fulfill({json:data});
 });
 const campaign={id:'sf-batch-reuse',name:'Actor launches'},videos=[];let serial=0;
 await page.route('**/api/tiktok-plans',async route=>{const {action,input}=route.request().postDataJSON();let data;
  if(action==='overview')data={campaigns:[campaign],videos};
  else if(action==='save_video'){data={caption:'',hashtags:'',sound:'',post_url:'',...input.video,id:input.id,baseline:'rev'+(++serial),kind:'v'};const i=videos.findIndex(v=>v.id===input.id);if(i<0)videos.push(data);else videos[i]=data;}
  else throw Error('Unexpected action '+action);await route.fulfill({json:{ok:true,data}});
 });
 await page.route('**/api/ad-campaigns',route=>route.fulfill({json:{ok:true,data:route.request().postDataJSON().action==='list'?{campaigns:[{campaign_id:'ad-one',name:'Competitor sample'}]}:{renders:{}}}}));
 await page.goto('/board.html?id='+first.id);
 await page.getByRole('button',{name:'Add',exact:true}).click();await page.getByRole('button',{name:/^Social Post Flow/}).click();
 await page.getByRole('button',{name:'Saved posting batches',exact:true}).click();
 const panel=page.getByRole('region',{name:'Social posting workspace'});await expect(panel).toBeVisible();
 const flow=page.frameLocator('iframe[title="Social Post Flow workspace"]');
 await flow.getByText('Sticky notes on this board',{exact:true}).click();
 await expect(flow.getByText('Make a sample competitor ad.',{exact:false})).toBeVisible();
 expect(await flow.locator('body').evaluate(()=>window.pwned)).toBeUndefined();
 expect(await page.evaluate(()=>window.pwned)).toBeUndefined();
 await flow.getByLabel('Posting batch').selectOption(campaign.id);
 await expect.poll(async()=>{const b=await boards.read(owner,first.id);return b.items.find(i=>i.kind==='tool')?.batch_id;}).toBe(campaign.id);
 await flow.getByRole('button',{name:'+ Saved ads / videos',exact:true}).click();
 await flow.getByRole('button',{name:'Ad · Competitor sample · needs a rendered video'}).click();await flow.getByRole('button',{name:'Done',exact:true}).click();
 await flow.getByLabel('Description',{exact:true}).fill('A concept preview of competitor research.');await flow.getByRole('button',{name:'Save branch'}).click();
 await expect(flow.locator('#summary')).toHaveText('1 videos · 0 / 1 posts complete');
 await panel.getByRole('button',{name:'+ Sticky note'}).click();await page.getByLabel('Note text').fill('Next: make an ad for Review Intelligence.');await page.getByRole('button',{name:'Add note',exact:true}).click();
 await expect(flow.getByText('Next: make an ad for Review Intelligence.',{exact:true})).toBeVisible();
 expect(page.url()).toContain('/board.html?id='+first.id);
 await panel.getByRole('button',{name:'Back to board',exact:true}).click();await expect(panel).toBeHidden();
 const saved=await boards.read(owner,first.id);expect(saved.items.filter(i=>i.kind==='note')).toHaveLength(2);expect(saved.items.find(i=>i.id==='brief-one').text).toContain('Make a sample competitor ad.');
 // A same-origin message from any source other than the trusted tool iframe is ignored.
 await page.evaluate(({board,item})=>window.postMessage({type:'nexus-social:batch',board,item,batch:'sf-batch-evil'},location.origin),{board:first.id,item:saved.items.find(i=>i.kind==='tool').id});
 expect((await boards.read(owner,first.id)).items.find(i=>i.kind==='tool').batch_id).toBe(campaign.id);
 await page.reload();await page.locator('.flow-heading').click();await page.getByRole('button',{name:'Saved posting batches',exact:true}).click();
 await expect(flow.getByLabel('Posting batch')).toHaveValue(campaign.id);
 await expect(flow.getByLabel('Description',{exact:true})).toHaveValue('A concept preview of competitor research.');
 await flow.getByText('Sticky notes on this board',{exact:true}).click();
 await expect(flow.getByText('Next: make an ad for Review Intelligence.',{exact:true})).toBeVisible();
 expect(await page.locator('.k-tool iframe').count()).toBe(0); // tool URL is not caller-provided canvas HTML
 await expect(page.locator('#viewport')).toBeVisible();expect(page.url()).toContain('/board.html?id='+first.id);
});
