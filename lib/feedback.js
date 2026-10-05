import {randomUUID} from 'node:crypto';

async function redis(command){
  const url=process.env.KV_REST_API_URL,token=process.env.KV_REST_API_TOKEN;
  if(!url || !token)throw new Error('Feedback storage is unavailable');
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command)});
  const data=await response.json();if(!response.ok || data.error)throw new Error('Feedback storage request failed');return data.result;
}

export function createFeedbackStore({command=redis,now=Date.now,idFactory=randomUUID}={}){
  async function submit(input,user){
    const message=String(input?.message || '').trim();if(message.length<3)throw new Error('Tell us a little more about what happened.');
    const category=['idea','problem','other'].includes(input?.category)?input.category:'other';
    const item={id:idFactory(),category,message:message.slice(0,4000),page:String(input?.page || '').slice(0,500),user,created_at:now()};
    const key=`nexus:feedback:v1:${encodeURIComponent(user)}`;await command(['LPUSH',key,JSON.stringify(item)]);await command(['LTRIM',key,'0','99']);
    return item;
  }
  return {submit};
}

export const feedbackStore=createFeedbackStore();
