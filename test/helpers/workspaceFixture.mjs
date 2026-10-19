import {createWorkspaceService,resolveWorkspaceAccount} from '../../lib/workspaceConnector.js';
import {createWorkspaceConnectorHandler} from '../../api/workspace-connector.js';
import {createWorkspaceRequests} from '../../lib/workspaceRequests.js';
import {createPlannerStore} from '../../lib/planner.js';
import {createReminderStore} from '../../lib/reminders.js';
import {executeWorkbenchTool} from '../../lib/workbenchTools.js';
import {createHistoryHandler} from '../../api/room-history.js';
import {createBoardKitStore} from '../../lib/boardKits.js';
function memory(){const strings=new Map(),hashes=new Map();return async([op,key,...args])=>{
  if(op==='GET')return strings.get(key) ?? null;
  if(op==='SET'){if(args.includes('NX') && strings.has(key))return null;strings.set(key,args[0]);return 'OK';}
  if(op==='HGET')return hashes.get(key)?.get(args[0]) ?? null;
  if(op==='HGETALL')return [...(hashes.get(key) || new Map())].flat();
  if(op==='HVALS')return [...(hashes.get(key) || new Map()).values()];
  if(op==='EVAL' && key.includes('board-kit-cas-v1')){const [,hashKey,boardId,previous,value]=args;const hash=hashes.get(hashKey) || new Map();if((hash.get(boardId) || '')!==previous)return 0;if(!previous && hash.size>=25)return -1;hash.set(boardId,value);hashes.set(hashKey,hash);return 1;}
  if(op==='HSET'){const hash=hashes.get(key)||new Map();for(let i=0;i<args.length;i+=2)hash.set(args[i],args[i+1]);hashes.set(key,hash);return 1;}
  if(op==='HDEL')return Number(hashes.get(key)?.delete(args[0]));
  if(op==='LPUSH')return 1;
  throw new Error('Unexpected command '+op);
};}
export function workspaceFixture({formHtml='<html><title>FORM Bodyweight</title><body>working timer</body></html>'}={}){const command=memory();let next=0;const schedule=createPlannerStore({command,now:()=>Date.parse('2026-10-13T06:00:00Z'),idFactory:()=>`event-${++next}`});const reminders=createReminderStore({command,planner:schedule,idFactory:()=>`reminder-${++next}`});const builds=new Map();let saveCount=0;
  const userBuilds=user=>builds.get(user) || [];
  const readLatest=async(user,id)=>userBuilds(user).find(build=>build.projectId===id);
  const historyFactory=opts=>createHistoryHandler({...opts,readBuild:async(user,id)=>userBuilds(user).find(b=>b.id===id),readLatestProject:readLatest,readList:async user=>userBuilds(user),readProjects:async user=>[...new Map(userBuilds(user).slice().reverse().map(b=>[b.projectId,{projectId:b.projectId,label:b.projectMainLabel || b.label,latestBuildId:b.id}])).values()],readLiveSites:async()=>[],rename:async(user,id,name)=>{const build=await readLatest(user,id);if(!build)throw new Error('Project not found');build.projectMainLabel=name;return {projectId:id,name};},resolvePlan:async()=> 'free',writeBuild:async(user,input)=>{saveCount++;const current=await readLatest(user,input.projectId);const build={...input,...(current?.projectMainLabel?{projectMainLabel:current.projectMainLabel}:{}),id:`version-${++next}`,createdAt:Date.now()};builds.set(user,[build,...userBuilds(user)]);return build;}});
  const workbench=(name,input,context)=>executeWorkbenchTool(name,input,context,{historyFactory,readLatest,projectLock:async(_user,task)=>task()});
  const boards=createBoardKitStore({command,idFactory:()=>`board-version-${++next}`});
  const execute=createWorkspaceService({workbench,schedule,reminders,boards,ads:{list:async()=>({campaigns:[]})},images:{list:async()=>({images:[]}),resolve:async()=>({images:{},missing:[]})},tracks:{list:async()=>({tracks:[]})},meter:{summary:async(user,options)=>({plan:options.exempt?'Owner':'Free',exempt:options.exempt,weekly:{percentRemaining:75},user})},loadForm:async()=>formHtml});
  const once=createWorkspaceRequests({command});return {execute,once,schedule,reminders,get saveCount(){return saveCount;}};
}

