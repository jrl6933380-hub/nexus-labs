import {createHistoryHandler} from '../api/room-history.js';
import {getLatestBuildByProject} from './roomHistory.js';
import {withProjectSaveLock} from './projectSaveLock.js';

export const WORKBENCH_TOOLS = [
  {name:'list_workbench_projects',description:'List this signed-in user’s saved Projects only to find an existing project the user asked to open or edit. New builds go directly into a fresh Workbench project; do not list old projects to choose a destination.',input_schema:{type:'object',properties:{}}},
  {name:'read_workbench_project',description:'Read the current saved project HTML and build id before editing. Ownership is enforced server-side.',input_schema:{type:'object',properties:{project_id:{type:'string'}},required:['project_id']}},
  {name:'save_workbench_project',description:'Save a working website/app/tool directly to the user’s Projects, or save a new version after reading its baseline. Include complete HTML with inline CSS and JavaScript for interactive tools. Saves a draft, never publishes. Reuse the same project_id on retry; a changed existing project requires its current baseline build id.',input_schema:{type:'object',properties:{project_id:{type:'string',description:'Stable project key using letters, digits, underscores or hyphens.'},html:{type:'string',minLength:1,maxLength:100000,description:'Complete HTML document, not an object, URL or filename. Up to 100000 characters.'},label:{type:'string'},baseline:{type:'string',description:'Current build id from read_workbench_project when editing.'}},required:['project_id','html']}},
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
  const owner=context.workbenchUserId || context.userId;
  if(!owner)throw Object.assign(new Error('Sign in to access Projects.'),{status:401});
  if(name==='read_workbench_project'){
    const build=await readLatest(owner,String(input.project_id || ''));
    if(!build)throw new Error('Project not found in your Projects.');
    return {project_id:build.projectId || build.id,baseline:build.id,label:build.label,html:build.html};
  }
  if(name==='save_workbench_project'){
    if(typeof input.project_id!=='string' || !/^[a-zA-Z0-9_-]{1,120}$/u.test(input.project_id))throw new Error('Fix project_id: use 1–120 letters, digits, underscores or hyphens, for example bodyweight-workout. Do not use spaces, a URL, or a filename path. Keep this same key for the build and read it before updating an existing version.');
    if(typeof input.html!=='string' || !input.html.trim())throw new Error('Fix html: provide the complete page as a non-empty HTML string, not an object, filename, or URL.');
    if(input.html.length>100000)throw new Error(`Fix html: the page has ${input.html.length} characters; the save endpoint accepts at most 100000. Remove embedded bulk data or simplify the document, then retry the same project_id.`);
  }
  const handler=historyFactory({resolveUser:async()=>owner,projectLock});
  const response={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  const body=name==='save_workbench_project'?{
    action:input.baseline?'save_project_edit':'save_project_draft',projectId:input.project_id,html:input.html,label:input.label,baseline:input.baseline,
    sourceConversation:{kind:'chat',id:context.threadId || 'nex-main'},
  }:undefined;
  await handler({method:body?'POST':'GET',body,query:{}},response);
  if(response.code>=400)throw Object.assign(new Error(response.data?.error || 'Projects request failed.'),{status:response.code});
  if(body)return {saved:true,project_id:response.data.projectId,build_id:response.data.build.id,label:response.data.build.label,location:'Projects',published:false};
  return {projects:(response.data.projects || []).map(project=>({project_id:project.projectId || project.id,baseline:project.id,label:project.label})),workbench:response.data.workbench};
}
