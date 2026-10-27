// Price Change Check: link parsing, the saved-baseline key and the before/after comparison.
// The agent only reports what each page shows now. The server compares it with the saved baseline, so the change is computed, never guessed.
import {createHash} from 'node:crypto';
import {z} from 'zod';

export const MAX_URLS=5;
const PRIVATE_HOST=/(^|\.)(localhost|local|internal|lan|home|corp)$/iu;

// Splits free text into clean, de-duplicated web links. Bare domains get https://. Private and odd hosts are dropped.
export function parseUrls(text){
  const out=[];
  for(const part of String(text||'').split(/[\s,]+/u)){
    if(!part)continue;
    let u;try{u=new URL(/^https?:\/\//iu.test(part)?part:'https://'+part);}catch{continue;}
    if(u.protocol!=='https:'&&u.protocol!=='http:')continue;
    if(u.username||u.password)continue;
    const h=u.hostname.toLowerCase();
    if(!h.includes('.')||PRIVATE_HOST.test(h)||/^\d+\.\d+\.\d+\.\d+$/u.test(h)||h.includes(':')||h.startsWith('['))continue;
    u.hash='';
    const s=u.toString();
    if(s.length>300)continue;
    if(!out.includes(s))out.push(s);
  }
  return out;
}

export const baselineField=(linkId,url)=>String(linkId)+':'+createHash('sha256').update(String(url)).digest('hex').slice(0,16);

const itemSchema=z.object({
  url:z.string().max(400),
  status:z.enum(['ok','blocked','not_found','no_price']),
  product:z.string().max(160).nullish(),
  price:z.number().min(0).max(10000000).nullish(),
  currency:z.string().regex(/^[A-Z]{3}$/u).nullish(),
  available:z.enum(['in_stock','out_of_stock','unknown']).nullish(),
  evidence:z.string().max(400).nullish(),
});

const cut=(s,n)=>String(s||'').replace(/\s+/gu,' ').trim().slice(0,n);
const money=(p,c)=>(Math.round(p*100)/100).toFixed(2)+' '+c;
const STOCK={in_stock:'In stock',out_of_stock:'Out of stock',unknown:'Not shown'};
const WHY={blocked:'The page blocked the check or needs a sign-in',not_found:'The page was not found',no_price:'No price is shown on the page'};
const host=u=>{try{return new URL(u).hostname.replace(/^www\./u,'');}catch{return u;}};

export function compare(prev,cur){
  if(!prev)return {kind:'first',text:'First check. Saved as your baseline'};
  if(prev.currency!==cur.currency)return {kind:'currency',text:'Currency changed from '+prev.currency+' to '+cur.currency};
  const d=Math.round((cur.price-prev.price)*100)/100,bits=[];
  if(d>0)bits.push('Up '+d.toFixed(2)+(prev.price>0?' (+'+(d/prev.price*100).toFixed(1)+'%)':''));
  else if(d<0)bits.push('Down '+Math.abs(d).toFixed(2)+(prev.price>0?' (-'+(Math.abs(d)/prev.price*100).toFixed(1)+'%)':''));
  const a=prev.available,b=cur.available;
  if(a&&b&&a!==b&&a!=='unknown'&&b!=='unknown')bits.push(b==='in_stock'?'Back in stock':'Now out of stock');
  return bits.length?{kind:'changed',text:bits.join('. ')}:{kind:'same',text:'No change'};
}

// urls: the links the customer submitted (already normalised). items: what the agent reported. baselines: Map url -> saved record.
// Returns {result (for genericResultSchema), updates ([{url,rec}] to save as the new baselines), checked, changed}.
export function buildPriceResult({urls,items,baselines,at}){
  const day=new Date(at).toISOString().slice(0,10);
  const byUrl=new Map();
  for(const raw of Array.isArray(items)?items.slice(0,20):[]){
    const p=itemSchema.safeParse(raw);if(!p.success)continue;
    const u=parseUrls(p.data.url)[0];if(!u||!urls.includes(u)||byUrl.has(u))continue;
    byUrl.set(u,p.data);
  }
  const rows=[],changes=[],missed=[],proof=[],sources=[],updates=[];
  let checked=0,changed=0,firsts=0;
  for(const url of urls){
    const it=byUrl.get(url),prev=baselines&&baselines.get(url)||null;
    const ok=it&&it.status==='ok'&&typeof it.price==='number'&&it.currency;
    const name=cut(it&&it.product,120)||host(url);
    if(!ok){
      const why=it?(WHY[it.status]||'No price could be read'):'No answer came back for this link';
      rows.push([name,prev?money(prev.price,prev.currency):'-','Not checked',why,'-',day,'',url]);
      missed.push(url+': '+why+(prev?'. Your saved price is unchanged.':'.'));
      continue;
    }
    checked++;
    const cur={price:it.price,currency:it.currency,available:it.available||'unknown'};
    const c=compare(prev,cur);
    if(c.kind==='first')firsts++;else if(c.kind!=='same')changed++;
    const ev=cut(it.evidence,200);
    rows.push([name,prev?money(prev.price,prev.currency):'-',money(cur.price,cur.currency),c.text,STOCK[cur.available],day,ev,url]);
    if(c.kind!=='same'&&c.kind!=='first')changes.push(name+': '+c.text+' (was '+money(prev.price,prev.currency)+', now '+money(cur.price,cur.currency)+')');
    if(ev)proof.push(name+': "'+ev+'" ('+url+')');
    sources.push({title:name.slice(0,120),url});
    updates.push({url,rec:{url,price:cur.price,currency:cur.currency,available:cur.available,seen_at:at,product:name}});
  }
  let summary;
  if(!checked)summary='No prices could be read.';
  else if(firsts===checked)summary='Saved the current price of '+checked+(checked===1?' product':' products')+'. Run this again later to see what changed.';
  else{
    const compared=checked-firsts;
    summary=changed?changed+' of '+compared+(compared===1?' saved price':' saved prices')+' changed. '+changes[0]+'.':'No changes in '+compared+(compared===1?' saved price':' saved prices')+'.';
    if(firsts)summary+=' '+firsts+' new '+(firsts===1?'baseline':'baselines')+' saved.';
  }
  const sections=[{title:'What changed',items:changes.length?changes:(firsts===checked&&checked?['Nothing to compare yet. Today\'s prices are saved as your baseline.']:['No price or stock changes since the last check.'])}];
  if(missed.length)sections.push({title:'Could not check',items:missed});
  if(proof.length)sections.push({title:'What the pages said',items:proof});
  return {
    checked,changed,updates,
    result:{
      summary:summary.slice(0,1200),
      sections,
      tables:[{name:'Prices',columns:['Product','Before','Now','Change','Stock','Checked','Evidence','Page'],rows}],
      notes:'Prices are what each page showed when it was checked. Tax, shipping, store location and signed-in or member prices can differ from what you see.',
      sources:sources.slice(0,15),
    },
  };
}
