import {createWorkspaceOAuthProvider} from '../../lib/workspaceOAuth.js';
export function oauthFixture(){let stamp=Date.now();const data=new Map(),expiry=new Map();const command=async([op,...args])=>{
 const get=k=>expiry.has(k)&&expiry.get(k)<=stamp?null:data.get(k)||null;
 if(op==='GET')return get(args[0]);
 if(op==='SET'){const [k,v,,ttl]=args;data.set(k,v);if(ttl)expiry.set(k,stamp+Number(ttl)*1000);return 'OK';}
 if(op==='EVAL'){const [script,count,k,expected,next,ttl]=args;if(count!==1)throw new Error('Unexpected script');if(get(k)!==expected)return 0;if(script.includes("'DEL'")){data.delete(k);return 1;}data.set(k,next);expiry.set(k,stamp+Number(ttl)*1000);return 1;}
 throw new Error('Unknown OAuth storage command '+op);
 };return {provider:createWorkspaceOAuthProvider({command,now:()=>stamp,env:{NEXUS_OWNER_ID:'justin'}}),data,advance:ms=>stamp+=ms};
}
