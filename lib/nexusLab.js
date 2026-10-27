import crypto from 'node:crypto';
import {getStore} from './store/index.js';

export const LAB_CAPABILITIES = Object.freeze([
  {id:'understand',name:'Understand',kind:'Multimodal',description:'Inspect images, audio, and clips together.',requires:'A verified multimodal model and media input adapter.'},
  {id:'search',name:'Search',kind:'Embeddings',description:'Find reusable tools, skills, and Vault references.',requires:'Voyage credentials enable semantic search. Keyword search works immediately.'},
  {id:'rank',name:'Rank',kind:'Ranking',description:'Order candidates against a brief.',requires:'Rules-based matching is available. A learned reranker is a separate connection.'},
  {id:'detect',name:'Detect',kind:'Object detection',description:'Locate objects and inspect their bounding boxes.',requires:'A detector with verified labels and bounding-box output.'},
  {id:'cutout',name:'Cutout',kind:'Segmentation',description:'Select subjects and export editable masks.',requires:'A segmentation worker, mask storage, and an edge editor.'},
  {id:'predict',name:'Predict',kind:'Prediction',description:'Fit a small trend baseline to your numeric observations.',requires:'At least six ordered observations. This baseline cannot establish causation or ad success.'},
  {id:'video',name:'Video',kind:'Video generation',description:'Generate new footage and hand it to Ads Studio.',requires:'A video provider, durable job polling, and output storage. Ads Studio already handles composition.'},
]);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const tokens=value=>[...new Set(String(value).toLowerCase().match(/[\p{L}\p{N}_]+/gu)||[])];
export function rankCandidates(query,documents){
  const terms=tokens(query);if(!terms.length)throw fail('Enter a brief or search phrase.');
  return documents.map((item,index)=>{const content=tokens(`${item.name} ${item.text}`),matched=terms.filter(term=>content.includes(term));return {...item,score:matched.length/terms.length,matched,index};}).sort((a,b)=>b.score-a.score||a.index-b.index);
}
export function forecast(values){
  if(!Array.isArray(values)||values.length<6||values.length>200||values.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12))throw fail('Supply 6–200 finite numeric observations in time order.');
  const fit=ys=>{const mx=(ys.length-1)/2,my=ys.reduce((a,b)=>a+b,0)/ys.length;let top=0,bottom=0;ys.forEach((y,x)=>{top+=(x-mx)*(y-my);bottom+=(x-mx)**2;});const slope=top/bottom;return {slope,intercept:my-slope*mx};};
  const split=Math.floor(values.length*0.75),train=values.slice(0,split),held=values.slice(split),model=fit(train),errors=held.map((y,i)=>Math.abs(y-(model.intercept+model.slope*(split+i)))),naive=held.map(y=>Math.abs(y-train.at(-1))),full=fit(values);
  return {method:'linear-trend-baseline',observations:values.length,holdout:held.length,mae:errors.reduce((a,b)=>a+b,0)/held.length,naiveMae:naive.reduce((a,b)=>a+b,0)/held.length,next:full.intercept+full.slope*values.length,slope:full.slope,values,warning:'Assumes equally spaced observations and a continuing linear trend. Holdout errors are measured on the final observations; no calibrated prediction interval is available.'};
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
export function createNexusLab({command=async args=>{const store=getStore();if(!store)throw fail('Lab storage is unavailable.',503);return store.command(args);},catalog=async()=>[],env=process.env,embed=voyageEmbed,now=()=>Date.now(),newId=()=>crypto.randomUUID(),assets=null,understand=null}={}){
  const key=owner=>{if(!owner?.id)throw fail('Owner authentication required.',401);return `nexus:lab:${encodeURIComponent(owner.id)}:runs:v1`;};
  async function list(owner){const seen=new Set(),runs=(await command(['LRANGE',key(owner),'0','39'])||[]).map(raw=>JSON.parse(raw)).filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;});if(!assets||!runs.length)return runs;const links=await assets.runLinks(owner,runs.map(r=>r.id));return runs.map(run=>({...run,assets:links[run.id]||{input:[],output:[]}}));}
  async function persist(owner,run){await command(['LPUSH',key(owner),JSON.stringify(run)]);await command(['LTRIM',key(owner),'0','39']);}
  return {
    async readRun(owner,id){const run=(await list(owner)).find(r=>r.id===id);if(!run)throw fail('Lab run not found.',404);return run;},
    async overview(owner){return {capabilities:LAB_CAPABILITIES.map(c=>({...c,status:['search','rank','predict'].includes(c.id)?'ready':'needs_connection',mode:c.id==='search'?(env.VOYAGE_API_KEY?'semantic_available':'keyword'):c.id==='rank'?'rules':c.id==='predict'?'linear_baseline':null})),runs:await list(owner)};},
    async run(owner,input={},options={}){
      key(owner);const cap=LAB_CAPABILITIES.find(c=>c.id===input.capability);if(!cap)throw fail('Choose a Lab capability.');
      if(!['search','rank','predict','understand'].includes(cap.id))throw fail(cap.requires,409);
      if(cap.id==='understand'&&!understand)throw fail(cap.requires,409);
      if(options.runId){const previous=(await list(owner)).find(r=>r.id===options.runId&&r.status==='succeeded');if(previous)return previous;}
      const started=now(),id=options.runId||newId();let output,engine,mediaRun=null;
      try{
        if(cap.id==='understand'){mediaRun=await understand.execute(owner,input,options);output=mediaRun.output;engine=mediaRun.engine;}
        else if(cap.id==='predict'){output=forecast(input.values);engine=output.method;}
        else {
          const query=String(input.query||'').trim();if(!query||query.length>500)throw fail('Enter a brief of 1–500 characters.');
          const docs=cap.id==='rank'?documents(input.candidates):(await catalog(owner)).slice(0,300);
          if(cap.id==='search'&&input.mode==='semantic'){
            if(!env.VOYAGE_API_KEY)throw fail('Semantic search needs the Voyage connection. Use keyword search for now.',409);
            const subset=rankCandidates(query,docs).slice(0,60);if(!subset.length)throw fail('There are no indexed items to search.',409);
            const q=await embed([query],'query',{env,signal:options.signal});const vectors=await embed(subset.map(d=>`${d.name}\n${d.text}`),'document',{env,signal:options.signal});
            output={query,results:subset.map((d,i)=>({...d,score:cosine(q[0],vectors[i])})).sort((a,b)=>b.score-a.score).slice(0,12),note:'Semantic comparison of up to 60 keyword-shortlisted catalog entries. Scores measure similarity, not correctness.'};engine=env.VOYAGE_EMBED_MODEL||'voyage-3.5-lite';
          }else{output={query,results:rankCandidates(query,docs).filter(d=>cap.id==='rank'||d.score>0).slice(0,12),note:cap.id==='rank'?'Rules-based query-token coverage. Ties preserve input order; scores are not probabilities.':'Keyword matching of installed tools, skills, and Vault metadata. Repository source is not indexed.'};engine='token-coverage-v1';}
        }
        const run={id,capability:cap.id,status:'succeeded',createdAt:new Date(started).toISOString(),durationMs:now()-started,engine,...(mediaRun?{provider:mediaRun.provider}:{}),costUsd:mediaRun?.costUsd??null,input:mediaRun?mediaRun.input:cap.id==='predict'?{values:input.values}:{query:String(input.query),...(cap.id==='rank'?{candidates:input.candidates}:{}),mode:input.mode||'keyword'},output};if(mediaRun&&assets)await assets.attach(owner,{run_id:id,input_asset_ids:mediaRun.input_asset_ids,output_asset_ids:mediaRun.output_asset_ids});await persist(owner,run);return run;
      }catch(error){if(error.status&&error.status<500)throw error;const run={id,capability:cap.id,status:'failed',createdAt:new Date(started).toISOString(),durationMs:now()-started,error:'Run failed. Try again after checking the connection.',engine:engine||null,costUsd:null};await persist(owner,run);throw fail(run.error,502);}
    }
  };
}
