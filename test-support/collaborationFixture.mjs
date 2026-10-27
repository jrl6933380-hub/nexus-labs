import {runScript} from '../lib/store/lua.js';
import {createBoardCollaboration} from '../lib/boardCollaboration.js';
export function collaborationFixture({realWait=false}={}){const records=new Map();let chain=Promise.resolve(),time=1000,onWait=null;
 const primitive=async([verb,key,...a])=>{if(verb==='HGET')return records.get(a[0])??null;if(verb==='HVALS')return [...records.values()];if(verb==='HSET'){records.set(a[0],a[1]);return 1;}throw Error(verb);};
 const command=async parts=>{if(parts[0]!=='EVAL')return primitive(parts);const count=Number(parts[2]),work=chain.then(()=>runScript(parts[1],{keys:parts.slice(3,3+count),argv:parts.slice(3+count),redisCall:primitive}));chain=work.catch(()=>{});return work;};
 const options={command,now:()=>time,...(!realWait?{wait:async ms=>{time+=ms;if(onWait){const hook=onWait;onWait=null;await hook();}}}:{})};
 const store=createBoardCollaboration(options);return {store,command,records,advance:ms=>time+=ms,onWait:fn=>onWait=fn,options};
}
export const credentials=joined=>({session_id:joined.session.id,...joined.membership});
export async function pair(fixture){const a=await fixture.store.join({work_key:'test-pair',goal:'Build and review a small tool.',agent:'chatgpt',client_id:'chatgpt-one'}),b=await fixture.store.join({work_key:'test-pair',agent:'claude',client_id:'claude-one'});return {a,b};}
