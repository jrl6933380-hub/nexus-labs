// /api/mcp.js
// GitHub-write MCP server, built on Anthropic's official MCP SDK
// instead of a hand-rolled JSON-RPC handler. The SDK handles the
// protocol handshake correctly (session headers, version negotiation)
// so we don't have to reimplement that ourselves.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createOrUpdateFile, deleteFile, listFiles, readFile } from '../lib/github.js';
import { authorizeCapability } from '../lib/capabilityGateway.js';

// Safety nets — log anything that would otherwise fail completely
// silently (errors thrown inside async callbacks, outside any try/catch).
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

export default async function handler(req, res) {
  console.log('MCP handler started:', req.method);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed — MCP uses POST' });
    return;
  }
  if (!process.env.GITHUB_TOKEN) {
    res.status(500).json({ error: 'Missing GITHUB_TOKEN environment variable.' });
    return;
  }

  console.log('MCP body:', JSON.stringify(req.body));
  const authorize = (tool, action, args, read_write) => authorizeCapability(req, {
    tool,
    action,
    resource: args?.owner && args?.repo ? `${args.owner}/${args.repo}:${args.path || '*'}` : '*',
    read_write,
  });

  try {
    console.log('MCP step: creating server');
    const server = new McpServer({ name: 'github-write', version: '0.1.0' });

    const fileFields = {
      owner: z.string().describe('Repo owner (GitHub username or org).'),
      repo: z.string().describe('Repo name.'),
      path: z.string().describe('File path within the repo, e.g. "api/chat.js".'),
    };

    server.tool(
      'create_file',
      'Create a new file in a GitHub repo, or overwrite it if it already exists.',
      {
        ...fileFields,
        content: z.string().describe('Full file contents.'),
        message: z.string().optional().describe('Commit message. Optional.'),
        branch: z.string().optional().describe('Branch name. Defaults to the repo default branch.'),
      },
      async (args) => {
        await authorize('create_file', 'create_file', args, 'write');
        const result = await createOrUpdateFile(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool(
      'update_file',
      'Overwrite an existing file in a GitHub repo with new content.',
      {
        ...fileFields,
        content: z.string(),
        message: z.string().optional(),
        branch: z.string().optional(),
      },
      async (args) => {
        await authorize('update_file', 'update_file', args, 'write');
        const result = await createOrUpdateFile(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool(
      'delete_file',
      'Delete a file from a GitHub repo.',
      {
        ...fileFields,
        message: z.string().optional(),
        branch: z.string().optional(),
      },
      async (args) => {
        await authorize('delete_file', 'delete_file', args, 'write');
        const result = await deleteFile(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool(
      'list_files',
      'List files in a GitHub repo directory (or the whole repo root if no path given).',
      {
        owner: z.string(),
        repo: z.string(),
        path: z.string().optional().describe('Folder path. Leave empty for repo root.'),
        branch: z.string().optional(),
      },
      async (args) => {
        await authorize('list_files', 'list_files', args, 'read');
        const result = await listFiles(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool(
      'read_file',
      'Read the contents of a file from a GitHub repo.',
      {
        owner: z.string().describe('Repo owner (GitHub username or org).'),
        repo: z.string().describe('Repo name.'),
        path: z.string().describe('File path within the repo, e.g. "api/chat.js".'),
        branch: z.string().optional().describe('Branch name. Defaults to the repo default branch.'),
      },
      async (args) => {
        await authorize('read_file', 'read_file', args, 'read');
        const result = await readFile(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    // Stateless mode — no session persistence between requests, which
    // matches how serverless functions actually work (no shared memory
    // between invocations).
    console.log('MCP step: creating transport');
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      try {
        transport.close();
        server.close();
      } catch (closeErr) {
        console.error('MCP cleanup error on close:', closeErr.message);
      }
    });

    console.log('MCP step: connecting server to transport');
    await server.connect(transport);
    console.log('MCP step: handling request');
    await transport.handleRequest(req, res, req.body);
    console.log('MCP step: request handled successfully');
  } catch (err) {
    console.error('MCP handler crashed:', err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: `Internal server error: ${err.message}` });
    }
  }
}