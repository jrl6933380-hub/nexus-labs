// Isolated connection test: public fixture data only. No Nexus account,
// session, OAuth, Redis, Projects, Schedule or Reminder imports.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const LAB_BOARD_URI='ui://nexus-connection-lab/board/v1.html';
const ORIGIN='https://nexus-labs-sigma.vercel.app';
const challenge=z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/u);
const outputSchema=z.object({source:z.literal('nexus-connection-lab'),test_only:z.literal(true),server_time:z.string(),response_id:z.string(),challenge:challenge.nullable()});

export function createConnectionLabMcpApp({now=()=>new Date().toISOString(),id=randomUUID,loadBoard=()=>readFile(new URL('../public/connection-lab-board.html',import.meta.url),'utf8')}={}){
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));
 app.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');next();});
 app.all(/.*/,async(req,res)=>{
  if(req.method!=='POST')return res.status(405).json({error:'Use POST for stateless MCP.'});
  const server=new McpServer({name:'nexus-connection-lab',version:'1.0.0'},{instructions:'This is an isolated public connection test, not a user workspace. To test this App, call show_connection_test_board. The user can press Verify live connection on the board to call refresh_connection_test_board. Only these uniquely named tools prove this connection; never substitute Nexus Workspace tools. The board displays synthetic test data and a server round-trip receipt. It creates no customer account and needs no login. A successful test proves this App connection works for the caller; it does not prove availability to other ChatGPT accounts.'});
  server.registerResource('connection-test-board',LAB_BOARD_URI,{mimeType:'text/html;profile=mcp-app'},async()=>({contents:[{uri:LAB_BOARD_URI,mimeType:'text/html;profile=mcp-app',text:await loadBoard(),_meta:{ui:{domain:ORIGIN,prefersBorder:false,csp:{connectDomains:[],resourceDomains:[]}},'openai/widgetDomain':ORIGIN,'openai/widgetDescription':'An isolated MCP connection receipt. Its button verifies a real tool round trip; it has no account data.'}}]}));
  const result=echo=>{
   const structuredContent={source:'nexus-connection-lab',test_only:true,server_time:now(),response_id:id(),challenge:echo};
   return {structuredContent,content:[{type:'text',text:'Connection Lab returned a live test response. This contains no Nexus account data.'}]};
  };
  const meta={securitySchemes:[{type:'noauth'}],ui:{visibility:['model','app']},'openai/widgetAccessible':true};
  const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:false};
  server.registerTool('show_connection_test_board',{title:'Open connection test board',description:'Open the isolated Nexus Connection Lab board. Returns a fresh server timestamp and response ID. No account access or saved data.',inputSchema:z.object({}).strict(),outputSchema,annotations,_meta:{...meta,ui:{...meta.ui,resourceUri:LAB_BOARD_URI},'openai/outputTemplate':LAB_BOARD_URI}},async()=>result(null));
  server.registerTool('refresh_connection_test_board',{title:'Verify live connection',description:'Echo a unique test challenge with a fresh server response. The board uses it to verify a real round trip. No account access or saved data.',inputSchema:z.object({challenge}).strict(),outputSchema,annotations,_meta:meta},async({challenge})=>result(challenge));
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
  res.on('close',()=>{void transport.close().catch(()=>{});void server.close().catch(()=>{});});
  try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch{if(!res.headersSent)res.status(503).json({error:'Connection Lab is temporarily unavailable.'});}
 });
 return app;
}
export default createConnectionLabMcpApp();
