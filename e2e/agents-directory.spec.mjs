import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.use({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
const agents=[
  {id:'agent-atlas',name:'Atlas',role:'research',job:'Research questions and compare options.'},
  {id:'agent-mason',name:'Mason',role:'build',job:'Build websites, apps, and project features.'},
  {id:'agent-vida',name:'Vida',role:'life',job:'Plan your life, schedule, and reminders.'},
  {id:'agent-vera',name:'Vera',role:'review',job:'Review work and find problems.'},
  {id:'agent-custom',name:'My Analyst',role:'custom',job:'Compare my business plans.'},
];
test('agents share one directory under Nex, search by role, and open their own chats',async({page})=>{
  const opened=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/_vercel/insights/script.js',route=>route.fulfill({body:'',contentType:'application/javascript'}));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let data={items:[]};
    if(url.pathname==='/api/nexus-auth')data={authenticated:true,owner:{id:'justin'}};
    if(url.pathname==='/api/chat'){data={threads:[],messages:[]};if(url.searchParams.has('threadId'))opened.push(url.searchParams.get('threadId'));}
    if(url.pathname==='/api/nexus-messages')data={specialists:agents,roles:{research:{label:'Research'},build:{label:'Builder'},life:{label:'Life'},review:{label:'Reviewer'},custom:{label:'Custom'}},groups:[{id:'group-launch',title:'Launch team',member_ids:['agent-mason','agent-vera'],include_nex:false}],pinned_system_ids:['life'],scopes:[]};
    await route.fulfill({json:data});
  });
  await page.goto('/workspace.html');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening)/})).toBeVisible();
  await page.getByRole('button',{name:/Nex 5 agents connected/}).click();
  const directory=page.getByRole('region',{name:'Agents',exact:true});
  await expect(directory.getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('button',{name:/Talk with Nex/})).toBeVisible();
  await expect(directory.getByRole('button',{name:/Launch team/})).toHaveCount(0);
  const search=page.getByRole('searchbox',{name:'Find an agent'});await search.fill('Builder');await expect(directory.getByRole('button')).toHaveCount(1);await expect(directory).toContainText('Mason');
  await search.fill('missing agent');await expect(page.getByText('No agents match that search.')).toBeVisible();await search.fill('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const a11y=await new AxeBuilder({page}).include('.nexusmessages').withTags(['wcag2a','wcag2aa']).analyze();expect(a11y.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
  await page.screenshot({path:'test-results/agents-directory-mobile.png',fullPage:true});
  for(const agent of agents){await directory.getByRole('button',{name:new RegExp(agent.name)}).click();await expect(page.locator('body')).toHaveAttribute('data-view','chat');expect(opened.at(-1)).toBe(agent.id);await page.getByRole('button',{name:'Back to Messages',exact:true}).click();await page.getByRole('button',{name:/Nex 5 agents connected/}).click();await expect(directory.getByRole('button')).toHaveCount(5);}
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/agents-directory-desktop.png',fullPage:true});expect(errors).toEqual([]);
});
