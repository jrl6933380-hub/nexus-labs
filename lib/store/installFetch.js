// Importing this file makes the app's Redis-over-HTTP calls (fetch to KV_REST_API_URL) go to the Postgres store
// instead, whenever NEXUS_DATABASE_URL (or DATABASE_URL) is set. With no database URL it does nothing, so local
// tests and the sandboxed scripts keep their existing behaviour.
import { databaseUrl, getStore } from './index.js';

export const STORE_URL = 'https://nexus-store.invalid';
export const STORE_TOKEN = 'nexus-store';

function enabled() { return Boolean(databaseUrl()); }

// Point every module that reads KV_REST_API_URL at the sentinel, so the real Upstash is never contacted.
if (enabled()) {
  process.env.KV_REST_API_URL = STORE_URL;
  process.env.KV_REST_API_TOKEN = STORE_TOKEN;
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

const realFetch = globalThis.fetch;
if (!globalThis.__nexusStoreFetchInstalled) {
  globalThis.__nexusStoreFetchInstalled = true;
  globalThis.fetch = async function storeAwareFetch(input, init) {
    if (enabled()) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
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
