// TEST ONLY (second one). Same idea as api/test-mcp.js but with a different
// name and tool, so a second Plugin Creator build can be told apart from the
// first. No login, reads and writes nothing, shares no code with the
// workspace MCP. Delete this and api/test-mcp.js when testing is done.
import express from 'express';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';

export function createTestMcpApp2() {
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
      {name: 'nexus-test-two', version: '0.1.0'},
      {instructions: 'Second test connector. Call echo_back with a short word to confirm the connection works. It only repeats the word and uses no account data.'}
    );
    server.registerTool(
      'echo_back',
      {
        title: 'Echo back',
        description: 'Repeats a short word back with a fixed prefix to confirm the second test connector is connected. Reads no data.',
        inputSchema: {word: z.string().max(40)},
      },
      async ({word}) => ({content: [{type: 'text', text: 'test connector two heard: ' + word}]})
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

export default createTestMcpApp2();
