// Prints why the render worker cannot reach the database, without ever printing the address or password.
// Usage: NEXUS_DATABASE_URL=... node scripts/render-worker-diagnose.mjs
import pg from 'pg';
const raw = String(process.env.NEXUS_DATABASE_URL || '');
const mask = (s) => String(s).split(raw).join('[db-url]').replace(/postgres(ql)?:\/\/[^\s'"]+/g, '[db-url]');
const shape = {};
try {
  const u = new URL(raw.trim());
  Object.assign(shape, { scheme: u.protocol, hostSuffix: u.hostname.split('.').slice(-2).join('.'), pooler: /-pooler\./.test(u.hostname), hasPassword: !!u.password, database: !!u.pathname.slice(1), params: [...u.searchParams.keys()], hadQuotesOrSpaces: /^['"]|['"]$|\s/.test(raw.trim()) });
} catch { Object.assign(shape, { parseable: false, length: raw.length, startsWith: raw.slice(0, 11).replace(/[^a-z:/_]/gi, '?') }); }
console.log('address shape:', JSON.stringify(shape));
const client = new pg.Client({ connectionString: raw.trim(), connectionTimeoutMillis: 15000 });
try { await client.connect(); const r = await client.query('select 1 as ok'); console.log('database reachable:', r.rows[0].ok === 1); await client.end(); }
catch (e) { console.log('database error:', e.code || e.name, '|', mask(e.message).slice(0, 240)); process.exitCode = 0; }
