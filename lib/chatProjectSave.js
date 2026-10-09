import historyHandler from '../api/room-history.js';
import {chatVisualPromotionId} from '../public/project-identity.js';
import {TeamError} from './teamRuns.js';
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}});
export async function saveChatProject(req,thread,reply,message,{handler=historyHandler}={}){
  const html=String(reply).match(/```html\s*\n([\s\S]*?)\n```/iu)?.[1];if(!html || html.length>50000)return null;
  const res=response();await handler({...req,method:'POST',body:{action:'save_chat_visual',html,promotionId:chatVisualPromotionId(reply,thread),requestMessage:message,sourceConversation:{kind:'chat',id:thread}}},res);
  if(res.code>=400)throw new Error(res.data?.error || 'Project draft could not be saved');return res.data;
}
export async function checkNewVisualCapacity(req,message,{handler=historyHandler}={}){
  // Ordinary research and conversation remain available when the shelf is full.
  if(!/\b(?:build|create|make|design)\b[\s\S]*\b(?:page|website|site|app|dashboard|tool|html|mockup|visual)\b/iu.test(String(message)))return;
  const res=response();await handler({...req,method:'GET',query:{}},res);
  if(res.code>=400)throw new TeamError(res.data?.error || 'Projects could not load',res.code);
  if(res.data?.workbench?.canCreate===false)throw new TeamError('Your Projects limit is reached. Remove a project or edit an existing one in Workbench.',402);
}
