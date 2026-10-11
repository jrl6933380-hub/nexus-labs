import {createHistoryHandler} from '../api/room-history.js';
import {getLatestBuildByProject} from './roomHistory.js';
import {withProjectSaveLock} from './projectSaveLock.js';

export const WORKBENCH_TOOLS = [
  {name:'list_workbench_projects',description:'List this signed-in user’s saved Projects. Ordinary websites, apps and tools belong here, not in the Nexus platform GitHub repository.',input_schema:{type:'object',properties:{}}},
  {name:'read_workbench_project',description:'Read the current saved project HTML and build id before editing. Ownership is enforced server-side.',input_schema:{type:'object',properties:{project_id:{type:'string'}},required:['project_id']}},
  {name:'save_workbench_project',description:'Save a working website/app/tool directly to the user’s Projects, or save a new version after reading its baseline. Include complete HTML with inline CSS and JavaScript for interactive tools. Saves a draft, never publishes. Reuse the same project_id on retry; a changed existing project requires its current baseline build id.',input_schema:{type:'object',properties:{project_id:{type:'string',description:'Stable project key using letters, digits, underscores or hyphens.'},html:{type:'string'},label:{type:'string'},baseline:{type:'string',description:'Current build id from read_workbench_project when editing.'}},required:['project_id','html']}},
];

export function projectDestination(message) {
  return /\b(github|repos?(?:itor(?:y|ies))?|branches?|pull request|platform code|system code|nexus-labs)\b/iu.test(String(message)) ? 'repository' : 'workbench';
}

export function restrictToWorkbench(policy,allTools,repositoryTools) {
  const allowedToolNames=new Set(policy.allowedToolNames || allTools.map(tool=>tool.name));
  for(const name of repositoryTools)if(!['run_sandbox','test_code'].includes(name))allowedToolNames.delete(name);
  return {...policy,allowedToolNames};
}

export async function executeWorkbenchTool(name,input,context,{historyFactory=createHistoryHandler,readLatest=getLatestBuildByProject,projectLock=withProjectSaveLock}={}) {
  const owner=context.userId;
  if(!owner)throw new Error('Sign in to access Projects.');
  if(name==='read_workbench_project'){
    const build=await readLatest(owner,String(input.project_id || ''));
    if(!build)throw new Error('Project not found in your Projects.');
    return {project_id:build.projectId || build.id,baseline:build.id,label:build.label,html:build.html};
  }
  const handler=historyFactory({resolveUser:async()=>owner,projectLock});
  const response={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  const body=name==='save_workbench_project'?{
    action:input.baseline?'save_project_edit':'save_project_draft',projectId:input.project_id,html:input.html,label:input.label,baseline:input.baseline,
    sourceConversation:{kind:'chat',id:context.threadId || 'nex-main'},
  }:undefined;
  await handler({method:body?'POST':'GET',body,query:{}},response);
  if(response.code>=400)throw new Error(response.data?.error || 'Projects request failed.');
  if(body)return {saved:true,project_id:response.data.projectId,build_id:response.data.build.id,label:response.data.build.label,location:'Projects',published:false};
  return {projects:(response.data.projects || []).map(project=>({project_id:project.projectId || project.id,baseline:project.id,label:project.label})),workbench:response.data.workbench};
}
