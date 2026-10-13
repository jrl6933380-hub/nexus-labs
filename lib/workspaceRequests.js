import {createHash,randomUUID} from 'node:crypto';
import {teamCommand} from './teamRuns.js';
const key=(user,id)=>`nexus:workspace-requests:v1:${encodeURIComponent(user)}:${id}`;
const stable=value=>value && typeof value==='object' ? Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])) : value;
export function createWorkspaceRequests({command=teamCommand,now=Date.now}={}){
  return async function once(user,id,action,input,task){
    if(typeof id!=='string' || !/^[a-zA-Z0-9_-]{8,120}$/u.test(id))throw Object.assign(new Error('Use a stable request_id of 8–120 letters, digits, underscores or hyphens for each action. Reuse it on retry.'),{status:400,code:'INVALID_REQUEST_ID'});
    const hash=createHash('sha256').update(JSON.stringify({action,input:stable(input)})).digest('hex'),recordKey=key(user,id);
    const pending={hash,state:'pending',at:now()};
    // Retain uncertain writes: a transport error must not blindly duplicate a mutation.
    if(await command(['SET',recordKey,JSON.stringify(pending),'NX'])!=='OK'){
      const old=JSON.parse(await command(['GET',recordKey]) || '{}');
      if(old.hash!==hash)throw Object.assign(new Error('This request_id belongs to a different action.'),{status:409,code:'REQUEST_ID_CONFLICT'});
      if(old.state==='done')return {...old.result,replayed:true};
      throw Object.assign(new Error('This action is pending or its outcome needs checking. Refresh the board before trying a new action.'),{status:409,code:'CHECK_SAVED_STATE'});
    }
    const result=await task();
    await command(['SET',recordKey,JSON.stringify({...pending,state:'done',result,completed_at:now()})]);
    // Audit operations separately from hosted model usage. No customer input/HTML in this log.
    await command(['LPUSH',`nexus:workspace-audit:v1:${encodeURIComponent(user)}`,JSON.stringify({id:randomUUID(),request_id:id,action,at:now()})]).catch(()=>{});
    return result;
  };
}
export const workspaceRequests=createWorkspaceRequests();
