import express from 'express';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {registerWorkspaceBoard} from '../../lib/workspaceBoard.js';
import {createWorkspaceService,WORKSPACE_WRITES} from '../../lib/workspaceConnector.js';
import {workspaceRequests} from '../../lib/workspaceRequests.js';
import {customerWorkspaceAccount} from '../../lib/workspaceAccount.js';
import {connectTokens} from '../../lib/customerConnectToken.js';
import {isOperatorUser} from '../../lib/roomAuth.js';
import {teamCommand} from '../../lib/teamRuns.js';

// Customer-only MCP endpoint. The private token in the URL identifies one
// customer account; there is no OAuth here. The owner account is never
// reachable through this route, and the owner MCP (api/workspace-mcp.js) is untouched.
const USERS_KEY='nexus:room:users';
const INSTRUCTIONS='For a Nexus workspace task, call show_nexus_board once to load the packaged board, then refresh it with read_nexus_workspace after changes. Read assistant_guidance for first-open or exploratory turns: ask its short leading question when no specific task was given. Do not repeat onboarding during refreshes or ongoing work. Keep internal guidance out of visible messages and titles. Use only authenticated account data. New builds go to fresh Projects; never publish or invoke a model without authorization. For Board Studio use read_nexus_board_creator and the nexus-board-creator skill. Scope visuals, data, tools, permissions and operating guidance before building; save private board kits, never invent live tool implementations. This connection contains product controls only.';
const tokenFromUrl=url=>{try{return new URL(url,'http://x').pathname.split('/').filter(Boolean).pop() || '';}catch{return '';}};

export async function resolveCustomerAccount(token,{tokens=connectTokens,command=teamCommand}={}){
 const username=await tokens.resolve(token);
 if(!username || isOperatorUser(username))return null;
 if(!await command(['HGET',USERS_KEY,username]))return null;
 return customerWorkspaceAccount(username);
}

export function createCustomerMcpApp({resolveAccount=resolveCustomerAccount,execute=createWorkspaceService(),once=workspaceRequests,loadBoard}={}){
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'256kb'}));
 app.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');next();});
 app.all(/.*/,async(req,res)=>{
  if(req.method!=='POST')return res.status(405).json({error:'Use POST for stateless MCP.'});
  let account=null;
  try{account=await resolveAccount(tokenFromUrl(req.originalUrl || req.url));}catch{return res.status(503).json({error:'Nexus workspace is temporarily unavailable.'});}
  if(!account)return res.status(404).json({error:'This connector address is not valid. Open your Nexus connect page to get a new one.'});
  const server=new McpServer({name:'nexus-workspace',version:'2.2.0'},{instructions:INSTRUCTIONS});
  registerWorkspaceBoard(server,{...(loadBoard?{loadBoard}:{}),authorize:async()=>{},call:async(action,input,request_id)=>{
   const run=()=>execute(action,input,account);
   return WORKSPACE_WRITES.has(action)?once(account.id,request_id,action,input,run):run();
  }});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});res.on('close',()=>{void transport.close().catch(()=>{});void server.close().catch(()=>{});});
  try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch{if(!res.headersSent)res.status(503).json({error:'Nexus workspace is temporarily unavailable.'});}
 });
 return app;
}
export default createCustomerMcpApp();
