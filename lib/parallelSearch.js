// /lib/parallelSearch.js
// Nex's other tools (lib/github.js, lib/vercel.js, lib/emailSender.js)
// are plain REST wrappers: send a request, get JSON back. This one is
// different on purpose — Parallel's free Search MCP speaks MCP, a
// separate protocol (JSON-RPC messages plus a session handshake), not
// a normal REST endpoint. Nex's tool-dispatch loop in nexBrain.js has
// no built-in MCP client (unlike Claude, which has one natively), so
// this file exists specifically to speak just enough of that protocol
// on Nex's behalf: initialize a session once, then call tools/call for
// web_search / web_fetch like any other tool. See
// nex-skills/web-search/SKILL.md for when Nex should reach for this.
//
// Free, anonymous, no API key required (lower rate limits without one
// — see https://docs.parallel.ai/integrations/mcp/search-mcp). Set
// PARALLEL_API_KEY later if rate limits become a real problem.

const MCP_URL = process.env.PARALLEL_MCP_URL || 'https://search.parallel.ai/mcp';
const PARALLEL_API_KEY = process.env.PARALLEL_API_KEY || null;

// Cached for the life of a warm serverless instance. A cold start (or
// a session the server silently dropped) just means the next call
// re-initializes — see ensureInitialized below.
let cachedSessionId = null;
let initPromise = null;

function baseHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (PARALLEL_API_KEY) headers.Authorization = `Bearer ${PARALLEL_API_KEY}`;
  if (cachedSessionId) headers['Mcp-Session-Id'] = cachedSessionId;
  return headers;
}

// MCP's streamable-HTTP transport can answer either as one plain JSON
// body or as an SSE stream carrying a single JSON-RPC message — both
// are valid for a simple request/response call like ours, so handle
// either rather than assuming.
async function parseRpcResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (contentType.includes('text/event-stream')) {
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) throw new Error('Parallel MCP: SSE response had no data line');
    return JSON.parse(dataLine.slice(5).trim());
  }
  return JSON.parse(text);
}

async function rpcCall(method, params, { notification = false } = {}) {
  const body = { jsonrpc: '2.0', method, params };
  if (!notification) body.id = Date.now() + Math.floor(Math.random() * 1000);

  const res = await fetch(MCP_URL, { method: 'POST', headers: baseHeaders(), body: JSON.stringify(body) });

  const sessionHeader = res.headers.get('mcp-session-id');
  if (sessionHeader) cachedSessionId = sessionHeader;

  if (notification) return null;
  if (!res.ok) throw new Error(`Parallel MCP HTTP ${res.status}`);

  const rpc = await parseRpcResponse(res);
  if (rpc.error) throw new Error(rpc.error.message || 'Parallel MCP returned an error');
  return rpc.result;
}

// The MCP handshake: initialize, then the required "initialized"
// notification, before any real tool call. Runs once per warm
// instance — concurrent callers share the same in-flight promise so
// two simultaneous tool calls don't race two separate handshakes.
async function ensureInitialized() {
  if (cachedSessionId) return;
  if (!initPromise) {
    initPromise = (async () => {
      await rpcCall('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'nex', version: '1.0.0' },
      });
      await rpcCall('notifications/initialized', {}, { notification: true });
    })().finally(() => { initPromise = null; });
  }
  return initPromise;
}

function extractText(mcpResult) {
  const parts = Array.isArray(mcpResult?.content) ? mcpResult.content : [];
  const text = parts.filter((p) => p?.type === 'text').map((p) => p.text).join('\n\n');
  return text || JSON.stringify(mcpResult ?? {});
}

// query: a keyword search string, OR pass objective for a natural-
// language research goal instead — the underlying Search API accepts
// either. max_results caps how many results come back.
export async function webSearch({ query, objective, max_results } = {}) {
  await ensureInitialized();
  const args = {};
  if (objective) args.objective = objective;
  if (query) args.search_queries = Array.isArray(query) ? query : [query];
  if (max_results) args.max_results = max_results;
  const result = await rpcCall('tools/call', { name: 'web_search', arguments: args });
  return extractText(result);
}

export async function webFetch({ url } = {}) {
  if (!url) throw new Error('url is required');
  await ensureInitialized();
  const result = await rpcCall('tools/call', { name: 'web_fetch', arguments: { url } });
  return extractText(result);
}
