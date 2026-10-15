// TEST ONLY. A tiny stateless MCP server with one harmless tool and no login,
// used to check that ChatGPT's Plugin Creator can build a brand-new connector
// from the prompt that /connect fills in. It reads and writes nothing, touches
// no Nexus data, and shares no code with the workspace MCP or its OAuth.
// Safe to delete once the test is done.
import express from 'express';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export function createTestMcpApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({limit: '16kb'}));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.all(/.*/, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({error: 'Use POST for stateless MCP.'});
    const server = new McpServer(
      {name: 'nexus-test', version: '0.1.0'},
      {instructions: 'Test connector. Call ping to confirm the connection works. It returns a fixed message and uses no account data.'}
    );
    server.registerTool(
      'ping',
      {title: 'Ping', description: 'Returns a short fixed message to confirm the test connector is connected. Takes no input and reads no data.'},
      async () => ({content: [{type: 'text', text: 'pong from the Nexus test connector'}]})
    );
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
    res.on('close', () => {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(503).json({error: 'Test connector is temporarily unavailable.'});
    }
  });
  return app;
}

export default createTestMcpApp();
