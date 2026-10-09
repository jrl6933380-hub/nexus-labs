import historyHandler from '../api/room-history.js';

// Use the authenticated history handler so background saves follow the same
// ownership, idempotency and project allowance rules as interactive saves.
export async function saveTeamProjects(req,threadId,runs,{handler=historyHandler}={}){
  for(const run of runs.filter(item=>item.state==='completed')){
    for(const step of run.steps.filter(item=>item.state==='returned' && item.role==='build')){
      const match=String(step.result || '').match(/```html\s*\n([\s\S]*?)\n```/iu);if(!match || match[1].length>50000)continue;
      const title=match[1].match(/<title[^>]*>([^<]+)<\/title>/iu)?.[1]?.trim() || run.goal || 'New project';
      const response={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
      await handler({...req,method:'POST',body:{action:'save_chat_visual',promotionId:`${run.id}-${step.id}`,html:match[1],label:title,requestMessage:run.message,sourceConversation:{kind:'team',id:threadId,runId:run.id}}},response);
      if(response.code>=400)throw new Error(response.data?.error || 'Project draft could not be saved');
    }
  }
}
