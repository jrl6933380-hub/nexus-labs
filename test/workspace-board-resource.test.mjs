import test from 'node:test';
import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerWorkspaceBoard,BOARD_URI,BOARD_RESOURCE_URIS} from '../lib/workspaceBoard.js';

test('a cached v2 tool template can read the current board through MCP',async()=>{
 const server=new McpServer({name:'board-test',version:'1.0.0'});
 const client=new Client({name:'cached-client',version:'1.0.0'});
 let reads=0;
 registerWorkspaceBoard(server,{loadBoard:async()=>{reads++;return '<html>Current board</html>';}});
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
 await server.connect(serverTransport);await client.connect(clientTransport);
 try{
  const tools=await client.listTools();
  assert.equal(tools.tools.find(t=>t.name==='show_nexus_board')._meta['openai/outputTemplate'],BOARD_URI);
  for(const uri of BOARD_RESOURCE_URIS){
   const result=await client.readResource({uri});
   assert.equal(result.contents[0].uri,uri);
   assert.equal(result.contents[0].text,'<html>Current board</html>');
   assert.equal(result.contents[0].mimeType,'text/html;profile=mcp-app');
   assert.deepEqual(result.contents[0]._meta.ui.csp.connectDomains,[]);
  }
  assert.equal(reads,BOARD_RESOURCE_URIS.length);
  await assert.rejects(client.readResource({uri:'ui://nexus/workspace-board/unknown.html'}),/not found/);
 }finally{await client.close();await server.close();}
});
