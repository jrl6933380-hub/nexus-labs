// Importing this file makes the app's Redis-over-HTTP calls (fetch to KV_REST_API_URL) go to the Postgres store
// instead, whenever NEXUS_DATABASE_URL (or DATABASE_URL) is set. With no database URL it does nothing, so local
// tests and the sandboxed scripts keep their existing behaviour.
import { databaseUrl, getStore, getDb } from './index.js';
import { handleRestRequest, restErrorResponse } from './postgrest.js';

export const STORE_URL = 'https://nexus-store.invalid';
export const STORE_TOKEN = 'nexus-store';
// The app's Supabase REST calls (forge_*, rooms, pinned_visuals) are served from the same database.
export const REST_URL = 'https://nexus-db.invalid';

function enabled() { return Boolean(databaseUrl()); }

// Point every module that reads KV_REST_API_URL at the sentinel, so the real Upstash is never contacted.
if (enabled()) {
  process.env.KV_REST_API_URL = STORE_URL;
  process.env.KV_REST_API_TOKEN = STORE_TOKEN;
  process.env.SUPABASE_URL = REST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = STORE_TOKEN;
  process.env.SUPABASE_ANON_KEY = STORE_TOKEN;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function handleKvRequest(store, path, bodyText) {
  let body;
  try { body = JSON.parse(bodyText); } catch { return json(400, { error: 'ERR invalid JSON body' }); }
  try {
    if (path === '/pipeline') return json(200, await store.pipeline(body));
    if (path === '/multi-exec') return json(200, await store.multiExec(body));
    return json(200, { result: await store.command(body) });
  } catch (error) {
    const message = String(error?.message || error);
    // Redis-style errors ("ERR ...", "WRONGTYPE ...") are the caller's fault; anything else is the database.
    return json(/^[A-Z]{3,}\b/.test(message) ? 400 : 500, { error: message });
  }
}

export async function handleSupabaseRequest(db, url, init) {
  const parsed = new URL(url);
  const table = parsed.pathname.replace(/^\/rest\/v1\//u, '').replace(/\/+$/u, '');
  const headers = new Headers(init?.headers || {});
  try {
    const { status, body } = await handleRestRequest(db, {
      method: String(init?.method || 'GET').toUpperCase(),
      table,
      searchParams: parsed.searchParams,
      prefer: headers.get('prefer'),
      bodyText: typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '',
    });
    return body === null ? new Response(null, { status }) : json(status, body);
  } catch (error) {
    const out = restErrorResponse(error);
    return json(out.status, out.body);
  }
}

const realFetch = globalThis.fetch;
if (!globalThis.__nexusStoreFetchInstalled) {
  globalThis.__nexusStoreFetchInstalled = true;
  globalThis.fetch = async function storeAwareFetch(input, init) {
    if (enabled()) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      if (typeof url === 'string' && url.startsWith(`${REST_URL}/rest/v1/`)) {
        return handleSupabaseRequest(getDb(), url, init);
      }
      if (typeof url === 'string' && url.startsWith(STORE_URL)) {
        const store = getStore();
        const path = url.slice(STORE_URL.length).split('?')[0].replace(/\/+$/, '');
        const body = init?.body ?? (typeof input === 'object' && 'text' in input ? await input.text() : '[]');
        return handleKvRequest(store, path, typeof body === 'string' ? body : String(body));
      }
    }
    return realFetch(input, init);
  };
}
