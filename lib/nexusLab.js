import crypto from 'node:crypto';
import {getStore} from './store/index.js';
import {createEmbeddingIndex} from './nexusLabEmbeddings.js';
import {canonical,dictionaryLink,STOPWORDS} from './nexusLabSynonyms.js';

export const LAB_CAPABILITIES = Object.freeze([
  {id:'understand',name:'Understand',kind:'Multimodal',description:'Inspect images, audio, and clips together.',requires:'A verified multimodal model and media input adapter.'},
  {id:'search',name:'Search',kind:'Embeddings',description:'Find reusable tools, skills, and Vault references.',requires:'Voyage credentials enable semantic search. Keyword search works immediately.'},
  {id:'rank',name:'Rank',kind:'Ranking',description:'Order candidates against a brief.',requires:'Rules-based matching with built-in synonyms is available. A learned reranker is a separate connection.'},
  {id:'detect',name:'Detect',kind:'Object detection',description:'Locate objects and inspect their bounding boxes.',requires:'A detector with verified labels and bounding-box output.'},
  {id:'cutout',name:'Cutout',kind:'Segmentation',description:'Select subjects and export editable masks.',requires:'A segmentation worker, mask storage, and an edge editor.'},
  {id:'predict',name:'Predict',kind:'Prediction',description:'Fit a small trend baseline to your numeric observations.',requires:'At least six ordered observations. This baseline cannot establish causation or ad success.'},
  {id:'video',name:'Video',kind:'Video generation',description:'Generate new footage and hand it to Ads Studio.',requires:'A video provider, durable job polling, and output storage. Ads Studio already handles composition.'},
]);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const tokens=value=>[...new Set(String(value).toLowerCase().match(/[\p{L}\p{N}_]+/gu)||[])];
export function rankCandidates(query,documents,{synonyms=false}={}){
  let terms=tokens(query);if(!terms.length)throw fail('Enter a brief or search phrase.');
  if(synonyms){const kept=terms.filter(term=>!STOPWORDS.has(term));if(kept.length)terms=kept;}
  return documents.map((item,index)=>{
    const content=tokens(`${item.name} ${item.text}`);
    if(!synonyms){const matched=terms.filter(term=>content.includes(term));return {...item,score:matched.length/terms.length,matched,index};}
    const byMeaning=new Map();for(const word of content){const key=canonical(word);if(!byMeaning.has(key))byMeaning.set(key,word);}
    const matched=[],alsoMeans=[];let points=0,strong=0;
    for(const term of terms){
      if(content.includes(term)){matched.push(term);points+=1;strong+=1;continue;}
      const word=byMeaning.get(canonical(term));
      if(word){matched.push(term);alsoMeans.push({term,word});points+=0.8;strong+=1;continue;}
      let best=null,bestWord=null;
      for(const other of byMeaning.values()){const link=dictionaryLink(term,other);if(link==='close'){best=link;bestWord=other;break;}if(link&&!best){best=link;bestWord=other;}}
      if(best){matched.push(term);alsoMeans.push({term,word:bestWord,by:'dictionary'});points+=best==='close'?0.7:0.4;}
    }
    return {...item,score:points/terms.length,matched,synonyms:alsoMeans,strong,index};
  }).sort((a,b)=>b.score-a.score||a.index-b.index);
}
export function forecast(values){
  if(!Array.isArray(values)||values.length<6||values.length>200||values.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12))throw fail('Supply 6–200 finite numeric observations in time order.');
  const n=values.length,mean=a=>a.reduce((x,y)=>x+y,0)/a.length,median=a=>{const t=[...a].sort((x,y)=>x-y),m=t.length>>1;return t.length%2?t[m]:(t[m-1]+t[m])/2;};
  const fit=ys=>{const mx=(ys.length-1)/2,my=mean(ys);let top=0,bottom=0;ys.forEach((y,x)=>{top+=(x-mx)*(y-my);bottom+=(x-mx)**2;});const slope=top/bottom;return {slope,intercept:my-slope*mx};};
  // Repeating pattern: after removing the straight trend, look for the spacing (2–12 steps) where the leftovers repeat most. Needs two full cycles.
  const seasonOf=(ys,forced)=>{const f=fit(ys),res=ys.map((y,x)=>y-(f.intercept+f.slope*x)),m=mean(res),den=res.reduce((t,r)=>t+(r-m)**2,0);if(!den)return null;let best=forced&&ys.length>=forced+2?{period:forced,strength:0}:null;if(!forced)for(let p=2;p<=12&&ys.length>=2*p+1;p++){let num=0;for(let i=p;i<res.length;i++)num+=(res[i]-m)*(res[i-p]-m);const r=num/den;if(r>=0.5&&(!best||r>best.strength+0.05))best={period:p,strength:r};}
    if(!best)return null;const sums=Array(best.period).fill(0),counts=Array(best.period).fill(0);res.forEach((r,i)=>{sums[i%best.period]+=r;counts[i%best.period]+=1;});return {...best,offsets:sums.map((t,i)=>t/counts[i])};};
  const split=Math.floor(n*0.75),train=values.slice(0,split),held=values.slice(split);
  const make=(ys,forcedPeriod)=>{const f=fit(ys),season=seasonOf(ys,forcedPeriod),last=ys.at(-1),lastN=mean(ys.slice(-3));return {
    trend:i=>f.intercept+f.slope*i,
    last:()=>last,
    recent:()=>lastN,
    ...(season?(()=>{// refit the trend on numbers with the repeating pattern removed, then re-measure the pattern
      let off=season.offsets,g=f;for(let pass=0;pass<3;pass++){g=fit(ys.map((y,i)=>y-off[i%season.period]));const sums=Array(season.period).fill(0),cnt=Array(season.period).fill(0);ys.forEach((y,i)=>{sums[i%season.period]+=y-(g.intercept+g.slope*i);cnt[i%season.period]+=1;});off=sums.map((t,i)=>t/cnt[i]);}
      return {seasonal:i=>g.intercept+g.slope*i+off[i%season.period]};})():{})
  };};
  const labels={trend:'straight-line trend',last:'repeat the last value',recent:'average of the last three',seasonal:'trend plus repeating pattern'};
  const season=seasonOf(values),trained=make(train,season?.period),full=make(values);
  const scores=Object.keys(trained).map(name=>({name,mae:mean(held.map((y,k)=>Math.abs(y-trained[name](split+k))))}));
  // Prefer the straight-line trend unless another method beats it by a clear margin.
  const trendScore=scores.find(x=>x.name==='trend');let chosen=trendScore;for(const x of scores)if(x.mae<chosen.mae*0.85-1e-12)chosen=x;
  if(chosen!==trendScore&&Math.abs(trendScore.mae-chosen.mae)<1e-12)chosen=trendScore;
  const naiveMae=scores.find(x=>x.name==='last').mae,next=full[chosen.name](n);
  const fullFit=fit(values),residuals=values.map((y,i)=>y-full[chosen.name](i));
  const sd=Math.sqrt(residuals.reduce((t,r)=>t+r*r,0)/Math.max(1,n-2)),spread=Math.max(sd,chosen.mae*1.25);
  // Warnings in plain words.
  const flags=[];const med=median(values),mad=median(values.map(v=>Math.abs(v-med)));
  const outliers=mad>0?values.map((v,i)=>({i,v})).filter(o=>Math.abs(o.v-med)/(1.4826*mad)>3.5):[];
  if(outliers.length)flags.push({code:'outliers',message:`${outliers.length} value${outliers.length>1?'s look':' looks'} far from the rest (position${outliers.length>1?'s':''} ${outliers.slice(0,5).map(o=>o.i+1).join(', ')}). One-off spikes can pull the estimate off.`,positions:outliers.map(o=>o.i+1)});
  if(Math.max(...values)===Math.min(...values))flags.push({code:'flat',message:'Every value is the same, so the estimate is just that value.'});
  if(chosen.mae>naiveMae*1.0001)flags.push({code:'no_better_than_last_value',message:'The model did not beat simply repeating the last value on the held-back numbers. Treat the estimate as weak.'});
  const level=Math.abs(mean(values));if(level>0&&spread/level>0.5)flags.push({code:'noisy',message:'The numbers swing a lot compared with their size, so the range is wide.'});
  if(n<12)flags.push({code:'short_history',message:'Fewer than 12 observations: trends and patterns are easy to misread.'});
  const confidence=flags.some(f=>['no_better_than_last_value','noisy'].includes(f.code))?'low':(n>=24&&!flags.some(f=>f.code==='outliers'))?'high':'medium';
  return {method:'linear-trend-baseline',chosen:chosen.name,chosenLabel:labels[chosen.name],candidates:scores.map(x=>({name:x.name,label:labels[x.name],mae:x.mae})),observations:n,holdout:held.length,mae:chosen.mae,naiveMae,next,slope:fullFit.slope,range:{low:next-1.96*spread,high:next+1.96*spread,note:'Rough range from how far past values sat from the fitted line. It is not a calibrated prediction interval.'},seasonality:season?{period:season.period,strength:Number(season.strength.toFixed(2))}:null,confidence,flags,values,warning:'Assumes equally spaced observations. Holdout errors are measured on the final observations; the range is rough and no causal or ad-success claim is made.'};
}
export function cosine(a,b){if(!Array.isArray(a)||!Array.isArray(b)||!a.length||a.length!==b.length||[...a,...b].some(v=>!Number.isFinite(v)))throw fail('The embedding provider returned invalid vectors.',502);const dot=a.reduce((s,v,i)=>s+v*b[i],0),norm=Math.hypot(...a)*Math.hypot(...b);return norm?dot/norm:0;}
export async function voyageEmbed(texts,type,{env=process.env,fetcher=fetch,signal}={}){
  if(!env.VOYAGE_API_KEY)throw fail('Semantic search needs the Voyage connection. Keyword search remains available.',409);
  const response=await fetcher('https://api.voyageai.com/v1/embeddings',{method:'POST',headers:{Authorization:`Bearer ${env.VOYAGE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({input:texts,model:env.VOYAGE_EMBED_MODEL||'voyage-3.5-lite',input_type:type}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});
  if(!response.ok)throw fail('The embedding connection failed. Try again or use keyword search.',502);
  const data=await response.json();if(!Array.isArray(data.data)||data.data.length!==texts.length)throw fail('The embedding provider returned an incomplete response.',502);
  const ordered=[...data.data].sort((a,b)=>a.index-b.index);if(ordered.some((v,i)=>v.index!==i))throw fail('The embedding provider returned invalid indexes.',502);
  return ordered.map(item=>item.embedding);
}
function documents(input){if(!Array.isArray(input)||!input.length||input.length>60)throw fail('Supply 1–60 candidates.');return input.map((value,i)=>{if(typeof value!=='string'||!value.trim()||value.length>2000)throw fail('Each candidate must contain 1–2,000 characters.');return {id:String(i),name:`Candidate ${i+1}`,text:value.trim(),source:'Your input'};});}
export function createNexusLab({command=async args=>{const store=getStore();if(!store)throw fail('Lab storage is unavailable.',503);return store.command(args);},catalog=async()=>[],env=process.env,embed=voyageEmbed,now=()=>Date.now(),newId=()=>crypto.randomUUID(),assets=null,understand=null,video=null}={}){
  const key=owner=>{if(!owner?.id)throw fail('Owner authentication required.',401);return `nexus:lab:${encodeURIComponent(owner.id)}:runs:v1`;};
  async function list(owner){const seen=new Set(),runs=(await command(['LRANGE',key(owner),'0','39'])||[]).map(raw=>JSON.parse(raw)).filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;});if(!assets||!runs.length)return runs;const links=await assets.runLinks(owner,runs.map(r=>r.id));return runs.map(run=>({...run,assets:links[run.id]||{input:[],output:[]}}));}
  const idx=createEmbeddingIndex({command,embed,env,now});
  async function persist(owner,run){await command(['LPUSH',key(owner),JSON.stringify(run)]);await command(['LTRIM',key(owner),'0','39']);}
  return {
    async readRun(owner,id){const run=(await list(owner)).find(r=>r.id===id);if(!run)throw fail('Lab run not found.',404);return run;},
    async overview(owner){return {capabilities:LAB_CAPABILITIES.map(c=>({...c,status:['search','rank','predict'].includes(c.id)?'ready':'needs_connection',mode:c.id==='search'?(env.VOYAGE_API_KEY?'semantic_available':'keyword'):c.id==='rank'?'rules':c.id==='predict'?'linear_baseline':null})),runs:await list(owner)};},
    async cancelMediaJob(owner,job){key(owner);return job.label==='video'&&video?video.cancel(owner,job):null;},
    async indexStatus(owner){key(owner);return {index:await idx.status(owner,(await catalog(owner)).slice(0,300))};},
    async indexBuild(owner,options={}){key(owner);return {index:await idx.build(owner,(await catalog(owner)).slice(0,300),{signal:options.signal})};},
    async run(owner,input={},options={}){
      key(owner);const cap=LAB_CAPABILITIES.find(c=>c.id===input.capability);if(!cap)throw fail('Choose a Lab capability.');
      if(!['search','rank','predict','understand','video'].includes(cap.id))throw fail(cap.requires,409);
      if(cap.id==='understand'&&!understand)throw fail(cap.requires,409);
      if(cap.id==='video'&&!video)throw fail(cap.requires,409);
      if(options.runId){const previous=(await list(owner)).find(r=>r.id===options.runId&&r.status==='succeeded');if(previous)return previous;}
      const started=now(),id=options.runId||newId();let output,engine,mediaRun=null;
      try{
        if(cap.id==='understand'){mediaRun=await understand.execute(owner,input,options);output=mediaRun.output;engine=mediaRun.engine;}
        else if(cap.id==='video'){mediaRun=await video.execute(owner,input,options);if(mediaRun.pending)return mediaRun;output=mediaRun.output;engine=mediaRun.engine;}
        else if(cap.id==='predict'){output=forecast(input.values);engine=output.method;}
        else {
          const query=String(input.query||'').trim();if(!query||query.length>500)throw fail('Enter a brief of 1–500 characters.');
          const docs=cap.id==='rank'?documents(input.candidates):(await catalog(owner)).slice(0,300);
          if(cap.id==='search'&&input.mode==='indexed'){
            const r=await idx.query(owner,docs,query,{signal:options.signal});
            output={query,results:r.results,note:`Similarity over ${r.indexed} stored embeddings${r.behind?`; ${r.behind} catalog items are not indexed yet — rebuild the index to include them`:''}. Scores measure similarity, not correctness.`};engine=r.model;
          }else if(cap.id==='search'&&input.mode==='semantic'){
            if(!env.VOYAGE_API_KEY)throw fail('Semantic search needs the Voyage connection. Use keyword search for now.',409);
            const subset=rankCandidates(query,docs,{synonyms:true}).slice(0,60);if(!subset.length)throw fail('There are no indexed items to search.',409);
            const q=await embed([query],'query',{env,signal:options.signal});const vectors=await embed(subset.map(d=>`${d.name}\n${d.text}`),'document',{env,signal:options.signal});
            output={query,results:subset.map((d,i)=>({...d,score:cosine(q[0],vectors[i])})).sort((a,b)=>b.score-a.score).slice(0,12),note:'Semantic comparison of up to 60 keyword-shortlisted catalog entries. Scores measure similarity, not correctness.'};engine=env.VOYAGE_EMBED_MODEL||'voyage-3.5-lite';
          }else{
            const scored=rankCandidates(query,docs,{synonyms:true});
            // Search hides weak dictionary-only hits: keep an item if at least one brief word matched exactly, by stem or by a built-in synonym, or if it scores 0.3 or more.
            const results=cap.id==='rank'?scored:scored.filter(d=>d.score>0&&(d.strong>0||d.score>=0.3));
            output={query,results:results.slice(0,12),note:cap.id==='rank'?'Rules-based coverage of the brief. Exact words score 1; words with the same stem or a built-in synonym score 0.8, close dictionary matches 0.7 and looser related words 0.4. Ties preserve input order; scores are not probabilities.':'Keyword matching of installed tools, skills, and Vault metadata, with synonyms and word endings understood (exact 1, synonym 0.8, close dictionary 0.7, related 0.4; weak dictionary-only hits are hidden). Repository source is not indexed.'};engine='token-coverage-dictionary-v1';}
        }
        const run={id,capability:cap.id,status:'succeeded',createdAt:new Date(started).toISOString(),durationMs:now()-started,engine,...(mediaRun?{provider:mediaRun.provider}:{}),costUsd:mediaRun?.costUsd??null,input:mediaRun?mediaRun.input:cap.id==='predict'?{values:input.values}:{query:String(input.query),...(cap.id==='rank'?{candidates:input.candidates}:{}),mode:input.mode||'keyword'},output};if(mediaRun&&assets)await assets.attach(owner,{run_id:id,input_asset_ids:mediaRun.input_asset_ids,output_asset_ids:mediaRun.output_asset_ids});await persist(owner,run);return run;
      }catch(error){if(error.status&&error.status<500)throw error;const run={id,capability:cap.id,status:'failed',createdAt:new Date(started).toISOString(),durationMs:now()-started,error:'Run failed. Try again after checking the connection.',engine:engine||null,costUsd:null};await persist(owner,run);throw Object.assign(fail(run.error,502),error.code==='PROVIDER_FAILED'?{code:'PROVIDER_FAILED'}:{});}
    }
  };
}
