const OPTIONS = Object.freeze({
  responseStyle:['balanced','concise','detailed'],
  accent:['gold','blue','green','violet'],
});
export const CONTROL_DEFAULTS = Object.freeze({responseStyle:'balanced',accent:'gold'});
function scope(owner){
  if(!/^[a-z0-9_-]{3,64}$/u.test(String(owner || '')))throw new Error('A valid owner is required');
  return `nexus:controls:${owner}:v1`;
}
async function redis(parts){
  const url=process.env.KV_REST_API_URL,token=process.env.KV_REST_API_TOKEN;
  if(!url || !token)throw new Error('Controls storage is unavailable');
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(parts)});
  const data=await response.json();if(!response.ok || data.error)throw new Error('Controls storage is unavailable');return data.result;
}
export function validateControls(input){
  if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Choose valid account controls');
  const result={};
  for(const [key,value] of Object.entries(input)){
    if(!OPTIONS[key]?.includes(value))throw new Error('Choose valid account controls');
    result[key]=value;
  }
  return result;
}
const RECORD_USAGE = `
redis.call('HINCRBY',KEYS[1],'turns',1)
redis.call('HINCRBY',KEYS[1],'input',ARGV[1])
redis.call('HINCRBY',KEYS[1],'output',ARGV[2])
redis.call('HINCRBY',KEYS[1],'reported',ARGV[3])
redis.call('HINCRBY',KEYS[1],'elapsed',ARGV[4])
redis.call('EXPIRE',KEYS[1],3456000)
return 1`;
export function createNexusControlsStore({run=redis,now=Date.now}={}){
  return {
    async preferences(owner){
      const pairs=await run(['HGETALL',scope(owner)]),result={...CONTROL_DEFAULTS};
      for(let i=0;Array.isArray(pairs)&&i<pairs.length;i+=2)if(OPTIONS[pairs[i]]?.includes(pairs[i+1]))result[pairs[i]]=pairs[i+1];
      return result;
    },
    async save(owner,input){
      const patch=validateControls(input),pairs=Object.entries(patch).flat();
      if(pairs.length)await run(['HSET',scope(owner),...pairs]);
      return this.preferences(owner);
    },
    async record(owner,usage,elapsedMs){
      const timestamp=now(),day=new Date(timestamp).toISOString().slice(0,10);
      const number=value=>Number.isFinite(value)?Math.max(0,Math.min(Math.round(value),1e9)):0;
      const reported=Number.isFinite(usage?.input_tokens)&&Number.isFinite(usage?.output_tokens);
      await run(['EVAL',RECORD_USAGE,'1',`${scope(owner)}:usage:${day}`,String(number(usage?.input_tokens)),String(number(usage?.output_tokens)),reported?'1':'0',String(number(elapsedMs))]);
    },
    async usage(owner){
      const timestamp=now(),today=new Date(timestamp).toISOString().slice(0,10);
      const days=await Promise.all(Array.from({length:7},async(_,offset)=>{
        const day=new Date(timestamp-offset*86400000).toISOString().slice(0,10);
        const pairs=await run(['HGETALL',`${scope(owner)}:usage:${day}`]),values={};
        for(let i=0;Array.isArray(pairs)&&i<pairs.length;i+=2)values[pairs[i]]=Number(pairs[i+1])||0;
        return {day,turns:values.turns||0,input:values.input||0,output:values.output||0,reported:values.reported||0,elapsedMs:values.elapsed||0};
      }));
      return {today,days,window:'Last 7 UTC days',scope:'Completed Nex and specialist turns since usage tracking was enabled',ownerExempt:true,updatedAt:timestamp};
    },
  };
}
export function replyPreference(preferences){
  const instruction=({concise:'Keep replies concise while including the result, essential evidence, and any decision needed.',detailed:'Explain results in detail with useful reasoning and evidence.',balanced:'Use clear, balanced replies with enough detail to act on.'})[preferences?.responseStyle];
  return instruction ? `Saved reply preference (use unless the current request asks otherwise): ${instruction}` : '';
}
export const nexusControlsStore=createNexusControlsStore();
