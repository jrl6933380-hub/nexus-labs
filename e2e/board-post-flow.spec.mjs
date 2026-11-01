import {test,expect} from '@playwright/test';
import {createNexusLabBoards} from '../lib/nexusLabBoards.js';
import {labJobMemory} from '../test-support/labJobMemory.mjs';
for(const width of [393,1280])test('canvas video queue grows, edits, removes and reopens at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});
 const boards=createNexusLabBoards({command:labJobMemory()}),owner={id:'queue-owner'};
 const first=await boards.save(owner,{board:{name:'Ad Maker',view:{x:20,y:90,z:1},items:[
 {id:'flow',kind:'tool',tool_id:'social-post-flow',title:'Queue',x:0,y:0,w:716,h:328,z:1},
 {id:'video1',kind:'video',title:'First ad',media_id:'med-video01',x:0,y:360,w:160,h:120,z:2},
 {id:'video2',kind:'video',title:'Second ad',media_id:'med-video02',x:200,y:360,w:160,h:120,z:3},
 {id:'brief',kind:'note',text:'Keep this note.',x:800,y:0,w:200,h:150,z:4}
 ]}});
 await page.route('**/api/nexus-lab',async route=>{
 const {action,input}=route.request().postDataJSON();let data;
 if(action==='board_read')data={board:await boards.read(owner,input.id)};
 else if(action==='board_save')data={board:await boards.save(owner,input)};
 else if(action==='asset_read')data={asset:{status:'ready',chunks:1,mime:'video/mp4'}};
 else if(action==='asset_download')data={media_id:input.media_id,index:input.index,data_base64:'AAAA'};
 else if(action==='board_list')data=await boards.list(owner);
 else throw Error(action);
 await route.fulfill({json:data});
 });
 await page.goto('/board.html?id='+first.id);
 await expect(page.locator('.flow-row')).toHaveCount(1);
 await expect(page.locator('.social-panel')).toHaveCount(0);
 // Real pointer gesture, including zoom-aware world hit testing on narrow phones.
 await page.evaluate(()=>{window.nexusBoard.updateItem('video1',{x:0,y:360});});
 await page.mouse.move(70,500);await page.mouse.down();await page.mouse.move(90,210,{steps:12});await page.mouse.up();
 await expect(page.locator('.flow-row video')).toHaveCount(1);
 await expect(page.locator('[data-flow-slot="1"]')).toBeVisible();
 await page.getByLabel('Caption for video 1',{exact:true}).fill('First caption <script>not code</script>');
 await page.getByLabel('Tags for video 1',{exact:true}).fill('#nexus');
 await page.getByLabel('Choose board video for slot 2').selectOption('video2');
 await expect(page.locator('.flow-row video')).toHaveCount(2);
 await page.getByLabel('Caption for video 2',{exact:true}).fill('Second caption');
 // Agent placement uses the same API and model as touch and mouse drops.
 expect(await page.evaluate(()=>window.nexusBoard.board.items.find(i=>i.id==='video1').y)).toBe(360);
 await expect.poll(async()=>((await boards.read(owner,first.id)).items.find(i=>i.id==='flow').flow_rows||[]).length).toBe(2);
 await expect.poll(async()=>(await boards.read(owner,first.id)).items.find(i=>i.id==='flow').flow_rows[1].caption).toBe('Second caption');
 await page.reload();await expect(page.getByLabel('Caption for video 1',{exact:true})).toHaveValue('First caption <script>not code</script>');
 if(width<700){await page.mouse.move(350,730);await page.mouse.down();await page.mouse.move(30,730,{steps:10});await page.mouse.up();}
 await page.getByRole('button',{name:'Remove from flow',exact:true}).first().click();
 await expect(page.locator('.flow-row video')).toHaveCount(1);
 await expect(page.getByLabel('Caption for video 1',{exact:true})).toHaveValue('Second caption');
 expect(await page.evaluate(()=>window.nexusBoard.board.items.filter(i=>i.kind==='video').length)).toBe(2);
 await page.getByRole('button',{name:'Remove from flow',exact:true}).click();
 await expect(page.locator('.flow-empty')).toBeVisible();await expect(page.locator('.flow-row')).toHaveCount(1);
 await expect.poll(async()=>(await boards.read(owner,first.id)).items.find(i=>i.id==='flow').flow_rows.length).toBe(0);
 await page.reload();await expect(page.locator('.flow-empty')).toBeVisible();
 expect((await boards.read(owner,first.id)).items.find(i=>i.id==='brief').text).toBe('Keep this note.');
});
