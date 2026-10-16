import {AD_DESIGN_CONTRACT,adDesignPreset} from './adDesigns.js';
import {adCampaignStore} from './adCampaigns.js';
import {renderAdPreview} from './adPreview.js';
import {customerWorkspaceAccount} from './workspaceAccount.js';
import {calendarWithReminders} from './calendarReminders.js';
// Product operations only. Identity comes from authentication, never tool input.
import {readFile} from 'node:fs/promises';
import {getNexusOwner} from './nexusOwnerAuth.js';
import {getRequestUser,ownerWorkbenchUsername} from './roomAuth.js';
import {privatePlatformAuthorized} from './privatePlatformAuth.js';
import {executeWorkbenchTool} from './workbenchTools.js';
import * as planner from './planner.js';
import {reminderStore} from './reminders.js';
import {nexusUsage} from './nexusUsage.js';
import {currentUserClock,schedulingInput,validTimezone} from './userClock.js';
import {workspaceOnboarding} from './workspaceGuidance.js';
import {boardKitStore,BOARD_CREATOR_GUIDANCE} from './boardKits.js';
import {boardSharedSkills} from './boardSiteStylist.js';

export const WORKSPACE_ACTIONS=Object.freeze({
  ads:[],save_ad_design:['campaign_id','baseline','design'],apply_ad_design:['campaign_id','baseline','preset'],ad:['campaign_id'],open_ad:['campaign_id'],save_ad:['campaign_id','baseline','project'],
  board:[],projects:[],project:['project_id'],save_project:['project_id','html','label','baseline'],rename_project:['project_id','label','baseline'],import_form:[],
  schedule:['from','to','status'],create_event:['title','starts_at','ends_at','timezone','notes','category','flexibility','protected'],
  update_event:['id','title','starts_at','ends_at','timezone','notes','status','category','flexibility','protected'],delete_event:['id'],
  reminders:[],create_reminder:['title','notes','due_date','due_at','timezone','repeat'],
  update_reminder:['id','title','notes','due_date','due_at','timezone','repeat','status'],delete_reminder:['id'],usage:[],
  board_creator:[],board_kits:[],board_kit:['board_id'],save_board_kit:['board_id','baseline','spec'],delete_board_kit:['board_id','baseline'],board_entries:['board_id','collection_id'],save_board_entry:['board_id','collection_id','entry_id','baseline','data'],
});
export const WORKSPACE_WRITES=new Set(['save_ad_design','apply_ad_design','save_ad','save_project','rename_project','import_form','create_event','update_event','delete_event','create_reminder','update_reminder','delete_reminder','save_board_kit','save_board_entry','delete_board_kit']);
const problem=(message,status=400,code='INVALID_INPUT')=>Object.assign(new Error(message),{status,code});
export async function resolveWorkspaceAccount(req,{getOwner=getNexusOwner,getUser=getRequestUser,agentAuthorized=privatePlatformAuthorized,env=process.env}={}){
  const owner=await getOwner(req);
  if(owner)return {id:owner.id,workbenchUserId:ownerWorkbenchUsername(),scheduleUserId:`owner:${owner.id}`,owner:true};
  // This credential is private owner infrastructure; never distribute it to customers.
  if(req.headers?.authorization){
    if(!await agentAuthorized(req))throw problem('Connector authentication required.',401,'UNAUTHORIZED');
    const id=String(env.NEXUS_OWNER_ID || 'justin').trim().toLowerCase();
    if(!/^[a-z0-9_-]{3,32}$/u.test(id))throw problem('Owner identity is not configured.',503,'UNAVAILABLE');
    return {id,workbenchUserId:ownerWorkbenchUsername(),scheduleUserId:`owner:${id}`,owner:true};
  }
  const user=await getUser(req);
  if(!user)throw problem('Sign in to Nexus first.',401,'UNAUTHORIZED');
  return customerWorkspaceAccount(user);
}
export function validateWorkspaceInput(action,input={}){
  const fields=WORKSPACE_ACTIONS[action];
  if(!fields)throw problem('Unknown workspace action.');
  if(!input || typeof input!=='object' || Array.isArray(input))throw problem('Provide a tool input object.');
  for(const key of Object.keys(input))if(!fields.includes(key))throw problem(`Unsupported field: ${key}`);
  for(const key of ['title','notes','html','label','baseline','category','flexibility','status','repeat','due_date'])if(input[key]!=null && typeof input[key]!=='string')throw problem(`${key} must be text.`);
  if(['create_event','create_reminder'].includes(action) && !input.title?.trim())throw problem('A title is required.');
  if(action==='create_event' && !input.starts_at)throw problem('A start time is required.');
  if(input.protected!==undefined && typeof input.protected!=='boolean')throw problem('protected must be true or false.');
  if(action==='save_project' && (typeof input.html!=='string' || !/<html\b|<!doctype\s+html/iu.test(input.html)))throw problem('Provide a complete HTML document for the saved build.');
  if(action==='rename_project' && (!input.label?.trim() || input.label.trim().length>80 || !input.baseline))throw problem('Provide a project name of 1–80 characters and its current baseline.');
  for(const field of ['id','project_id'])if(fields.includes(field) && (!input[field] || typeof input[field]!=='string' || input[field].length>120))throw problem(`A valid ${field} is required.`);
  for(const key of ['starts_at','ends_at','due_at','from','to'])if(input[key]!=null){
    if(typeof input[key]!=='string')throw problem(`${key} must be a date/time string.`);
    if(!/(?:Z|[+-]\d{2}:\d{2})$/iu.test(input[key]) && !validTimezone(input.timezone))throw problem(`${key} needs an explicit UTC offset or a valid IANA timezone.`);
  }
  if(input.timezone!==undefined && !validTimezone(input.timezone))throw problem('Choose a valid IANA timezone.');
  return input;
}
export function createWorkspaceService({workbench=executeWorkbenchTool,schedule=planner,reminders=reminderStore,meter=nexusUsage,boards=boardKitStore,ads=adCampaignStore,preview=renderAdPreview,loadForm=()=>readFile(new URL('../public/demos/form-bodyweight.html',import.meta.url),'utf8'),now=Date.now}={}){
  return async function execute(action,input,account){
    validateWorkspaceInput(action,input);
    if(!account?.id || !account.workbenchUserId || !account.scheduleUserId)throw problem('Authenticated account required.',401,'UNAUTHORIZED');
    const context={userId:account.id,workbenchUserId:account.workbenchUserId,threadId:'connector-workspace'};
    const user=account.scheduleUserId;
    if(action==='ads')return ads.list(account.id);
    if(action==='ad')return {...await ads.read(account.id,input.campaign_id),design_contract:AD_DESIGN_CONTRACT};
    if(action==='save_ad_design')return ads.saveDesign(account.id,input);
    if(action==='apply_ad_design')return ads.saveDesign(account.id,{campaign_id:input.campaign_id,baseline:input.baseline,design:await adDesignPreset(input.preset)});
    if(action==='open_ad'){const record=await ads.read(account.id,input.campaign_id);return {...record,preview_html:await preview(record)};}
    if(action==='save_ad')return ads.save(account.id,input);
    if(action==='board_creator')return {creator:BOARD_CREATOR_GUIDANCE};
    if(action==='board_kits')return boards.list(account.id);
    if(action==='board_kit')return boards.read(account.id,input.board_id);
    if(action==='save_board_kit')return boards.save(account.id,input);
    if(action==='delete_board_kit')return boards.remove(account.id,input);
    if(action==='board_entries')return boards.entries(account.id,input);
    if(action==='save_board_entry')return boards.saveEntry(account.id,input);
    const save=async draft=>{
      const result=await workbench('save_workbench_project',draft,context);
      const read=await workbench('read_workbench_project',{project_id:draft.project_id},context);
      if(read.html!==draft.html || read.baseline!==result.build_id)throw problem('The draft could not be verified. Refresh Projects before retrying.',503,'CHECK_SAVED_STATE');
      return result;
    };
    if(action==='projects')return workbench('list_workbench_projects',{},context);
    if(action==='project')return {...await workbench('read_workbench_project',input,context),shared_skills:boardSharedSkills()};
    if(action==='save_project')return save(input);
    if(action==='rename_project'){
      const before=await workbench('read_workbench_project',{project_id:input.project_id},context);
      const result=await workbench('rename_workbench_project',input,context);
      const read=await workbench('read_workbench_project',{project_id:input.project_id},context);
      if(read.label!==result.label || read.html!==before.html || read.baseline!==before.baseline)throw problem('The rename could not be verified. Refresh Projects to check saved state.',503,'CHECK_SAVED_STATE');
      return {...result,baseline:read.baseline};
    }
    if(action==='import_form'){
      if(!account.owner)throw problem('This showcase import is for the owner demo account.',403,'FORBIDDEN');
      const project_id='form-bodyweight-showcase';
      const {projects}=await workbench('list_workbench_projects',{},context);
      if(projects.some(p=>p.project_id===project_id))return {saved:true,already_saved:true,project_id,location:'Projects',published:false};
      return save({project_id,label:'FORM Bodyweight',html:await loadForm()});
    }
    if(action==='schedule'){const events=await schedule.listPlannerItems(input,user,{allowLegacyMigration:Boolean(account.owner)});return {items:calendarWithReminders(events,await reminders.list(user),input)};}
    const timed=schedulingInput(input,input.timezone);
    if(action==='create_event')return {item:await schedule.createPlannerItem(timed,user)};
    if(action==='update_event')return {item:await schedule.updatePlannerItem(timed,user)};
    if(action==='delete_event')return schedule.deletePlannerItem(input.id,user);
    if(action==='reminders')return {items:await reminders.list(user)};
    if(action==='create_reminder')return {item:await reminders.create(timed,user)};
    if(action==='update_reminder')return {item:await reminders.update(timed,user)};
    if(action==='delete_reminder')return reminders.remove(input.id,user);
    if(action==='usage')return {usage:await meter.summary(account.workbenchUserId,{exempt:Boolean(account.owner)}),scope:'Nexus-hosted AI allowance. External chat-provider usage is not included; connector product actions do not consume this AI allowance.'};
    if(action==='board'){
      // A broken data store is an error, never a fabricated empty workspace.
      const [projects,events,tasks,usage,kits,adList]=await Promise.all([
        workbench('list_workbench_projects',{},context),schedule.listPlannerItems({},user,{allowLegacyMigration:Boolean(account.owner)}),reminders.list(user),meter.summary(account.workbenchUserId,{exempt:Boolean(account.owner)}),
        boards.list(account.id),ads.list(account.id),
      ]);
      const calendar=calendarWithReminders(events,tasks);
      return {account:{id:account.id,name:account.owner?account.id:account.workbenchUserId,owner:Boolean(account.owner)},boards:kits.boards,ads:adList.campaigns,board_studio:{private:true,available:Boolean(account.owner),skill:'nexus-board-creator'},shared_skills:boardSharedSkills(),projects:projects.projects,workbench:projects.workbench,schedule:calendar,reminders:tasks,usage,onboarding:workspaceOnboarding({projects:projects.projects,schedule:calendar,reminders:tasks}),updated_at:new Date(now()).toISOString(),clock:currentUserClock(null,{now}),usage_scope:'Nexus-hosted AI only; your separate chat-provider usage is not billed by Nexus.'};
    }
  };
}


