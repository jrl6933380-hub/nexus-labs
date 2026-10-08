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
export async function renderAccountControls(root,ctx,back,actions){
  const open=()=>renderAccountControls(root,ctx,back,actions);
  head(root,'Account & Controls','Your account, usage, and how Nexus works for you.',back);
  const panel=el('div');root.append(panel);panel.append(el('p','Loading your account…','messageformstatus'));
  try{
    const data=await request();if(!root.contains(panel))return;panel.replaceChildren();applyControls(data.preferences);
    const account=group(panel,'Account');
    account.append(el('p',`Signed in as ${data.account.id}`,'controlsummary'));
    row(account,'Plan','Owner · exempt from usage limits',()=>usageView(data));
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
    row(security,'Security and login','Manage your Nexus unlock code',()=>ctx.openSecurity());
    row(security,'Lock Nexus','Secure Nexus on this device',()=>ctx.lockNex());
    row(security,'Chat data','Keep key memories and clear recent chats',actions.clearChats);
    row(security,'Privacy','Read how your information is handled',()=>location.assign('/privacy.html'));
    const help=group(panel,'Get help');
    row(help,'Report a problem','Send feedback about Nexus',actions.feedback);
    row(help,'Help','Explore features and practical examples',()=>ctx.go('guide'));
    row(help,'About & terms','Read the rules for using Nexus',()=>location.assign('/terms.html'));
  }catch(error){if(root.contains(panel)){panel.replaceChildren(el('p',error.message,'messageformstatus'),button('Try again',open));}}
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
    head(root,'Usage & limits','Live activity for your owner account.',open);
    const usagePanel=el('div'),status=el('p',undefined,'messageformstatus');status.setAttribute('role','status');root.append(usagePanel,status);
    function paint(data){
      usagePanel.replaceChildren();const usage=data.usage,today=usage.days[0],week=usage.days.reduce((sum,day)=>sum+day.turns,0);
      const section=group(usagePanel,'Nex & specialists');
      section.append(el('p','Owner account · no usage cap','controlsummary'),el('p',`${today.turns} completed turns today · ${week} in the last 7 UTC days`,'controlsummary'),el('p',usage.scope,'controlnote'));
      const details=el('details'),summary=el('summary','Advanced usage');details.append(summary);
      const totals=usage.days.reduce((sum,day)=>({input:sum.input+day.input,output:sum.output+day.output,elapsed:sum.elapsed+day.elapsedMs}),{input:0,output:0,elapsed:0});
      details.append(el('p',`${totals.input.toLocaleString()} recorded input tokens · ${totals.output.toLocaleString()} recorded output tokens`),el('p',`${Math.round(totals.elapsed/60000)} minutes of combined completed agent turn time`),el('p','Token totals depend on provider reporting. Failed turns, routing calls, and pod idle time are not included. This is activity monitoring, not a pod bill.'));
      section.append(details);
      const forge=group(usagePanel,'Forge');row(forge,'Forge usage & limits','View the existing builder meter separately',()=>ctx.openSystem('forge'));
      status.textContent=`Updated ${new Date(usage.updatedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})} · refreshes every 15 seconds`;
    }
    paint(initial);
    let refreshing=false;
    async function refresh(){if(refreshing || !root.contains(usagePanel))return;refreshing=true;try{const data=await request();if(root.contains(usagePanel))paint(data);}catch(error){if(root.contains(usagePanel))status.textContent=`${error.message} Showing the last loaded usage.`;}finally{refreshing=false;}}
    root.append(button('Refresh now',refresh));
    const tick=()=>setTimeout(async()=>{if(!root.isConnected || !root.contains(usagePanel))return;await refresh();tick();},15000);tick();
  }
}
