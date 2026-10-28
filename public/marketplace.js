
const $=id=>document.getElementById(id);
// The actors come from the server catalog (lib/actorCatalog.js).
let ACTORS=[];
function store(k,v){try{localStorage.setItem(k,v);}catch{}}
function load(k){try{return localStorage.getItem(k);}catch{return null;}}
let key=NexusWallet.current();
NexusWallet.controls(key);
$('wallet-details').open=false;
function el(t,txt,cls){const e=document.createElement(t);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e;}
const categories={research:'Research',price:'Research',adspy:'Research',docs:'Operations',gbp:'Growth',localfinder:'Growth',reviews:'Customers',reviews_intel:'Customers',missed:'Customers',website:'Marketing',offer:'Marketing'};
const categoryOrder=['Research','Marketing','Customers','Operations','Growth','More'];
let selectedCategory='all',query='',catalogReady=false;
const iconPaths={Research:'M9 15a6 6 0 1 1 4.24-1.76L20 20M7 7h4M9 5v4',Marketing:'M4 10h4l10-5v14l-10-5H4zM8 14l2 6',Customers:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-3.87',Operations:'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8',Growth:'M3 17l6-6 4 4 8-10M15 5h6v6',More:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'};
function category(a){return categories[a.id]||'More';}
function actorIcon(group){const root=el('span',null,'actor-symbol');root.setAttribute('aria-hidden','true');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.4');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',iconPaths[group]);svg.append(path);root.append(svg);return root;}
function actorHref(a){const p=a.page||'/actor.html?a='+a.id;return p+(key?(p.includes('?')?'&':'?')+'k='+encodeURIComponent(key):'');}
function drawFilters(){const root=$('filters');root.replaceChildren();for(const label of ['all',...categoryOrder.filter(group=>ACTORS.some(a=>category(a)===group))]){const b=el('button',label==='all'?'All actors':label,'filter'+(selectedCategory===label?' active':''));b.type='button';b.dataset.category=label;b.setAttribute('aria-pressed',String(selectedCategory===label));b.addEventListener('click',()=>{selectedCategory=label;for(const button of root.querySelectorAll('button')){const active=button===b;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}drawCards();});root.append(b);}}
function drawCards(){
 $('sample-link').href='/research.html?sample=1'+(key?'&k='+encodeURIComponent(key):'');
 if(!catalogReady)return;
 const g=$('grid');g.replaceChildren();
 const visible=ACTORS.filter(a=>(selectedCategory==='all'||category(a)===selectedCategory)&&[a.name,a.blurb,a.tagline,category(a)].join(' ').toLowerCase().includes(query));
 for(const a of visible){const group=category(a),c=el('article',null,'card'),top=el('div',null,'card-top');top.append(actorIcon(group),el('span',a.beta?'Beta':'Available','tag'+(a.beta?' beta':'')));c.append(top,el('p',group,'card-category'),el('h3',a.name),el('p',a.blurb,'card-description'));
  const footer=el('div',null,'card-footer'),price=el('span',null,'price');price.append(el('strong',a.cost),' credits / run');const b=el('a',null,'btn');b.href=actorHref(a);b.append(document.createTextNode('Open '));const arrow=el('span','↗');arrow.setAttribute('aria-hidden','true');b.append(arrow);footer.append(price,b);c.append(footer);g.append(c);}
 g.setAttribute('aria-busy','false');$('empty-state').hidden=visible.length!==0;$('result-count').textContent=visible.length+' actor'+(visible.length===1?'':'s')+(visible.length!==ACTORS.length?' of '+ACTORS.length:'');
 $('sample-link').href='/research.html?sample=1'+(key?'&k='+encodeURIComponent(key):'');
}
function resetFilters(){selectedCategory='all';query='';$('actor-search').value='';drawFilters();drawCards();}
$('actor-search').addEventListener('input',e=>{query=e.target.value.trim().toLowerCase();drawCards();});$('reset-filters').addEventListener('click',resetFilters);
async function loadCatalog(){
 $('catalog-error').hidden=true;$('empty-state').hidden=true;$('grid').setAttribute('aria-busy','true');$('result-count').textContent='Loading actors…';$('retry-catalog').disabled=true;
 try{const data=await api('catalog');ACTORS=data.actors;catalogReady=true;drawFilters();drawCards();}
 catch{$('grid').replaceChildren();$('grid').setAttribute('aria-busy','false');$('catalog-error').hidden=false;$('result-count').textContent='Catalog unavailable';}
 finally{$('retry-catalog').disabled=false;}
}
$('retry-catalog').addEventListener('click',loadCatalog);
async function api(action,extra){
  const r=await fetch('/api/actor-credits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});
  let d=null;try{d=await r.json();}catch{}
  if(!r.ok){const e=new Error((d&&d.error)||'Could not reach the server.');e.status=r.status;throw e;}
  return d.data;
}
function showBalance(n){
  NexusWallet.remember(key);NexusWallet.controls(key);
  $('bal').textContent=n+' credit'+(n===1?'':'s');
  $('wnote').textContent='Add more any time. The same wallet works on every actor.';
  $('wallet-details').querySelector('summary').textContent='Your private wallet link';
}
document.querySelectorAll('#wallet [data-pack]').forEach(b=>b.addEventListener('click',async()=>{
  b.disabled=true;$('msg').textContent='Opening checkout...';
  try{const d=await api('checkout',{pack:b.dataset.pack,from:'market',...(key?{key}:{})});location.href=d.url;}
  catch(e){$('msg').textContent=e.message;b.disabled=false;}
}));
async function init(){
  await loadCatalog();
  const sid=new URLSearchParams(location.search).get('session_id');
  if(sid){
    $('msg').textContent='Confirming your payment...';
    try{
      const d=await api('claim',{session_id:sid});
      if(d.path){key=new URL(d.path,location.origin).searchParams.get('k')||'';store('wallet',d.path);}
      else if(key)store('wallet','/research.html?k='+key);
      showBalance(d.credits);$('msg').textContent='';
      history.replaceState(null,'',location.pathname+(key?'?k='+encodeURIComponent(key):''));
      drawCards();return;
    }catch(e){$('msg').textContent=e.message;}
  }
  if(key){
    try{const d=await api('balance',{key});store('wallet','/research.html?k='+key);showBalance(d.credits);}
    catch(e){$('msg').textContent=e.message+' Your saved wallet link has been kept. Please retry.';}
    drawCards();
  }
}
init();
