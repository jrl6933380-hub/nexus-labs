import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createAdMediaStore} from '../lib/adMedia.js';
import {createNexusLabAssets} from '../lib/nexusLabAssets.js';
import {createNexusLabBoards} from '../lib/nexusLabBoards.js';
import {createNexusLabHandler} from '../api/nexus-lab.js';
import {labJobMemory} from '../test-support/labJobMemory.mjs';

async function setup(page,{background=true,failDownload=false}={}){
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
  async function upload(data,name,w,h){const bytes=Buffer.from(data,'base64');const a=await assets.begin(owner,{name,kind:'image',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:w,height:h,provenance:{role:'original',origin:'uploaded'}});
    await assets.putChunk(owner,{media_id:a.media_id,index:0,data_base64:data});return assets.finish(owner,{media_id:a.media_id});
  }
  const fg=await upload(images[0],'Foreground.png',40,40),bg=background?await upload(images[1],'Background.png',80,60):null;
  const board=await boards.save(owner,{board:{name:'Compose test',look:'dots',bg:'',view:{x:20,y:100,z:1},items:[{id:'foreground',kind:'image',media_id:fg.media_id,title:'Foreground',x:0,y:0,w:160,h:160,z:1}]}});
  const handler=createNexusLabHandler({authenticate:async()=>owner,assets,boards,once:async(user,id,action,input,work)=>work()});
  await page.route('**/api/nexus-lab',async route=>{
    const req=route.request(),body=req.postDataJSON();
    if(failDownload&&body.action==='asset_download'&&body.input.media_id===bg?.media_id)return route.fulfill({status:403,json:{error:'This background is not available to this account.'}});
    let status=200;const res={setHeader(){return this;},status(n){status=n;return this;},json(body){this.body=body;return this;}};
    await handler({method:'POST',headers:{...req.headers(),host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173'},body},res);
    await route.fulfill({status,json:res.body});
  });
  await page.goto('/board.html?id='+board.id);
  await page.locator('.bitem img').waitFor();
  await page.locator('.bitem').click();
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
