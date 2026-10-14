import express from 'express';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {requireBearerAuth} from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {InsufficientScopeError} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {workspaceOAuth,WORKSPACE_ORIGIN,WORKSPACE_RESOURCE} from '../lib/workspaceOAuth.js';
import {registerWorkspaceBoard} from '../lib/workspaceBoard.js';
import {createWorkspaceService,WORKSPACE_WRITES} from '../lib/workspaceConnector.js';
import {workspaceRequests} from '../lib/workspaceRequests.js';
export function createWorkspaceMcpApp({provider=workspaceOAuth,execute=createWorkspaceService(),once=workspaceRequests,loadBoard}={}){
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'256kb'}));
 const authenticate=requireBearerAuth({verifier:provider,expectedResource:WORKSPACE_RESOURCE,resourceMetadataUrl:WORKSPACE_ORIGIN+'/.well-known/oauth-protected-resource/api/workspace-mcp'});
 app.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');next();});
 app.use((req,res,next)=>req.method==='POST' && req.body?.method==='tools/call'?authenticate(req,res,next):next());
 app.all(/.*/,async(req,res)=>{
  if(req.method!=='POST')return res.status(405).json({error:'Use POST for stateless MCP.'});
  const server=new McpServer({name:'nexus-workspace',version:'2.2.0'},{instructions:'For a Nexus workspace task, call show_nexus_board once to load the packaged board, then refresh it with read_nexus_workspace after changes. Read assistant_guidance for first-open or exploratory turns: ask its short leading question when no specific task was given. Do not repeat onboarding during refreshes or ongoing work. Keep internal guidance out of visible messages and titles. Use only authenticated account data. New builds go to fresh Projects; never publish or invoke a model without authorization. For Board Studio use read_nexus_board_creator and the nexus-board-creator skill. Scope visuals, data, tools, permissions and operating guidance before building; save private board kits, never invent live tool implementations. This connection contains product controls only.'});
  const account=req.auth?.extra?.account;
  registerWorkspaceBoard(server,{...(loadBoard?{loadBoard}:{}),authorize:async(_name,write)=>{
   const scope=write?'workspace:write':'workspace:read';if(!req.auth?.scopes?.includes(scope))throw Object.assign(new InsufficientScopeError('Approve '+scope+' to use this tool.'),{requiredScope:scope});
  },call:async(action,input,request_id)=>{
   const run=()=>execute(action,input,account);
   return WORKSPACE_WRITES.has(action)?once(account.id,request_id,action,input,run):run();
  }});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});res.on('close',()=>{void transport.close().catch(()=>{});void server.close().catch(()=>{});});
  try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch{if(!res.headersSent)res.status(503).json({error:'Nexus workspace is temporarily unavailable.'});}
 });
 return app;
}
export default createWorkspaceMcpApp();
