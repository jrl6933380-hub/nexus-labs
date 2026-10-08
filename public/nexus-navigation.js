export const SPACE_BUNDLES=Object.freeze([
  {id:'life',name:'Life & Schedule',icon:'✦',tone:'life',description:'Life, your schedule, and reminders together',members:['life','planner','reminders']},
  {id:'workbench',name:'Projects',icon:'◫',tone:'projects',description:'Projects, Story Studio, and ventures together',members:['workbench','story','ventures']},
  {id:'deck',name:'Operations',icon:'⌁',tone:'operations',description:'Command Deck, approvals, and Forge together',members:['deck','approvals','forge']},
]);
export function pinnedBundles(ids=[]){return SPACE_BUNDLES.filter(bundle=>bundle.members.some(id=>ids.includes(id))).map(bundle=>bundle.id);}
export const COMPOSER_DESTINATIONS=Object.freeze([
  {id:'settings',label:'Settings',icon:'settings'},
  {id:'life',label:'Life & Schedule',icon:'life'},
  {id:'workbench',label:'Projects',icon:'projects'},
  {id:'deck',label:'Operations',icon:'operations'},
]);
const ICONS={settings:'<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/><circle cx="12" cy="12" r="3"/>',life:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16m-12 5 3 3 5-5"/>',projects:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-11 0v9"/>',operations:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>'};
export function mountComposerMenu({buttons,navigate}){
  const menu=document.createElement('div');menu.className='composer-popover';menu.id='nexus-composer-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Nexus shortcuts');menu.hidden=true;document.body.append(menu);
  let anchor=null;
  function close(){menu.hidden=true;anchor?.setAttribute('aria-expanded','false');anchor=null;}
  function position(){
    if(!anchor || menu.hidden)return;
    const viewport=window.visualViewport,top=viewport?.offsetTop || 0,left=viewport?.offsetLeft || 0,width=viewport?.width || innerWidth;
    const rect=anchor.getBoundingClientRect(),available=Math.max(80,rect.top-top-16),menuWidth=Math.min(300,width-24);
    menu.style.width=`${menuWidth}px`;menu.style.maxHeight=`${Math.min(360,available)}px`;
    menu.style.left=`${Math.max(left+12,Math.min(rect.left,left+width-menuWidth-12))}px`;
    menu.style.top=`${Math.max(top+8,rect.top-menu.offsetHeight-10)}px`;
  }
  for(const action of COMPOSER_DESTINATIONS){
    const item=document.createElement('button');item.type='button';item.setAttribute('role','menuitem');
    const icon=document.createElement('span');icon.className='composer-menu-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[action.icon]}</svg>`;
    const label=document.createElement('span');label.textContent=action.label;item.append(icon,label);item.onclick=()=>{close();navigate(action.id);};menu.append(item);
  }
  for(const button of buttons){
    button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','false');
    button.addEventListener('pointerdown',event=>event.preventDefault());
    button.onclick=()=>{if(anchor===button && !menu.hidden){close();return;}close();anchor=button;menu.hidden=false;button.setAttribute('aria-expanded','true');position();};
    button.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();if(menu.hidden)button.click();menu.firstElementChild.focus();}});
  }
  menu.addEventListener('keydown',event=>{
    const items=[...menu.querySelectorAll('button')],index=items.indexOf(document.activeElement);
    if(event.key==='Escape'){event.preventDefault();const previous=anchor;close();previous?.focus();}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();}
  });
  document.addEventListener('pointerdown',event=>{if(!menu.hidden && !menu.contains(event.target) && !buttons.some(button=>button.contains(event.target)))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && !menu.hidden){const previous=anchor;close();previous?.focus();}});
  window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);window.addEventListener('resize',position);
  return {close};
}
