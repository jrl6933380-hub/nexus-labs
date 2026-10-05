import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const members=[{id:'agent-maya',name:'Maya',role:'research',job:'Research launch ideas',scopes:['conversation']},{id:'agent-atlas',name:'Atlas',role:'build',job:'Build projects',scopes:['conversation','projects']}];
async function setup(page){
  let run=null;const actions=[];
  const group={id:'group-launch',title:'Launch team',member_ids:members.map(member=>member.id),members};
  // Analytics is supplied by Vercel in production; the static dev server
  // otherwise serves an HTML fallback at this script URL.
  await page.route('**/_vercel/insights/script.js',route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),body=route.request().method()==='POST'?route.request().postDataJSON():{};
    let data={items:[]};
    if(url.pathname==='/api/nexus-auth')data={authenticated:true,owner:{id:'testowner'}};
    if(url.pathname==='/api/chat')data={threads:[],messages:[],thread:{id:'group-launch',title:'Team launch',message_count:1}};
    if(url.pathname==='/api/nexus-messages'){
      if(url.searchParams.has('group_id'))data={group,runs:run?[run]:[]};
      else if(body.action?.startsWith('team_')){
        actions.push(body.action);
        if(body.action==='team_create')run={id:'mission-test',goal:'Research launch ideas and build the landing page',message:body.message,state:'planned',events:[],steps:[
          {id:'step-maya',member_id:'agent-maya',name:'Maya',role:'research',instruction:'Research launch ideas',scopes:['conversation'],state:'queued'},
          {id:'step-atlas',member_id:'agent-atlas',name:'Atlas',role:'build',instruction:'Build the landing page using Maya’s findings',scopes:['conversation','projects'],state:'queued',requires_approval:true},
          {id:'step-nex',member_id:null,name:'Nex',role:'review',instruction:'Review the team’s returned results',state:'queued'},
        ]};
        if(body.action==='team_start'){run.state='running';run.steps[0].state='working';run.steps[0].activity='Searching for useful information';}
        if(body.action==='team_advance' && run.state==='running'){
          if(run.steps[0].state==='working'){run.steps[0].state='returned';run.steps[0].result='Research finding: start with a local gardening audience.';run.steps[1].state='needs_approval';run.state='needs_approval';}
          else if(run.steps[1].state==='working'){run.steps[1].state='returned';run.steps[1].result='Draft ready for review. <script>unsafe()</script>';run.steps[2].state='returned';run.steps[2].result='Nex review: the draft is saved; publishing still needs a separate decision.';run.state='completed';}
        }
        if(body.action==='team_approve_step'){expect(body.step_id).toBe('step-atlas');run.steps[1].state='working';run.steps[1].approved_at=Date.now();run.state='running';}
        if(body.action==='team_cancel')run.state='cancelled';
        data={run};
      }else data={specialists:members,groups:[group],pinned_system_ids:[],roles:{research:{label:'Research'},build:{label:'Build'}},scopes:['conversation','projects']};
    }
    await route.fulfill({json:data});
  });
  await page.goto('/workspace.html');
  await page.getByRole('button',{name:/Launch team/}).click();
  await expect(page.getByText('Turn an idea into a team mission.')).toBeVisible();
  return actions;
}

export function registerTeamChatChecks(){
  test.describe('group missions',()=>{
test.use({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
test('mentions, approval, real state rendering and saved results work in the mobile group chat',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.stack || error.message));const actions=await setup(page);
  const input=page.locator('#input');
  await input.fill('@ma');await expect(page.locator('.teammention').filter({hasText:'Maya'})).toBeVisible();
  await input.press('Enter');await expect(input).toHaveValue('@maya ');expect(actions).not.toContain('team_create');
  await input.fill('@maya research launch ideas @atlas build the landing page');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByRole('button',{name:'Approve plan & start'})).toBeVisible();expect(actions).not.toContain('team_start');
  await page.getByRole('button',{name:'Approve plan & start'}).click();
  await expect(page.getByRole('button',{name:'Approve build',exact:true})).toBeVisible({timeout:12000});
  await page.getByRole('button',{name:'Approve build',exact:true}).click();
  await expect(page.locator('.teammission').getByText('Ready to review',{exact:true})).toBeVisible({timeout:12000});
  await page.getByText('Atlas’s result',{exact:true}).click();
  await expect(page.locator('.teamresult').filter({hasText:'<script>unsafe()</script>'})).toBeVisible();expect(await page.locator('.teamboard script').count()).toBe(0);
  await page.screenshot({path:'test-results/team-mobile.png',fullPage:true});
  await page.reload();await page.getByRole('button',{name:/Launch team/}).click();
  await expect(page.locator('.teammission').getByText('Ready to review',{exact:true})).toBeVisible();
  await page.getByText('Nex’s result',{exact:true}).click();await expect(page.getByText(/publishing still needs a separate decision/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  const result=await new AxeBuilder({page}).include('.teamboard').withTags(['wcag2a','wcag2aa']).analyze();expect(result.violations.filter(item=>['serious','critical'].includes(item.impact))).toEqual([]);
  expect(errors).toEqual([]);
});

test('participant tap inserts a mention and cancellation retains the mission',async({page})=>{
  await setup(page);await page.getByRole('button',{name:/Mention Atlas/}).click();await expect(page.locator('#input')).toHaveValue('@atlas ');
  await page.locator('#input').fill('@atlas improve the landing page');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('button',{name:'Cancel task',exact:true}).click();await expect(page.locator('.teammission').getByText('Cancelled',{exact:true})).toBeVisible();
});

  });
}
