import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createAdMediaStore} from '../lib/adMedia.js';
import {createNexusLabAssets} from '../lib/nexusLabAssets.js';
import {createNexusLabBoards} from '../lib/nexusLabBoards.js';
import {createNexusLabHandler} from '../api/nexus-lab.js';
import {labJobMemory} from '../test-support/labJobMemory.mjs';

async function setup(page,{background=true,failDownload=false,boardSources=false,attributed=false}={}){
  const command=labJobMemory(),owner={id:'compose-owner'};let serial=0;
  const media=createAdMediaStore({command,newId:()=> 'med-compose'+(++serial)});
  const assets=createNexusLabAssets({media,command}),boards=createNexusLabBoards({command});
  await page.goto('/board.html'); // harmless initial request; reload below with owned fixture
  const images=await page.evaluate(()=>{
    function make(w,h,cut){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
      if(cut){x.fillStyle='#ff0000';x.fillRect(10,10,20,20);}else{x.fillStyle='#0000ff';x.fillRect(0,0,w,h);}
      return c.toDataURL('image/png').split(',')[1];
    }return [make(40,40,true),make(80,60,false)];
  });
  async function upload(data,name,w,h){const bytes=Buffer.from(data,'base64');const a=await assets.begin(owner,{name,kind:'image',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:w,height:h,provenance:{role:'original',origin:'uploaded',...(attributed&&name==='Background.png'?{attribution:'Photo by Tester'}:{})}});
    await assets.putChunk(owner,{media_id:a.media_id,index:0,data_base64:data});return assets.finish(owner,{media_id:a.media_id});
  }
  const fg=await upload(images[0],'Foreground.png',40,40),bg=background?await upload(images[1],'Background.png',80,60):null;
  const board=await boards.save(owner,{board:{name:'Compose test',look:'dots',bg:'',view:{x:20,y:100,z:1},items:[{id:'foreground',kind:'image',media_id:fg.media_id,title:'Foreground',x:0,y:0,w:160,h:160,z:1},...(boardSources?[{id:'bg-board',kind:'image',media_id:bg.media_id,title:'Board backdrop',x:220,y:0,w:160,h:120,z:2},{id:'visual-board',kind:'visual',html:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60"><rect width="80" height="60" fill="#00ffff"/></svg>',title:'Cyan visual',x:420,y:0,w:80,h:60,z:3}]:[])]}});
  const handler=createNexusLabHandler({authenticate:async()=>owner,assets,boards,once:async(user,id,action,input,work)=>work()});
  await page.route('**/api/nexus-lab',async route=>{
    const req=route.request(),body=req.postDataJSON();
    if(failDownload&&body.action==='asset_download'&&body.input.media_id===bg?.media_id)return route.fulfill({status:403,json:{error:'This background is not available to this account.'}});
    let status=200;const res={setHeader(){return this;},status(n){status=n;return this;},json(body){this.body=body;return this;}};
    await handler({method:'POST',headers:{...req.headers(),host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173'},body},res);
    await route.fulfill({status,json:res.body});
  });
  await page.goto('/board.html?id='+board.id);
  await page.locator('.bitem[data-id=foreground] img').waitFor();
  await page.locator('.bitem[data-id=foreground]').click();
  await page.getByRole('button',{name:'Background',exact:true}).click();
  return {owner,assets,boards,board,fg,bg};
}
const pixel=async(page,x,y)=>page.locator('.compose-frame canvas').evaluate((c,{x,y})=>[...c.getContext('2d').getImageData(x,y,1,1).data],{x,y});
for(const width of [320,393,1280])test('compose, interact, download, save and reopen at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:900});const data=await setup(page);
  const dialog=page.getByRole('dialog',{name:'Compose background'});
  await page.getByLabel('Background image').selectOption(data.bg.media_id);
  await expect(dialog.getByRole('status')).toContainText('80 × 60');
  expect(await pixel(page,0,0)).toEqual([0,0,255,255]);
  expect(await pixel(page,40,30)).toEqual([255,0,0,255]);
  const canvas=page.locator('.compose-frame canvas'),rect=await canvas.boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height/2);await page.mouse.up();
  await expect(page.getByLabel('Horizontal position')).toHaveValue('0.7');
  await page.getByLabel('Horizontal position').press('Home');await expect(page.getByLabel('Horizontal position')).toHaveValue('-0.5');
  await page.getByLabel('Horizontal position').evaluate(n=>{n.value='0.5';n.dispatchEvent(new Event('input',{bubbles:true}));});await page.getByLabel('Foreground size').evaluate(n=>{n.value='0.6';n.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.getByLabel('Output format').selectOption('portrait');expect(await canvas.evaluate(c=>[c.width,c.height])).toEqual([1080,1920]);
  await page.getByLabel('Output format').selectOption('background');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download PNG',exact:true}).click();const download=await downloading;
  const bytes=readFileSync(await download.path());expect(bytes.subarray(1,4).toString()).toBe('PNG');
  // The actual encoded download preserves transparent foreground pixels over the blue background.
  const actual=await page.evaluate(async b64=>{const b=await createImageBitmap(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))]));const c=document.createElement('canvas');c.width=b.width;c.height=b.height;c.getContext('2d').drawImage(b,0,0);const ctx=c.getContext('2d');return {w:b.width,h:b.height,center:[...ctx.getImageData(40,30,1,1).data],corner:[...ctx.getImageData(0,0,1,1).data]};},bytes.toString('base64'));
  expect(actual).toEqual({w:80,h:60,center:[255,0,0,255],corner:[0,0,255,255]});
  await page.getByRole('button',{name:'Save to library',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Saved to your library');
  const output=(await data.assets.list(data.owner)).media.find(m=>m.provenance.role==='output');
  expect(output.provenance.parent_ids).toEqual([data.fg.media_id,data.bg.media_id]);
  expect(output.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect((await data.assets.list(data.owner)).media).toHaveLength(3);
  await expect(page.getByRole('button',{name:'Saved to library',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('#saveState')).toHaveText('Saved');
  await page.reload();await expect(page.locator('.bitem')).toHaveCount(2);
  const reopened=await data.boards.read(data.owner,data.board.id);expect(reopened.items.some(i=>i.media_id===output.media_id)).toBe(true);
  await expect(page.locator('.bitem img')).toHaveCount(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('empty background library and denied image access give usable errors',async({page})=>{
  await setup(page,{background:false});const dialog=page.getByRole('dialog',{name:'Compose background'});
  await expect(dialog.getByRole('status')).toContainText('No other images');
  await expect(page.getByRole('button',{name:'Save to library',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close',exact:true}).click();
});
test('failed background read stays disabled without a stale preview',async({page})=>{
  const {bg}=await setup(page,{failDownload:true});
  await page.getByLabel('Background image').selectOption(bg.media_id);
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('not available to this account');
  await expect(page.getByRole('button',{name:'Save to library',exact:true})).toBeDisabled();
});

test('custom SVG and HTML export actual pixels; active content never runs',async({page},testInfo)=>{
  await page.setViewportSize({width:393,height:900});
  await setup(page,{background:false});
  await page.getByLabel('Background source').selectOption('visual');
  await page.getByLabel('Artwork width').fill('80');await page.getByLabel('Artwork height').fill('60');
  await page.getByLabel('Background artwork').fill('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60"><script>parent.pwned=true</script><rect width="80" height="60" fill="#00ff00"/></svg>');
  await page.getByRole('button',{name:'Use artwork',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('80 × 60');
  expect(await pixel(page,0,0)).toEqual([0,255,0,255]);
  expect(await pixel(page,40,30)).toEqual([255,0,0,255]);
  expect(await page.evaluate(()=>window.pwned)).toBeUndefined();
  await page.getByLabel('Background artwork').fill('<div style="width:80px;height:60px;background:rgb(255,255,0)"><script>parent.pwned=true</script></div>');
  await page.getByRole('button',{name:'Use artwork',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('80 × 60');
  expect(await pixel(page,0,0)).toEqual([255,255,0,255]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.compose-frame').scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('custom-background-phone.png')});
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download PNG',exact:true}).click();
  expect(readFileSync(await (await downloading).path()).subarray(1,4).toString()).toBe('PNG');
  await page.getByLabel('Artwork width').fill('1080');await page.getByLabel('Artwork height').fill('1350');
  await page.getByRole('button',{name:'Try trippy rings',exact:true}).click();
  await page.getByRole('button',{name:'Use artwork',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('1080 × 1350');
  await page.locator('.compose-frame').evaluate(n=>n.scrollIntoView({block:'center'}));
  await page.screenshot({path:testInfo.outputPath('trippy-background-phone.png')});
  await page.getByRole('button',{name:'Save to library',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Saved to your library');
});

test('lookup imports a candidate then saves the composition with its credit',async({page})=>{
  const data=await setup(page,{attributed:true});
  await page.route('**/api/nexus-lab',async route=>{
    const body=route.request().postDataJSON();
    if(body.action==='background_search')return route.fulfill({json:{candidates:[{id:'pexels:photo:123',title:'Blue studio',credit:'Photo by Tester',thumb_url:'https://example.org/blue.jpg'}],skipped:[]}});
    if(body.action==='background_import'){
      return route.fulfill({json:{asset:await data.assets.read(data.owner,data.bg.media_id)}});
    }
    return route.fallback();
  });
  await page.getByLabel('Background source').selectOption('lookup');
  await page.getByLabel('Image search').fill('blue studio');await page.getByRole('button',{name:'Find images',exact:true}).click();
  await expect(page.locator('.compose-result')).toContainText('Photo by Tester');
  await page.getByRole('button',{name:'Use image',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('80 × 60');
  expect(await pixel(page,0,0)).toEqual([0,0,255,255]);
  await expect(page.locator('.compose-credit')).toHaveText('Photo by Tester');
  await page.getByRole('button',{name:'Save to library',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Saved to your library');
  const output=(await data.assets.list(data.owner)).media.find(m=>m.provenance.role==='output');
  expect(output.provenance.attribution).toBe('Photo by Tester');
});

test('board pictures and inline SVGs become selectable image backgrounds',async({page})=>{
  const data=await setup(page,{boardSources:true});
  await page.getByLabel('Background source').selectOption('board');
  await page.getByLabel('Board background').selectOption('bg-board');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('80 × 60');
  expect(await pixel(page,0,0)).toEqual([0,0,255,255]);
  await page.getByLabel('Board background').selectOption('visual-board');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('80 × 60');
  expect(await pixel(page,0,0)).toEqual([0,255,255,255]);
  await page.getByRole('button',{name:'Save to library',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Saved to your library');
  const output=(await data.assets.list(data.owner)).media.find(m=>m.provenance.role==='output');
  expect(output.provenance.parent_ids[0]).toBe(data.fg.media_id);
  expect(output.provenance.parent_ids[1]).not.toBe(data.bg.media_id);
});
test('a stale image response cannot replace the new background source',async({page})=>{
  const data=await setup(page);
  let release,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  await page.route('**/api/nexus-lab',async route=>{
    const body=route.request().postDataJSON();
    if(body.action==='asset_download'&&body.input.media_id===data.bg.media_id){
      started();await new Promise(resolve=>{release=resolve;});
    }
    return route.fallback();
  });
  await page.getByLabel('Background image').selectOption(data.bg.media_id);await waiting;
  await page.getByLabel('Background source').selectOption('visual');
  await page.getByLabel('Background artwork').fill('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="lime"/></svg>');
  await page.getByLabel('Artwork width').fill('80');await page.getByLabel('Artwork height').fill('60');
  await page.getByRole('button',{name:'Use artwork',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('80 × 60');
  release();await page.waitForResponse(r=>r.url().endsWith('/api/nexus-lab')&&r.request().postDataJSON()?.action==='asset_download');
  expect(await pixel(page,0,0)).toEqual([0,255,0,255]);
});
test('upload selects the new picture without leaving the composer',async({page})=>{
  const data=await setup(page);
  const part=await data.assets.downloadChunk(data.owner,{media_id:data.bg.media_id,index:0});
  await page.getByLabel('Background source').selectOption('upload');
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose image file',exact:true}).click();
  await (await chooser).setFiles({name:'New backdrop.png',mimeType:'image/png',buffer:Buffer.from(part.data_base64,'base64')});
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('80 × 60');
  expect(await pixel(page,0,0)).toEqual([0,0,255,255]);
});
