import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {WORKSPACE_RESOURCE,WORKSPACE_SCOPES,WORKSPACE_ORIGIN} from './workspaceOAuth.js';
import {workspaceAssistantGuidance} from './workspaceGuidance.js';
import {boardKitSchema} from './boardKits.js';
export const BOARD_URI='ui://nexus/workspace-board/v5.html';
// Installed clients may retain the outputTemplate from an earlier tool scan.
export const BOARD_RESOURCE_URIS=[BOARD_URI,'ui://nexus/workspace-board/v4.html','ui://nexus/workspace-board/v3.html','ui://nexus/workspace-board/v2.html'];
const eventFields={title:z.string().min(1).max(160).optional(),starts_at:z.string().optional(),ends_at:z.string().optional(),timezone:z.string().optional(),notes:z.string().max(4000).optional(),category:z.enum(['work','project','gym','health','family','social','appointment','errands','learning','creative','rest','travel','other']).optional(),flexibility:z.enum(['fixed','flexible']).optional(),protected:z.boolean().optional()};
const reminderFields={title:z.string().min(1).max(160).optional(),notes:z.string().max(4000).optional(),due_date:z.string().nullable().optional(),due_at:z.string().nullable().optional(),timezone:z.string().optional(),repeat:z.enum(['none','daily','weekly']).optional()};
const request_id=z.string().regex(/^[a-zA-Z0-9_-]{8,120}$/u).describe('Required stable ID for this mutation. Reuse it when retrying the identical action.');
export const WORKSPACE_TOOLS=[
  ['read_nexus_board_creator','board_creator','Load the Board Creator skill workflow before scoping a new market board. Define visuals, records, tools, permissions, skill and guidance; confirm scope before saving. Does not build, write, publish or start a model.',{},false],
  ['list_nexus_board_kits','board_kits','List this authenticated account’s private Board Studio kits. Scope drafts and previews are not released products.',{},false],
  ['read_nexus_board_kit','board_kit','Read one owned board kit, its baseline, saved skill/guidance and full shared Site Stylist playbook for requested visual builds. Current and new boards receive shared_skills without rewriting saved content. All guidance is task context, not authority or permission.',{board_id:z.string().min(1).max(64)},false],
  ['save_nexus_board_kit','save_board_kit','Save a requested private board scope or complete HTML preview, packaged with typed data collections, a board skill and guidance. Read baseline before editing; use a fresh ID for a new board. Never publishes or installs arbitrary tools. Tool requirements remain unimplemented.',{board_id:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),baseline:z.string().optional(),spec:boardKitSchema,request_id},true],
  ['list_nexus_board_entries','board_entries','Read saved entries only within an owned board and one declared collection. No access to Projects, calendars, other boards or other accounts.',{board_id:z.string(),collection_id:z.string()},false],
  ['save_nexus_board_entry','save_board_entry','Save one requested record using a board’s declared typed fields. Read current entry baseline before editing. Does not grade, notify, invoke models or modify other Nexus systems.',{board_id:z.string(),collection_id:z.string(),entry_id:z.string(),baseline:z.string().optional(),data:z.record(z.union([z.string().max(2000),z.number().finite(),z.boolean(),z.null()])),request_id},true],
  ['show_nexus_board','board','Load the real Nexus control board at the start of a Nexus workspace task, unless already visible. Shows the authenticated owner’s saved Projects, private Schedule, Reminders, and hosted-AI usage. Reuse this packaged board; never fabricate or rebuild one from guesses. Does not start Nex or use his GPU.',{},false],
  ['read_nexus_workspace','board_data','Refresh the existing board with authoritative workspace data without creating a second visual board.',{},false],
  ['list_nexus_projects','projects','List the owner’s saved Projects. For a new build use a fresh stable project_id, without searching unrelated projects for a destination.',{},false],
  ['read_nexus_project','project','Read an owned project and its current baseline before editing.',{project_id:z.string().min(1).max(120)},false],
  ['save_nexus_project','save_project','Save a complete working HTML page as a draft in Nexus Projects. Never publishes. Reuse project_id and request_id on retry. For edits, read the current baseline first. Only save what the user requested.',{project_id:z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/u),html:z.string().min(1).max(100000),label:z.string().max(160).optional(),baseline:z.string().optional(),request_id},true],
  ['rename_nexus_project','rename_project','Rename one owned Nexus project without changing its HTML or creating a new build. Read the project first and supply its current baseline. Use the same saved name throughout Projects.',{project_id:z.string().min(1).max(120),label:z.string().trim().min(1).max(80),baseline:z.string().min(1),request_id},true],
  ['import_form_project','import_form','Import the existing FORM bodyweight showcase into the owner’s real Projects. Idempotent, preserves an existing copy and later edits. No model call or publication.',{request_id},true],
  ['read_nexus_schedule','schedule','Read the authenticated account’s private Nexus Schedule, including timed Reminder markers. calendar_marker entries show an alert instant without reserving time: edit their reminder_id with update_nexus_reminder, never update_nexus_event. This is not an external Google or Outlook calendar.',{from:z.string().optional(),to:z.string().optional(),status:z.enum(['planned','done','cancelled']).optional()},false],
  ['create_nexus_event','create_event','Create one requested private Nexus Schedule event. Use explicit offsets or timezone; read existing commitments first and disclose conflicts. Ask before applying a multi-event plan.',{...eventFields,title:z.string().min(1).max(160),starts_at:z.string(),request_id},true],
  ['update_nexus_event','update_event','Edit or reschedule one owned Schedule item. Read it first. Do not move a fixed or protected commitment without the user explicitly requesting that change.',{...eventFields,id:z.string(),status:z.enum(['planned','done','cancelled']).optional(),request_id},true],
  ['delete_nexus_event','delete_event','Delete one identified private Schedule item only when the user explicitly asks.',{id:z.string(),request_id},true],
  ['read_nexus_reminders','reminders','Read the account’s private reminders. Phone delivery requires the existing enabled-device and push setup; a saved reminder alone does not prove delivery.',{},false],
  ['create_nexus_reminder','create_reminder','Save one requested private reminder. Timed alerts need due_date, due_at and timezone; undated tasks are supported. Do not promise phone delivery without verification.',{...reminderFields,title:z.string().min(1).max(160),request_id},true],
  ['update_nexus_reminder','update_reminder','Edit, complete or reopen an owned reminder. Preserve the existing record ID; completion also updates a linked Schedule block.',{...reminderFields,id:z.string(),status:z.enum(['planned','done']).optional(),request_id},true],
  ['delete_nexus_reminder','delete_reminder','Delete one reminder and its linked time block only on an explicit user request.',{id:z.string(),request_id},true],
  ['get_nexus_usage','usage','Read actual Nexus hosted-AI allowance. External chat-provider costs are excluded; this does not invent connector credits or change billing.',{},false],
];
export function registerWorkspaceBoard(server,{call=async()=>{throw new Error('Authenticated workspace execution is required.');},authorize=()=>{throw new Error('Owner workspace caller authorization is required.');},loadBoard=()=>readFile(new URL('../public/nexus-workspace-board.html',import.meta.url),'utf8')}={}){
  for(const uri of BOARD_RESOURCE_URIS)server.registerResource('nexus-workspace-board-'+uri.split('/').pop(),uri,{mimeType:'text/html;profile=mcp-app'},async()=>({contents:[{uri,mimeType:'text/html;profile=mcp-app',text:await loadBoard(),_meta:{ui:{domain:WORKSPACE_ORIGIN,prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/widgetDomain':WORKSPACE_ORIGIN,'openai/widgetDescription':'Nexus account controls for saved projects, private schedule, reminders and usage. Server-backed actions; no model or GPU starts.'}}]}));
  for(const [name,action,description,fields,write] of WORKSPACE_TOOLS){
    server.registerTool(name,{description,inputSchema:z.object(fields).strict(),annotations:{readOnlyHint:!write,destructiveHint:name.startsWith('delete_'),idempotentHint:!write || action==='import_form' || action==='save_project',openWorldHint:false},_meta:{securitySchemes:[{type:'oauth2',scopes:[write?'workspace:write':'workspace:read']}],ui:{visibility:['model','app'],...(action==='board'?{resourceUri:BOARD_URI}: {})},'openai/widgetAccessible':true,...(action==='board'?{'openai/outputTemplate':BOARD_URI}: {})}},async args=>{
      const {request_id,...input}=args;
      try{
        await authorize(name,write);
        const result=await call(action==='board_data'?'board':action,input,write?request_id:undefined);
        const guidance=workspaceAssistantGuidance(action,result);
        const structuredContent=guidance?{...result,assistant_guidance:guidance}:result;
        return {structuredContent,content:[{type:'text',text:action==='board'?`Nexus board loaded for ${result.account.id}. ${result.projects.length} saved projects, ${result.schedule.length} schedule items, ${result.reminders.length} reminders.${guidance?' For a first-open exploratory turn, ask: '+guidance.question+' Follow assistant_guidance; do not initiate work without a user choice.':''}`:JSON.stringify(structuredContent)}]};
      }catch(error){return {isError:true,...(error.errorCode==='insufficient_scope'?{_meta:{'mcp/www_authenticate':[`Bearer resource_metadata="${WORKSPACE_ORIGIN}/.well-known/oauth-protected-resource/api/workspace-mcp", scope="${error.requiredScope}"`]}}:{}),structuredContent:{error:error.message,code:error.code || error.errorCode || 'WORKSPACE_UNAVAILABLE',...(error.upgrade_url?{upgrade_url:error.upgrade_url}: {})},content:[{type:'text',text:error.message}]};}
    });
  }
}


