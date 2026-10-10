import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createNexusControlsHandler} from '../api/nexus-controls.js';
import {createUsageHandler} from '../api/room-usage.js';
import {createCheckoutHandler} from '../api/checkout.js';
test.use({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
test('paid account sees percentages, opts into extra usage, refreshes, and opens the $6 checkout',async({page})=>{
 const writes=[],errors=[];let enabled=false,remaining=65;
 const summary=async()=>({plan:'Pro',exempt:false,short:{percentRemaining:remaining,resetAt:Date.now()+3600000},weekly:{percentRemaining:80,resetAt:Date.now()+86400000},extra:{percentRemaining:75,available:true,enabled},pack:{priceUsd:6},updatedAt:Date.now()});
 const meter={summary,setExtraEnabled:async(user,value)=>{expect(user).toBe('customer');enabled=value;return summary();}};
 const controls=createNexusControlsHandler({getOwner:async()=>null,getUser:async()=> 'customer',meter,store:{preferences:async()=>({accent:'gold',responseStyle:'balanced'}),usage:async()=>({days:[],updatedAt:Date.now()})}});
 const usage=createUsageHandler({resolveUser:async()=> 'customer',meter});
 const checkout=createCheckoutHandler({resolveUser:async()=> 'customer',configured:()=>true,request:async(path,body)=>{writes.push(body);return {url:'https://checkout.stripe.com/nexus-test'};}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://checkout.stripe.com/**',route=>route.fulfill({body:'Test checkout',contentType:'text/html'}));
 await page.route('**/_vercel/insights/script.js',route=>route.fulfill({body:''}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const handler=path==='/api/nexus-controls'?controls:path==='/api/room-usage'?usage:path==='/api/checkout'?checkout:null;
  if(handler){const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({method:route.request().method(),body:route.request().method()==='POST'?route.request().postDataJSON():undefined},res);return route.fulfill({status:res.code,json:res.body});}
  return route.fulfill({json:path==='/api/nexus-auth'?{authenticated:true,owner:{id:'justin'}}:path==='/api/nexus-messages'?{specialists:[],groups:[],pinned_system_ids:[]}:path==='/api/chat'?{threads:[],messages:[]}:{items:[]}});
 });
 await page.goto('/usage.html');
 await expect(page.getByText('65% remaining',{exact:true})).toBeVisible();await expect(page.getByText('80% remaining',{exact:true})).toBeVisible();await expect(page.getByText('75% remaining',{exact:true})).toBeVisible();
 await expect(page.getByText(/credits remaining|credits left|\d+ credits/i)).toHaveCount(0);
 await page.getByRole('button',{name:'Use extra allowance when included usage runs out',exact:true}).click();await expect(page.getByRole('button',{name:'Stop using extra allowance',exact:true})).toBeVisible();expect(enabled).toBe(true);
 remaining=40;await page.getByRole('button',{name:'Refresh now',exact:true}).click();await expect(page.getByText('40% remaining',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const a11y=await new AxeBuilder({page}).include('.controlgroup').withTags(['wcag2a','wcag2aa']).analyze();expect(a11y.violations.filter(v=>['critical','serious'].includes(v.impact))).toEqual([]);
 await page.getByRole('heading',{name:'Usage & limits',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:'test-results/percentage-usage-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Buy a usage pack · $6',exact:true}).click();await expect(page).toHaveURL('https://checkout.stripe.com/nexus-test');expect(writes[0]['metadata[kind]']).toBe('credit_pack');expect(writes[0]['line_items[0][price]']).toBe('price_1UEjoFDh5Di7LYi3DGorrLRb');expect(errors).toEqual([]);
});
