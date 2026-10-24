import express from 'express';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {registerWorkspaceBoard} from '../lib/workspaceBoard.js';
import {createWorkspaceService,WORKSPACE_WRITES} from '../lib/workspaceConnector.js';
import {workspaceRequests} from '../lib/workspaceRequests.js';
import {CUSTOMER_KEY_PATTERN,resolveCustomerAccount} from '../lib/customerWorkspaceConnection.js';

const INSTRUCTIONS='This is the shared customer Nexus Board connection. Every tool call requires workspace_key: the private nxc_ key supplied by the user from their Nexus connect page. Never guess a key or use another account connection. If no key was supplied, ask the user to open their Nexus connect page. Keep the key out of visible replies, titles, saved projects, records and follow-up messages. Call show_nexus_board to display the real board and read_nexus_workspace to refresh it after changes. Only perform requested work. No OAuth or new plugin creation is needed for this endpoint. The user must already have access to the shared customer app; do not claim it is installed or publicly distributed.';
const unavailable=()=>({isError:true,structuredContent:{error:'Your private workspace key is missing, invalid or switched off. Open your Nexus connect page for a new connection request.',code:'INVALID_WORKSPACE_KEY'},content:[{type:'text',text:'Your private workspace key is missing, invalid or switched off. Open your Nexus connect page for a new connection request.'}]});

// Owner-only tools never appear on the customer connection.
const CUSTOMER_HIDDEN_TOOLS=new Set(['import_form_project','list_nexus_waitlist','read_nexus_waitlist_entry','update_nexus_waitlist_entry','import_nexus_waitlist_photos','generate_nexus_image','find_nexus_media','use_nexus_media']);

// One app URL for all customers. Discovery is public; every tool call resolves
// its own private credential. No cookies, global "current account", or MCP
// session IDs select an account. The owner's OAuth endpoint is independent.
export function createSharedCustomerMcpApp({resolveAccount=resolveCustomerAccount,execute=createWorkspaceService(),once=workspaceRequests,loadBoard}={}){
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'256kb'}));
 app.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');next();});
 app.all(/.*/,async(req,res)=>{
  if(req.method!=='POST')return res.status(405).json({error:'Use POST for stateless MCP.'});
  // One stateless MCP request gets one immutable account context. SDK rejects
  // JSON-RPC batches; no account state is ever retained across requests.
  const workspaceKey=req.body?.method==='tools/call'?req.body.params?.arguments?.workspace_key:undefined;
  let account=null;
  if(typeof workspaceKey==='string' && CUSTOMER_KEY_PATTERN.test(workspaceKey)){
   try{account=await resolveAccount(workspaceKey);}catch{return res.status(503).json({error:'Nexus workspace is temporarily unavailable.'});}
  }
  if(account?.owner!==false)account=null;
  const server=new McpServer({name:'nexus-customer-board',version:'1.0.0'},{instructions:INSTRUCTIONS});
  // Reuse the product's exact schemas, actions and board. Only this endpoint
  // adds a private key parameter and replaces OAuth metadata with noauth.
  const customerServer={
   registerResource:(...args)=>server.registerResource(...args),
   registerTool:(name,config,handler)=>CUSTOMER_HIDDEN_TOOLS.has(name)?undefined:server.registerTool(name,{
    ...config,
    inputSchema:config.inputSchema.extend({workspace_key:z.string().regex(CUSTOMER_KEY_PATTERN).describe('Private workspace credential from the user\'s Nexus connection request. Never guess or reveal it.')}),
    _meta:{...config._meta,securitySchemes:[{type:'noauth'}]},
   },async args=>{
    if(!account || args.workspace_key!==workspaceKey)return unavailable();
    const {workspace_key,...input}=args;
    const result=await handler(input);
    // Widget-only metadata keeps board button calls scoped too. It is not
    // stored in the board snapshot, widgetState, or persisted product data.
    return result.isError?result:{...result,_meta:{...result._meta,nexus_connection:{workspace_key}}};
   }),
  };
  registerWorkspaceBoard(customerServer,{...(loadBoard?{loadBoard}:{}),authorize:async()=>{if(!account)throw new Error('A private customer workspace key is required.');},call:async(action,input,request_id)=>{
   const run=()=>execute(action,input,account);
   return WORKSPACE_WRITES.has(action)?once(account.id,request_id,action,input,run):run();
  }});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
  res.on('close',()=>{void transport.close().catch(()=>{});void server.close().catch(()=>{});});
  try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch{if(!res.headersSent)res.status(503).json({error:'Nexus workspace is temporarily unavailable.'});}
 });
 return app;
}
export default createSharedCustomerMcpApp();
