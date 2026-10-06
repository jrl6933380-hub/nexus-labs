import { appendChatVisual } from './chat-visual.js';
import { teamHandles } from './team-mentions.js';

const node=(tag,text,cls='')=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;element.className=cls;return element;};
const button=(text,run,cls='')=>{const element=node('button',text,cls);element.type='button';element.onclick=run;return element;};
const LABELS={planned:'Review plan',queued:'Up next',running:'Team working',working:'Working',returned:'Result ready',needs_approval:'Needs you',blocked:'Needs attention',interrupted:'Interrupted',completed:'Ready to review',cancelled:'Cancelled',stopping:'Stopping'};
function avatar(person){const mark=node('span',person.name==='Nex'?'N':undefined,`messageavatar teamavatar tone-${person.role} ${person.role}`);mark.setAttribute('aria-hidden','true');if(['research','build','life','review'].includes(person.role) && person.name!=='Nex')mark.append(node('i'));else mark.textContent=person.name.slice(0,1).toUpperCase();return mark;}
export function createTeamChat({input,thread,onMessage=()=>{},onGroup=()=>{},openApprovals=()=>{}}) {
  let group=null,host=null,timer=null,generation=0,refreshing=null,signature='',runs=[],roster=[],request=null;
  const suggestions=node('div',undefined,'teammentions');suggestions.hidden=true;suggestions.setAttribute('aria-label','Mention a teammate');
  input.parentElement.append(suggestions);input.setAttribute('aria-controls','teamMentionSuggestions');suggestions.id='teamMentionSuggestions';
  const announce=node('p',undefined,'teamannounce');announce.setAttribute('role','status');announce.setAttribute('aria-live','polite');
  function mention(person){const token=person.handle || 'team',match=input.value.slice(0,input.selectionStart).match(/(^|\s)@[\p{L}\p{N}_-]*$/u);const end=input.selectionStart;const start=match?end-match[0].trimStart().length:end;input.setRangeText(`@${token} `,start,end,'end');suggestions.hidden=true;input.focus();input.setAttribute('aria-expanded','false');}
  function suggest(){
    if(!group){suggestions.hidden=true;return;}
    const match=input.value.slice(0,input.selectionStart).match(/(^|\s)@([\p{L}\p{N}_-]*)$/u);
    suggestions.replaceChildren();if(!match){suggestions.hidden=true;input.setAttribute('aria-expanded','false');return;}
    const needle=match[2].toLowerCase(),options=[{name:group.kind==='group'?'Whole team':'All my agents',handle:'team',role:'group'},...roster].filter(person=>person.handle.startsWith(needle) || person.name.toLowerCase().includes(needle));
    for(const person of options)suggestions.append(mentionButton(person));
    suggestions.hidden=!options.length;input.setAttribute('aria-expanded',String(options.length>0));
  }
  function mentionButton(person){const item=button('',()=>mention(person),'teammention');item.append(avatar(person),node('strong',person.name),node('small',`@${person.handle}`));return item;}
  input.addEventListener('input',()=>{request=null;suggest();});
  input.addEventListener('keydown',event=>{
    if(suggestions.hidden)return;
    if(event.key==='Escape'){suggestions.hidden=true;input.setAttribute('aria-expanded','false');event.preventDefault();}
    if(event.key==='ArrowDown'){suggestions.querySelector('button')?.focus();event.preventDefault();}
    if(event.key==='Enter'){suggestions.querySelector('button')?.click();event.preventDefault();event.stopImmediatePropagation();}
  });
  suggestions.addEventListener('keydown',event=>{
    const choices=[...suggestions.querySelectorAll('button')],index=choices.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp'].includes(event.key)){choices[(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length]?.focus();event.preventDefault();}
    if(event.key==='Escape'){suggestions.hidden=true;input.focus();}
  });
  async function api(action,body={}) {
    const response=await fetch('/api/nexus-messages'+(action?'':`?group_id=${encodeURIComponent(group.id)}`),{credentials:'include',cache:'no-store',...(action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,group_id:group.id,...body})}:{})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error || 'The team could not save that update.');return data;
  }
  function stop(){generation++;refreshing=null;clearTimeout(timer);timer=null;group=null;host?.remove();host=null;roster=[];runs=[];request=null;signature='';suggestions.hidden=true;input.removeAttribute('aria-expanded');}
  function renderRoster(){
    const banner=thread.querySelector('.conversationbanner');if(!banner)return;
    const strip=node('div',undefined,'teamroster');strip.setAttribute('aria-label','Team members');
    if(group.kind==='group'){
      const toggle=button(group.include_nex===false?'Add Nex':'Nex participating · Remove',async()=>{try{await api('set_group_nex',{include_nex:group.include_nex===false});signature='';await refresh();}catch(error){announce.textContent=error.message;}},'teamcoordinator');strip.append(toggle);
    }
    for(const person of roster.filter(person=>group.kind!=='group' || group.member_ids.includes(person.id))){const step=runs[0]?.state==='cancelled'?null:runs[0]?.steps.find(step=>step.member_id===person.id);
      const item=button('',()=>mention(person),`teamchip tone-${person.role}`);item.append(avatar(person),node('span',person.name),node('small',LABELS[step?.state] || 'Ready'));item.setAttribute('aria-label',`Mention ${person.name}, ${LABELS[step?.state] || 'ready'}`);strip.append(item);}
    banner.replaceChildren(strip,node('p','Tap a teammate or type @ to assign work.','teamhint'));
  }
  async function act(action,run,step=null,control=null){
    const stamp=generation;if(control)control.disabled=true;
    try{await api(`team_${action}`,{run_id:run.id,step_id:step?.id});if(stamp!==generation)return;signature='';await refresh(stamp);}
    catch(error){if(stamp===generation){announce.textContent=error.message;if(control)control.disabled=false;}}
  }
  function actionButton(label,action,run,step=null,cls=''){const control=button(label,()=>act(action,run,step,control),cls);return control;}
  function render(){
    if(!host)return;
    const expanded=new Set([...host.querySelectorAll('details[open]')].map(item=>item.dataset.step));
    host.replaceChildren(announce);renderRoster();
    if(!runs.length && group.kind!=='group')return;
    if(!runs.length){const empty=node('section',undefined,'teamwelcome');empty.append(node('small','YOUR TEAM, ONE CONVERSATION','teameyebrow'),node('h3','Turn an idea into a team mission.'),node('p','Give each teammate an assignment. Their results stay here, with clear handoffs. You choose whether Nex participates.'),button('Plan with the whole team',()=>mention({handle:'team'}),'teamgold'));host.append(empty);return;}
    for(const run of runs.slice(0,4)){
      const card=node('section',undefined,`teammission state-${run.state}`);card.dataset.run=run.id;card.setAttribute('aria-label',`Team task: ${run.goal}`);
      const top=node('div',undefined,'teammissionhead');top.append(node('small','TEAM MISSION','teameyebrow'),node('span',LABELS[run.state] || run.state,'teamstate'));
      card.append(top,node('h3',run.goal));
      const returned=run.steps.filter(step=>step.state==='returned').length,progress=node('progress');progress.max=run.steps.length;progress.value=returned;progress.setAttribute('aria-label',`${returned} of ${run.steps.length} assignments returned`);card.append(progress);
      const steps=node('ol',undefined,'teamsteps');
      for(const step of run.steps){
        const item=node('li',undefined,`teamstep state-${step.state}`),copy=node('div',undefined,'teamstepcopy'),heading=node('div',undefined,'teamstephead');
        heading.append(node('strong',step.name),node('small',LABELS[step.state] || step.state,'teamstate'));copy.append(heading,node('p',step.instruction));
        if(step.state==='working' && step.activity)copy.append(node('small',step.activity,'teamattention'));
        if(step.scopes?.length)copy.append(node('small',`Access: ${step.scopes.map(scope=>scope==='conversation'?'this chat':scope).join(' · ')}`,'teamscopes'));
        if(step.requires_approval && !step.approved_at && run.state==='planned')copy.append(node('small','Pauses for your approval before making changes.','teamattention'));
        if(step.result){appendChatVisual(copy,step.result,step.name);const details=node('details');details.dataset.step=step.id;details.open=expanded.has(step.id);details.append(node('summary',`${step.name}’s result`),node('div',step.result,'teamresult'));if(step.evidence?.status==='verified')details.append(node('small','Required tool evidence recorded.','teamevidence'));else details.append(node('small',step.evidence?.missing?.length?`Still needs evidence: ${step.evidence.missing.join(', ')}`:'Saved AI result · review before relying on it.','teamevidence'));copy.append(details);}
        if(step.error)copy.append(node('p',step.error,'teamerror'));
        if(step.state==='needs_approval'){copy.append(actionButton(`Approve ${step.role==='build'?'build':step.name+'’s assignment'}`,'approve_step',run,step,'teamgold'));}
        if(['blocked','interrupted'].includes(step.state) && run.state==='blocked'){
          if(step.pending_approval)copy.append(button('Review action in Approvals',openApprovals,'teamsecondary'));
          copy.append(node('p','Check partial work before retrying; changes from the previous attempt may already exist.','teamattention'),actionButton('Retry this assignment','retry',run,step,'teamsecondary'));
        }
        item.append(avatar(step),copy);steps.append(item);
      }
      card.append(steps);
      const controls=node('div',undefined,'teamcontrols');
      if(run.state==='planned'){controls.append(actionButton('Approve plan & start','start',run,null,'teamgold'),button('Change the plan',async()=>{await act('cancel',run);input.value=run.message;input.focus();},'teamsecondary'));}
      if(!['completed','cancelled','stopping'].includes(run.state))controls.append(actionButton(run.state==='running'?'Stop after this assignment':'Cancel task','cancel',run,null,'teamquiet'));
      if(run.state==='completed')controls.append(button('Give the team a follow-up',()=>mention({handle:'team'}),'teamsecondary'));
      card.append(controls);
      const timeline=node('details',undefined,'teamtimeline');timeline.append(node('summary','Handoffs & activity'));for(const event of run.events.slice(-10))timeline.append(node('p',`${new Date(event.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})} · ${event.message}`));card.append(timeline);
      host.append(card);
    }
  }
  async function refresh(stamp=generation){
    if(!group || document.visibilityState==='hidden' || stamp!==generation || refreshing===stamp)return;refreshing=stamp;
    try{
      const data=await api();if(stamp!==generation)return;
      group={kind:'group',...data.group};roster=teamHandles(group.available_members || group.members);runs=data.runs || [];onGroup(group);
      const next=JSON.stringify(data);if(next!==signature){signature=next;render();}
      const active=runs.find(run=>['queued','running','stopping'].includes(run.state));
      if(active && document.visibilityState!=='hidden')await api('team_advance',{run_id:active.id});
    }catch(error){if(stamp===generation)announce.textContent=error.message;}
    finally{if(refreshing===stamp)refreshing=null;if(group && stamp===generation){clearTimeout(timer);timer=setTimeout(()=>refresh(stamp),3500);}}
  }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden' && group)refresh(generation);});
  return {
    stop,
    open(conversation,chatId=null){stop();group={...conversation,id:chatId || conversation?.id || 'nex-main',kind:conversation?.kind || 'nex'};host=node('div',undefined,'teamboard');host.append(announce);thread.append(host);const stamp=generation;refresh(stamp);},
    handlesMessage(text){return Boolean(group && ((group.kind==='group' && group.include_nex===false) || /(^|\s)@[\p{L}\p{N}_"-]/u.test(text)));},
    async submit(text){
      const stamp=generation;request=request?.text===text?request:{text,id:`team-${crypto.randomUUID()}`};
      try{await api('team_create',{message:text,request_id:request.id});if(stamp!==generation)return;onMessage(text);request=null;input.value='';suggestions.hidden=true;signature='';await refresh(stamp);host?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
      catch(error){if(stamp===generation){input.value=text;announce.textContent=error.message;throw error;}}
    },
  };
}
