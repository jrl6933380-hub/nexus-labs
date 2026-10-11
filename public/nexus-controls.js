const COLORS={gold:'#e1bd72',blue:'#74a7ff',green:'#72d896',violet:'#bd9aff'};
const el=(tag,text,cls='')=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;item.className=cls;return item;};
function button(text,run,cls='messagesecondary'){const item=el('button',text,cls);item.type='button';item.onclick=run;return item;}
export function applyControls(preferences){
  const accent=COLORS[preferences?.accent] || COLORS.gold;
  document.documentElement.style.setProperty('--nexus-control-accent',accent);
  try{localStorage.setItem('nexus-control-accent',preferences?.accent || 'gold');}catch{}
}
async function request(patch){
  const response=await fetch('/api/nexus-controls',{credentials:'include',cache:'no-store',...(patch?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}:{})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error || 'Account controls could not load');return data;
}
export async function syncControls(){try{const data=await request();applyControls(data.preferences);}catch{}}
function head(root,title,copy,back){root.replaceChildren();const top=el('div',undefined,'messagepanelhead');top.append(button('‹',back,'messageback'),el('h2',title));root.append(top,el('p',copy,'messageintro'));}
function group(root,title){const section=el('section',undefined,'controlgroup');section.append(el('h3',title));root.append(section);return section;}
function row(section,title,description,run){const item=button('',run,'controlrow');const text=el('span');text.append(el('strong',title),el('small',description));item.append(text,el('span','›','controlchevron'));section.append(item);}
export async function renderAccountControls(root,ctx,back,actions,initialView='account'){
  const open=()=>renderAccountControls(root,ctx,back,actions);
  head(root,'Account & Controls','Your account, usage, and how Nexus works for you.',back);
  const panel=el('div');root.append(panel);panel.append(el('p','Loading your account…','messageformstatus'));
  try{
    const data=await request();if(!root.contains(panel))return;panel.replaceChildren();applyControls(data.preferences);if(initialView==='usage'){usageView(data);return;}
    const account=group(panel,'Account');
    account.append(el('p',`Signed in as ${data.account.id}`,'controlsummary'));
    row(account,'Plan',data.account.exempt?'Owner · exempt from usage limits':`${data.account.plan} plan`,()=>usageView(data));
    row(account,'Usage & limits','Live activity for Nex and your agents',()=>usageView(data));
    const customize=group(panel,'Customize Nexus');
    row(customize,'Reply preferences',`Reply length: ${data.preferences.responseStyle}`,()=>preferenceView(data));
    row(customize,'Memory','Review and manage what Nexus remembers',()=>ctx.openSystem('memory'));
    row(customize,'Connections','Manage connections for your projects',()=>ctx.openSystem('workbench'));
    row(customize,'Accent color',data.preferences.accent,()=>preferenceView(data));
    const intelligence=group(panel,'Intelligence');
    row(intelligence,'AI Team','Manage your agents and their work',()=>ctx.openSystem('agents'));
    row(intelligence,'Pod Room','Your connected intelligence workspace',()=>ctx.openSystem('pod'));
    row(intelligence,'Capabilities','Tools, skills, and commands together',actions.capabilities);
    const app=group(panel,'App settings');
    row(app,'Notifications','Turn phone alerts on or off for this device',actions.notifications);
    row(app,'Install Nexus','Open Nexus from your Home Screen',actions.install);
    const security=group(panel,'Security & data');
    row(security,'Security and login','Manage your account sign-in',()=>ctx.openSecurity());
    row(security,'Lock Nexus','Secure Nexus on this device',()=>ctx.lockNex());
    row(security,'Chat data','Keep key memories and clear recent chats',actions.clearChats);
    row(security,'Privacy','Read how your information is handled',()=>location.assign('/privacy.html'));
    const help=group(panel,'Get help');
    row(help,'Report a problem','Send feedback about Nexus',actions.feedback);
    row(help,'Help','Explore features and practical examples',()=>ctx.go('guide'));
    row(help,'About & terms','Read the rules for using Nexus',()=>location.assign('/terms.html'));
  }catch(error){if(root.contains(panel)){panel.replaceChildren(el('p',error.message,'messageformstatus'),button('Try again',()=>renderAccountControls(root,ctx,back,actions,initialView)));}}
  function preferenceView(data){
    head(root,'Personalize Nexus','Saved to your account. Reply preferences apply to Nex and specialists; color applies to this workspace.',open);
    const form=el('form',undefined,'messageform'),style=el('select'),accent=el('select'),status=el('p',undefined,'messageformstatus');status.setAttribute('role','status');
    for(const [value,label] of [['balanced','Balanced'],['concise','Concise'],['detailed','Detailed']]){const option=el('option',label);option.value=value;style.append(option);}
    for(const value of Object.keys(COLORS)){const option=el('option',value[0].toUpperCase()+value.slice(1));option.value=value;accent.append(option);}
    style.id='nexus-response-style';accent.id='nexus-accent';style.value=data.preferences.responseStyle;accent.value=data.preferences.accent;
    const styleLabel=el('label','Reply length');styleLabel.htmlFor=style.id;const accentLabel=el('label','Accent color');accentLabel.htmlFor=accent.id;
    const save=button('Save preferences',null,'uxprimary messagecontinue');save.type='submit';
    form.append(styleLabel,style,accentLabel,accent,save,status);root.append(form);
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;status.textContent='Saving…';try{const updated=await request({responseStyle:style.value,accent:accent.value});applyControls(updated.preferences);status.textContent='Saved. Your next replies will use this preference.';}catch(error){status.textContent=error.message;}finally{save.disabled=false;}};
  }
  function usageView(initial){
    head(root,'Usage & limits','Your included allowance and extra usage.',initialView==='usage' ? back : open);
    const navigation=el('nav',undefined,'usage-nav');navigation.setAttribute('aria-label','Usage page sections');
    for(const [id,label] of [['allowance','Usage'],['packs','Usage packs'],['plans','Plans']])navigation.append(button(label,()=>{const section=usagePanel.querySelector(`[data-usage-section="${id}"]`);section?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});section?.focus({preventScroll:true});},'usage-nav-button'));
    const usagePanel=el('div',undefined,'usage-sections'),status=el('p',undefined,'messageformstatus');status.setAttribute('role','status');root.append(navigation,usagePanel,status);
    function destination(section,id){section.dataset.usageSection=id;section.tabIndex=-1;section.classList.add('usage-section');return section;}
    function paint(data){
      usagePanel.replaceChildren();const usage=data.usage,limits=data.usageLimits,exempt=data.account.exempt;
      const section=destination(group(usagePanel,'AI usage'),'allowance');
      section.append(el('p','AI usage reflects conversation context, generated answers, reasoning, and each model call in a task. Manual actions and waiting in the app do not use AI allowance. If the runtime cannot report usage, a conservative estimate applies.','controlnote'));
      section.append(el('p',exempt?'Owner account · no usage cap':`${data.account.plan} plan`,'controlsummary'));
      function bar(label,pool){
        const card=el('div',undefined,'usagecard'),heading=el('div',undefined,'usageheading');
        heading.append(el('strong',label),el('span',exempt?'No limit':`${pool.percentRemaining}% remaining`));
        const progress=el('progress');progress.max=100;progress.value=pool.percentRemaining;progress.setAttribute('aria-label',`${label} remaining`);
        const reset=pool.resetAt?`Resets ${new Date(pool.resetAt).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'})}`:exempt?'Your account is exempt':'No extra usage purchased';
        card.append(heading,progress,el('p',reset,'controlnote'));section.append(card);
      }
      bar('5-hour allowance',limits?.short||{percentRemaining:100,resetAt:null});
      bar('Weekly allowance',limits?.weekly||{percentRemaining:100,resetAt:null});
      const extra=limits?.extra||{percentRemaining:0,available:false,enabled:false};
      if(!exempt){
        const extraSection=destination(group(usagePanel,'Usage packs'),'packs'),heading=el('div',undefined,'usageheading');heading.append(el('strong','Extra usage'),el('span',`${extra.percentRemaining}% remaining`));
        const progress=el('progress');progress.max=100;progress.value=extra.percentRemaining;progress.setAttribute('aria-label','Extra usage remaining');extraSection.append(heading,progress,el('p','Included usage is used first. Packs add AI allowance, not a fixed number of messages or builds. Extra usage carries forward and never unlocks additional plan features.','controlnote'));
        const toggle=button(extra.enabled?'Stop using extra allowance':'Use extra allowance when included usage runs out',async()=>{
          toggle.disabled=true;try{const response=await fetch('/api/room-usage',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'extra_usage',enabled:!extra.enabled})});const payload=await response.json();if(!response.ok)throw Error(payload.error||'Could not update extra usage');await refresh();}catch(error){status.textContent=error.message;toggle.disabled=false;}
        });toggle.disabled=!extra.available;extraSection.append(toggle);
        extraSection.append(button('Buy a usage pack · $6',()=>buyPack(), 'uxprimary messagecontinue'));
      }
      if(exempt)destination(group(usagePanel,'Usage packs'),'packs').append(el('p','Your owner account has no usage cap. You do not need a usage pack.','controlnote'));
      const plans=destination(group(usagePanel,'Nexus plans'),'plans'),grid=el('div',undefined,'usage-plan-grid');plans.append(el('p','Choose the space and AI allowance that fit how you use Nexus.','controlnote'),grid);
      const current=String(data.account.plan).toLowerCase();
      for(const plan of [
        {id:'free',name:'Free',price:'$0',copy:'Start with the everyday essentials.',features:['Limited Nex chat','Calendar & Reminders','Phone notifications','1 demo project']},
        {id:'pro',name:'Pro',price:'$10',copy:'Plan your life and build your ideas.',features:['Everything in Free','Nexus Life','Builder · 3 projects','Standard AI allowance'],checkout:'nexus_pro_monthly'},
        {id:'plus',name:'Plus',price:'$20',copy:'More room for everything you’re making.',features:['Everything in Pro','6 projects','2× the included Pro allowance'],checkout:'nexus_plus_monthly'}
      ]){
        const card=el('article',undefined,`usage-plan usage-plan-${plan.id}`),top=el('div',undefined,'usage-plan-top');top.append(el('h4',plan.name));if(!exempt&&current===plan.id)top.append(el('span','Your plan','usage-plan-badge'));else if(plan.id==='plus')top.append(el('span','More capacity','usage-plan-badge'));
        const price=el('p',undefined,'usage-plan-price');price.append(el('strong',plan.price),el('span',plan.id==='free'?' / forever':' / month'));const list=el('ul');for(const feature of plan.features)list.append(el('li',feature));card.append(top,price,el('p',plan.copy,'usage-plan-copy'),list);
        if(!exempt&&plan.checkout){const choose=button(current===plan.id?'Current plan':`Choose ${plan.name} · ${plan.price}/month`,()=>buyPack(plan.checkout),'usage-plan-action');choose.disabled=current===plan.id;card.append(choose);}grid.append(card);
      }
      section.append(el('p','Manual Calendar and Reminder actions and saved phone notifications never use your AI allowance.','controlnote'));
      if(exempt&&usage?.days){const today=usage.days[0],week=usage.days.reduce((sum,day)=>sum+day.turns,0);section.append(el('p',`${today.turns} completed turns today · ${week} in the last 7 UTC days`,'controlnote'));}
      status.textContent=`Updated ${new Date(limits?.updatedAt||usage?.updatedAt||Date.now()).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})} · refreshes every 15 seconds`;

    }
    async function buyPack(priceId='price_1UEjoFDh5Di7LYi3DGorrLRb'){
      status.textContent='Opening secure checkout…';try{const response=await fetch('/api/checkout',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({priceId})});const payload=await response.json();if(!response.ok)throw Error(payload.error||'Could not open checkout');const url=new URL(payload.url);if(url.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))throw Error('Checkout could not open');location.assign(url.href);}catch(error){status.textContent=error.message;}
    }
    paint(initial);
    let refreshing=false;
    async function refresh(){if(refreshing || !root.contains(usagePanel))return;refreshing=true;try{const data=await request();if(root.contains(usagePanel))paint(data);}catch(error){if(root.contains(usagePanel))status.textContent=`${error.message} Showing the last loaded usage.`;}finally{refreshing=false;}}
    root.append(button('Refresh now',refresh));
    const tick=()=>setTimeout(async()=>{if(!root.isConnected || !root.contains(usagePanel))return;await refresh();tick();},15000);tick();
  }
}
