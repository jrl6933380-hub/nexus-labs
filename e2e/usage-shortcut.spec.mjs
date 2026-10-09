import {test,expect} from '@playwright/test';
test.use({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
test('@usage opens live usage from Nex, specialist and team chats without dispatching a turn',async({page})=>{
  const writes=[],errors=[];let turns=3,offline=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/_vercel/insights/script.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let data={items:[]};
    if(route.request().method()==='POST')writes.push({path:url.pathname,body:route.request().postDataJSON()});
    if(url.pathname==='/api/nexus-auth')data={authenticated:true,owner:{id:'justin'}};
    if(url.pathname==='/api/chat')data={threads:[],messages:[{role:'user',content:'Keep this existing conversation.'}]};
    if(url.pathname==='/api/nexus-messages')data=url.searchParams.has('group_id')?{group:{id:url.searchParams.get('group_id'),kind:url.searchParams.get('group_id').startsWith('group-')?'group':'nex',include_nex:false,available_members:[]},runs:[]}:{specialists:[{id:'agent-vida',name:'Vida',role:'life',job:'Plan your life.'}],groups:[{id:'group-launch',title:'Launch',member_ids:['agent-vida'],include_nex:false}],roles:{life:{label:'Life'}},scopes:[],pinned_system_ids:[]};
    if(url.pathname==='/api/nexus-controls'){
      if(offline)return route.fulfill({status:503,json:{error:'Controls unavailable'}});
      data={account:{id:'justin',plan:'Owner',exempt:true},preferences:{accent:'gold',responseStyle:'balanced'},usage:{updatedAt:Date.now(),scope:'Completed turns',days:[{turns,input:100,output:20,elapsedMs:5000}]}};
    }
    await route.fulfill({json:data});
  });
  await page.goto('/workspace.html');
  const home=async()=>{await page.locator('.messageback').click();await expect(page.getByText('Keep this existing conversation.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to Messages',exact:true}).click();await expect(page.locator('.messagelist')).toBeVisible();};
  const usage=async()=>{await expect(page.getByRole('heading',{name:'Usage & limits',exact:true})).toBeVisible();await expect(page.getByText(`${turns} completed turns today · ${turns} in the last 7 UTC days`,{exact:true})).toBeVisible();};
  await page.locator('.messagelist').getByRole('button',{name:/Nex Your main intelligence/}).click();
  await page.locator('#input').fill('Please look at @us');await expect(page.locator('.teammentions').getByRole('button',{name:/Usage @usage/})).toHaveCount(0);await page.locator('#input').fill('@us');await page.locator('.teammentions').getByRole('button',{name:/Usage @usage/}).click();await usage();
  turns=4;await page.getByRole('button',{name:'Refresh now',exact:true}).click();await usage();
  offline=true;await page.getByRole('button',{name:'Refresh now',exact:true}).click();await expect(page.getByRole('status')).toContainText('Showing the last loaded usage');await usage();offline=false;
  await home();await page.getByRole('region',{name:'Agents'}).getByRole('button',{name:/Vida/}).click();await expect(page.getByText('Keep this existing conversation.',{exact:true})).toBeVisible();
  await page.locator('#input').fill(' @USAGE ');await page.getByRole('button',{name:'Send',exact:true}).click();await usage();
  await home();await page.locator('.messagelist').getByRole('button',{name:/Launch/}).click();await page.locator('#input').fill('@usage');await page.locator('#input').press('Enter');await usage();
  await home();await page.locator('.messagelist').getByRole('button',{name:/Nex Your main intelligence/}).click();offline=true;await page.locator('#input').fill('@usage');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('Controls unavailable',{exact:true})).toBeVisible();offline=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await usage();
  expect(writes.filter(write=>write.path==='/api/chat' || write.body?.action==='team_create')).toEqual([]);expect(errors).toEqual([]);
});
