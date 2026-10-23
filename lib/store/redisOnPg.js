// The Redis commands this app uses, implemented on Postgres.
//
// The app was written against Upstash Redis (over its REST API). This module answers the same commands from
// Postgres so the data can live in one database that you own. It is not a general Redis clone: it covers the
// commands the code base uses (plus a few close neighbours) and returns the same replies Upstash returns, as plain
// JSON values (number, string, null, array). Anything else fails with "ERR unknown command".
//
// Atomicity: every command that writes, and every EVAL script, runs in one transaction behind a single global
// advisory lock. That serialises writes the same way Redis' single thread does, so read-modify-write scripts
// (locks, metering, compare-and-set) stay correct. Reads run on a consistent snapshot and never wait on the lock.
//
// Differences from Redis to be aware of (all deliberate):
//  - values cannot contain NUL bytes (Postgres text);
//  - integer arithmetic is exact (BigInt) but results come back as JS numbers, so beyond 2^53 they lose precision;
//  - an error inside an EVAL script rolls the whole script back (Redis keeps the effects that already ran);
//  - SCAN returns every match in one page with cursor "0" (allowed: COUNT is only a hint).

import { runScript, ScriptReplyError, LuaError, formatG } from './lua.js';
import { ensureSchema } from './schema.js';

export class RedisError extends Error {}

export const WRITE_LOCK = 727001;
const WRONGTYPE = 'WRONGTYPE Operation against a key holding the wrong kind of value';
const SYNTAX = 'ERR syntax error';
const NOT_INTEGER = 'ERR value is not an integer or out of range';
const NOT_FLOAT = 'ERR value is not a valid float';
const INT64_MAX = 9223372036854775807n;
const INT64_MIN = -9223372036854775808n;
const LIVE_SQL = '(expires_at is null or expires_at > clock_timestamp())';

// ---------- small helpers ----------

function text(value) {
  const s = String(value);
  if (s.includes('\u0000')) throw new RedisError('ERR this store cannot hold NUL bytes');
  return s;
}

function parseInteger(value, message = NOT_INTEGER) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new RedisError(message);
  const n = BigInt(value);
  if (n > INT64_MAX || n < INT64_MIN) throw new RedisError(message);
  return n;
}

function parseCount(value, message = NOT_INTEGER) { return Number(parseInteger(value, message)); }

function parseScore(value, { allowExclusive = false } = {}) {
  let exclusive = false;
  let raw = String(value);
  if (allowExclusive && raw.startsWith('(')) { exclusive = true; raw = raw.slice(1); }
  const lower = raw.toLowerCase();
  let score;
  if (lower === 'inf' || lower === '+inf') score = Infinity;
  else if (lower === '-inf') score = -Infinity;
  else if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw)) score = Number(raw);
  else throw new RedisError(allowExclusive ? 'ERR min or max is not a float' : NOT_FLOAT);
  return { score, exclusive };
}

function scoreText(score) {
  if (score === Infinity) return 'inf';
  if (score === -Infinity) return '-inf';
  return String(score);
}

function arity(args, min, max, name) {
  if (args.length < min || (max !== undefined && args.length > max)) throw new RedisError(`ERR wrong number of arguments for '${name}' command`);
}

function escapeRegex(ch) { return /[\\^$.|?*+()[\]{}]/.test(ch) ? `\\${ch}` : ch; }

function globToRegex(pattern) {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else if (c === '[') {
      let j = i + 1;
      let negate = false;
      if (pattern[j] === '^') { negate = true; j += 1; }
      let body = '';
      while (j < pattern.length && pattern[j] !== ']') {
        if (pattern[j] === '\\' && j + 1 < pattern.length) { body += `\\${pattern[j + 1]}`; j += 2; } else { body += pattern[j] === '\\' ? '\\\\' : pattern[j]; j += 1; }
      }
      if (j >= pattern.length) { out += '\\['; continue; }
      out += `[${negate ? '^' : ''}${body}]`;
      i = j;
    } else if (c === '\\' && i + 1 < pattern.length) { i += 1; out += escapeRegex(pattern[i]); } else out += escapeRegex(c);
  }
  return `${out}$`;
}

async function matchingKeys(ctx, pattern, type) {
  const typeClause = type ? ' and type = $2' : '';
  const params = type ? [null, type] : [null];
  let sql;
  if (/^[^*?[\\]*\*$/.test(pattern)) { params[0] = pattern.slice(0, -1); sql = `select key from kv_keys where starts_with(key, $1) and ${LIVE_SQL}${typeClause} order by key`; }
  else if (!/[*?[\\]/.test(pattern)) { params[0] = pattern; sql = `select key from kv_keys where key = $1 and ${LIVE_SQL}${typeClause}`; }
  else { params[0] = globToRegex(pattern); sql = `select key from kv_keys where key ~ $1 and ${LIVE_SQL}${typeClause} order by key`; }
  return (await ctx.q(sql, params)).map((row) => row.key);
}

// ---------- key bookkeeping ----------

async function typeOf(ctx, key) {
  const rows = await ctx.q('select type, (expires_at is not null and expires_at <= clock_timestamp()) as expired from kv_keys where key = $1', [key]);
  if (!rows.length) return null;
  if (rows[0].expired) {
    if (ctx.writable) await ctx.q('delete from kv_keys where key = $1', [key]);
    return null;
  }
  return rows[0].type;
}

// Returns true when the key exists as `type`, false when it does not exist, and throws for any other type.
async function has(ctx, key, type) {
  const found = await typeOf(ctx, key);
  if (!found) return false;
  if (found !== type) throw new RedisError(WRONGTYPE);
  return true;
}

async function createKey(ctx, key, type) { await ctx.q('insert into kv_keys (key, type) values ($1, $2)', [key, type]); }

async function dropIfEmpty(ctx, key, table) {
  await ctx.q(`delete from kv_keys where key = $1 and not exists (select 1 from ${table} where key = $1)`, [key]);
}

// ---------- command table ----------

const COMMANDS = Object.create(null);
const read = (run) => ({ write: false, run });
const write = (run, extra = {}) => ({ write: true, run, ...extra });

function define(names, spec) { for (const name of names.split(' ')) COMMANDS[name] = spec; }

// --- connection / server ---
define('PING', read(async (ctx, a) => (a.length ? a[0] : 'PONG')));
define('ECHO', read(async (ctx, a) => { arity(a, 1, 1, 'echo'); return a[0]; }));
define('DBSIZE', read(async (ctx) => Number((await ctx.q(`select count(*)::int as n from kv_keys where ${LIVE_SQL}`))[0].n)));
define('FLUSHALL FLUSHDB', write(async (ctx) => { await ctx.q('delete from kv_keys'); return 'OK'; }));

// --- keys ---
define('DEL UNLINK', write(async (ctx, a) => {
  arity(a, 1, undefined, 'del');
  let count = 0;
  for (const key of a) {
    const rows = await ctx.q(`delete from kv_keys where key = $1 returning ${LIVE_SQL} as live`, [key]);
    if (rows[0]?.live) count += 1;
  }
  return count;
}));

define('EXISTS', read(async (ctx, a) => {
  arity(a, 1, undefined, 'exists');
  let count = 0;
  for (const key of a) if (await typeOf(ctx, key)) count += 1;
  return count;
}));

define('TYPE', read(async (ctx, a) => { arity(a, 1, 1, 'type'); return (await typeOf(ctx, a[0])) || 'none'; }));

define('KEYS', read(async (ctx, a) => { arity(a, 1, 1, 'keys'); return matchingKeys(ctx, a[0]); }));

define('SCAN', read(async (ctx, a) => {
  arity(a, 1, undefined, 'scan');
  parseInteger(a[0], 'ERR invalid cursor');
  let pattern = '*';
  let type = null;
  for (let i = 1; i < a.length; i += 1) {
    const option = a[i].toUpperCase();
    if (option === 'MATCH') { pattern = a[i + 1]; i += 1; } else if (option === 'COUNT') { parseCount(a[i + 1]); i += 1; } else if (option === 'TYPE') { type = a[i + 1].toLowerCase(); i += 1; } else throw new RedisError(SYNTAX);
    if (a[i] === undefined) throw new RedisError(SYNTAX);
  }
  return ['0', await matchingKeys(ctx, pattern, type)];
}));

async function setExpiry(ctx, key, msFromNow, { nx, xx, gt, lt }) {
  const rows = await ctx.q(`select type, (expires_at is not null) as has_ttl, extract(epoch from (expires_at - clock_timestamp())) * 1000 as ms_left, (expires_at is not null and expires_at <= clock_timestamp()) as expired from kv_keys where key = $1`, [key]);
  if (!rows.length || rows[0].expired) return 0;
  const { has_ttl: hasTtl } = rows[0];
  const current = hasTtl ? Number(rows[0].ms_left) : Infinity;
  if (nx && hasTtl) return 0;
  if (xx && !hasTtl) return 0;
  if (gt && !(msFromNow > current)) return 0;
  if (lt && !(msFromNow < current)) return 0;
  if (msFromNow <= 0) { await ctx.q('delete from kv_keys where key = $1', [key]); return 1; }
  await ctx.q("update kv_keys set expires_at = clock_timestamp() + ($2::bigint * interval '1 millisecond') where key = $1", [key, String(Math.trunc(msFromNow))]);
  return 1;
}

function expireCommand(name, { unit, absolute }) {
  define(name, write(async (ctx, a) => {
    arity(a, 2, 3, name.toLowerCase());
    const flags = { nx: false, xx: false, gt: false, lt: false };
    if (a[2] !== undefined) {
      const flag = a[2].toLowerCase();
      if (!(flag in flags)) throw new RedisError(`ERR Unsupported option ${a[2]}`);
      flags[flag] = true;
    }
    let ms = Number(parseInteger(a[1])) * unit;
    if (absolute) ms -= Date.now();
    return setExpiry(ctx, a[0], ms, flags);
  }));
}
expireCommand('EXPIRE', { unit: 1000, absolute: false });
expireCommand('PEXPIRE', { unit: 1, absolute: false });
expireCommand('EXPIREAT', { unit: 1000, absolute: true });
expireCommand('PEXPIREAT', { unit: 1, absolute: true });

define('PERSIST', write(async (ctx, a) => {
  arity(a, 1, 1, 'persist');
  if (!(await typeOf(ctx, a[0]))) return 0;
  const rows = await ctx.q('update kv_keys set expires_at = null where key = $1 and expires_at is not null returning 1', [a[0]]);
  return rows.length ? 1 : 0;
}));

function ttlCommand(name, divisor) {
  define(name, read(async (ctx, a) => {
    arity(a, 1, 1, name.toLowerCase());
    const rows = await ctx.q('select (expires_at is not null) as has_ttl, extract(epoch from (expires_at - clock_timestamp())) * 1000 as ms_left, (expires_at is not null and expires_at <= clock_timestamp()) as expired from kv_keys where key = $1', [a[0]]);
    if (!rows.length || rows[0].expired) return -2;
    if (!rows[0].has_ttl) return -1;
    const ms = Math.max(0, Number(rows[0].ms_left));
    return divisor === 1 ? Math.round(ms) : Math.round(ms / divisor);
  }));
}
ttlCommand('TTL', 1000);
ttlCommand('PTTL', 1);

// --- strings ---
async function readString(ctx, key) {
  if (!(await has(ctx, key, 'string'))) return null;
  const rows = await ctx.q('select val from kv_strings where key = $1', [key]);
  return rows.length ? rows[0].val : null;
}

async function writeString(ctx, key, value, { ttlMs = null, keepTtl = false } = {}) {
  const existing = await typeOf(ctx, key);
  if (existing && existing !== 'string') await ctx.q('delete from kv_keys where key = $1', [key]);
  if (!existing || existing !== 'string') {
    await ctx.q(`insert into kv_keys (key, type, expires_at) values ($1, 'string', ${ttlMs === null ? 'null' : "clock_timestamp() + ($2::bigint * interval '1 millisecond')"})`, ttlMs === null ? [key] : [key, String(ttlMs)]);
  } else if (!keepTtl) {
    if (ttlMs === null) await ctx.q('update kv_keys set expires_at = null where key = $1', [key]);
    else await ctx.q("update kv_keys set expires_at = clock_timestamp() + ($2::bigint * interval '1 millisecond') where key = $1", [key, String(ttlMs)]);
  }
  await ctx.q('insert into kv_strings (key, val) values ($1, $2) on conflict (key) do update set val = excluded.val', [key, value]);
}

define('GET', read(async (ctx, a) => { arity(a, 1, 1, 'get'); return readString(ctx, a[0]); }));

define('MGET', read(async (ctx, a) => {
  arity(a, 1, undefined, 'mget');
  const out = [];
  for (const key of a) {
    const t = await typeOf(ctx, key);
    out.push(t === 'string' ? (await ctx.q('select val from kv_strings where key = $1', [key]))[0]?.val ?? null : null);
  }
  return out;
}));

define('SET', write(async (ctx, a) => {
  arity(a, 2, undefined, 'set');
  const key = a[0];
  const value = text(a[1]);
  let nx = false; let xx = false; let keepTtl = false; let get = false; let ttlMs = null;
  for (let i = 2; i < a.length; i += 1) {
    const option = a[i].toUpperCase();
    if (option === 'NX') nx = true;
    else if (option === 'XX') xx = true;
    else if (option === 'KEEPTTL') keepTtl = true;
    else if (option === 'GET') get = true;
    else if (['EX', 'PX', 'EXAT', 'PXAT'].includes(option)) {
      if (a[i + 1] === undefined) throw new RedisError(SYNTAX);
      const n = parseCount(a[i + 1]);
      i += 1;
      if (n <= 0) throw new RedisError("ERR invalid expire time in 'set' command");
      if (ttlMs !== null) throw new RedisError(SYNTAX);
      ttlMs = option === 'EX' ? n * 1000 : option === 'PX' ? n : option === 'EXAT' ? n * 1000 - Date.now() : n - Date.now();
    } else throw new RedisError(SYNTAX);
  }
  if ((nx && xx) || (keepTtl && ttlMs !== null)) throw new RedisError(SYNTAX);
  const existing = await typeOf(ctx, key);
  if (get && existing && existing !== 'string') throw new RedisError(WRONGTYPE);
  const old = get && existing === 'string' ? await readString(ctx, key) : null;
  if ((nx && existing) || (xx && !existing)) return get ? old : null;
  if (ttlMs !== null && ttlMs <= 0) { await ctx.q('delete from kv_keys where key = $1', [key]); return get ? old : 'OK'; }
  await writeString(ctx, key, value, { ttlMs, keepTtl });
  return get ? old : 'OK';
}));

define('SETNX', write(async (ctx, a) => {
  arity(a, 2, 2, 'setnx');
  if (await typeOf(ctx, a[0])) return 0;
  await writeString(ctx, a[0], text(a[1]));
  return 1;
}));

define('SETEX PSETEX', write(async (ctx, a) => {
  arity(a, 3, 3, 'setex');
  const n = parseCount(a[1]);
  if (n <= 0) throw new RedisError("ERR invalid expire time in 'setex' command");
  await writeString(ctx, a[0], text(a[2]), { ttlMs: n * 1000 });
  return 'OK';
}));
// PSETEX takes milliseconds, SETEX seconds: register it separately so the units are right.
define('PSETEX', write(async (ctx, a) => {
  arity(a, 3, 3, 'psetex');
  const n = parseCount(a[1]);
  if (n <= 0) throw new RedisError("ERR invalid expire time in 'psetex' command");
  await writeString(ctx, a[0], text(a[2]), { ttlMs: n });
  return 'OK';
}));

define('GETDEL', write(async (ctx, a) => {
  arity(a, 1, 1, 'getdel');
  const value = await readString(ctx, a[0]);
  if (value !== null) await ctx.q('delete from kv_keys where key = $1', [a[0]]);
  return value;
}));

function incrementCommand(name, sign) {
  define(name, write(async (ctx, a) => {
    const byAmount = name.endsWith('BY');
    arity(a, byAmount ? 2 : 1, byAmount ? 2 : 1, name.toLowerCase());
    const delta = (byAmount ? parseInteger(a[1]) : 1n) * sign;
    const current = await readString(ctx, a[0]);
    const base = current === null ? 0n : parseInteger(current);
    const next = base + delta;
    if (next > INT64_MAX || next < INT64_MIN) throw new RedisError('ERR increment or decrement would overflow');
    await writeString(ctx, a[0], next.toString(), { keepTtl: true });
    return Number(next);
  }));
}
incrementCommand('INCR', 1n);
incrementCommand('INCRBY', 1n);
incrementCommand('DECR', -1n);
incrementCommand('DECRBY', -1n);

// --- hashes ---
define('HGET', read(async (ctx, a) => {
  arity(a, 2, 2, 'hget');
  if (!(await has(ctx, a[0], 'hash'))) return null;
  const rows = await ctx.q('select val from kv_hashes where key = $1 and field = $2', [a[0], a[1]]);
  return rows.length ? rows[0].val : null;
}));

define('HMGET', read(async (ctx, a) => {
  arity(a, 2, undefined, 'hmget');
  const exists = await has(ctx, a[0], 'hash');
  const out = [];
  for (const field of a.slice(1)) {
    out.push(exists ? (await ctx.q('select val from kv_hashes where key = $1 and field = $2', [a[0], field]))[0]?.val ?? null : null);
  }
  return out;
}));

define('HGETALL', read(async (ctx, a) => {
  arity(a, 1, 1, 'hgetall');
  if (!(await has(ctx, a[0], 'hash'))) return [];
  const rows = await ctx.q('select field, val from kv_hashes where key = $1 order by seq', [a[0]]);
  return rows.flatMap((row) => [row.field, row.val]);
}));

define('HVALS', read(async (ctx, a) => {
  arity(a, 1, 1, 'hvals');
  if (!(await has(ctx, a[0], 'hash'))) return [];
  return (await ctx.q('select val from kv_hashes where key = $1 order by seq', [a[0]])).map((row) => row.val);
}));

define('HKEYS', read(async (ctx, a) => {
  arity(a, 1, 1, 'hkeys');
  if (!(await has(ctx, a[0], 'hash'))) return [];
  return (await ctx.q('select field from kv_hashes where key = $1 order by seq', [a[0]])).map((row) => row.field);
}));

define('HLEN', read(async (ctx, a) => {
  arity(a, 1, 1, 'hlen');
  if (!(await has(ctx, a[0], 'hash'))) return 0;
  return Number((await ctx.q('select count(*)::int as n from kv_hashes where key = $1', [a[0]]))[0].n);
}));

define('HEXISTS', read(async (ctx, a) => {
  arity(a, 2, 2, 'hexists');
  if (!(await has(ctx, a[0], 'hash'))) return 0;
  return (await ctx.q('select 1 from kv_hashes where key = $1 and field = $2', [a[0], a[1]])).length ? 1 : 0;
}));

async function hashWrite(ctx, key, pairs) {
  if (!(await has(ctx, key, 'hash'))) await createKey(ctx, key, 'hash');
  let created = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const rows = await ctx.q('insert into kv_hashes (key, field, val) values ($1, $2, $3) on conflict (key, field) do update set val = excluded.val returning (xmax = 0) as inserted', [key, text(pairs[i]), text(pairs[i + 1])]);
    if (rows[0].inserted) created += 1;
  }
  return created;
}

define('HSET', write(async (ctx, a) => {
  if (a.length < 3 || a.length % 2 === 0) throw new RedisError("ERR wrong number of arguments for 'hset' command");
  return hashWrite(ctx, a[0], a.slice(1));
}));

define('HMSET', write(async (ctx, a) => {
  if (a.length < 3 || a.length % 2 === 0) throw new RedisError("ERR wrong number of arguments for 'hmset' command");
  await hashWrite(ctx, a[0], a.slice(1));
  return 'OK';
}));

define('HSETNX', write(async (ctx, a) => {
  arity(a, 3, 3, 'hsetnx');
  if (!(await has(ctx, a[0], 'hash'))) await createKey(ctx, a[0], 'hash');
  const rows = await ctx.q('insert into kv_hashes (key, field, val) values ($1, $2, $3) on conflict (key, field) do nothing returning 1', [a[0], text(a[1]), text(a[2])]);
  if (!rows.length) await dropIfEmpty(ctx, a[0], 'kv_hashes');
  return rows.length ? 1 : 0;
}));

define('HDEL', write(async (ctx, a) => {
  arity(a, 2, undefined, 'hdel');
  if (!(await has(ctx, a[0], 'hash'))) return 0;
  let removed = 0;
  for (const field of a.slice(1)) removed += (await ctx.q('delete from kv_hashes where key = $1 and field = $2 returning 1', [a[0], field])).length;
  await dropIfEmpty(ctx, a[0], 'kv_hashes');
  return removed;
}));

define('HINCRBY', write(async (ctx, a) => {
  arity(a, 3, 3, 'hincrby');
  const delta = parseInteger(a[2]);
  const exists = await has(ctx, a[0], 'hash');
  let base = 0n;
  if (exists) {
    const rows = await ctx.q('select val from kv_hashes where key = $1 and field = $2', [a[0], a[1]]);
    if (rows.length) base = parseInteger(rows[0].val, 'ERR hash value is not an integer');
  }
  const next = base + delta;
  if (next > INT64_MAX || next < INT64_MIN) throw new RedisError('ERR increment or decrement would overflow');
  await hashWrite(ctx, a[0], [a[1], next.toString()]);
  return Number(next);
}));

// --- lists ---
function listRange(length, startText, stopText) {
  let start = parseCount(startText);
  let stop = parseCount(stopText);
  if (start < 0) start = length + start;
  if (stop < 0) stop = length + stop;
  if (start < 0) start = 0;
  if (start > stop || start >= length) return null;
  if (stop >= length) stop = length - 1;
  return { start, stop };
}

async function listLength(ctx, key) { return Number((await ctx.q('select count(*)::int as n from kv_lists where key = $1', [key]))[0].n); }

async function pushList(ctx, key, values, side) {
  arity([key, ...values], 2, undefined, side === 'left' ? 'lpush' : 'rpush');
  if (!(await has(ctx, key, 'list'))) await createKey(ctx, key, 'list');
  for (const value of values) {
    if (side === 'left') await ctx.q('insert into kv_lists (key, pos, val) values ($1, coalesce((select min(pos) from kv_lists where key = $1), 1) - 1, $2)', [key, text(value)]);
    else await ctx.q('insert into kv_lists (key, pos, val) values ($1, coalesce((select max(pos) from kv_lists where key = $1), -1) + 1, $2)', [key, text(value)]);
  }
  return listLength(ctx, key);
}
define('LPUSH', write((ctx, a) => pushList(ctx, a[0], a.slice(1), 'left')));
define('RPUSH', write((ctx, a) => pushList(ctx, a[0], a.slice(1), 'right')));

define('LLEN', read(async (ctx, a) => { arity(a, 1, 1, 'llen'); return (await has(ctx, a[0], 'list')) ? listLength(ctx, a[0]) : 0; }));

define('LRANGE', read(async (ctx, a) => {
  arity(a, 3, 3, 'lrange');
  if (!(await has(ctx, a[0], 'list'))) return [];
  const range = listRange(await listLength(ctx, a[0]), a[1], a[2]);
  if (!range) return [];
  return (await ctx.q('select val from kv_lists where key = $1 order by pos offset $2 limit $3', [a[0], range.start, range.stop - range.start + 1])).map((row) => row.val);
}));

define('LINDEX', read(async (ctx, a) => {
  arity(a, 2, 2, 'lindex');
  if (!(await has(ctx, a[0], 'list'))) return null;
  let index = parseCount(a[1]);
  const length = await listLength(ctx, a[0]);
  if (index < 0) index += length;
  if (index < 0 || index >= length) return null;
  return (await ctx.q('select val from kv_lists where key = $1 order by pos offset $2 limit 1', [a[0], index]))[0]?.val ?? null;
}));

define('LSET', write(async (ctx, a) => {
  arity(a, 3, 3, 'lset');
  if (!(await has(ctx, a[0], 'list'))) throw new RedisError('ERR no such key');
  let index = parseCount(a[1]);
  const length = await listLength(ctx, a[0]);
  if (index < 0) index += length;
  if (index < 0 || index >= length) throw new RedisError('ERR index out of range');
  await ctx.q('update kv_lists set val = $3 where key = $1 and pos = (select pos from kv_lists where key = $1 order by pos offset $2 limit 1)', [a[0], index, text(a[2])]);
  return 'OK';
}));

define('LTRIM', write(async (ctx, a) => {
  arity(a, 3, 3, 'ltrim');
  if (!(await has(ctx, a[0], 'list'))) return 'OK';
  const range = listRange(await listLength(ctx, a[0]), a[1], a[2]);
  if (!range) { await ctx.q('delete from kv_keys where key = $1', [a[0]]); return 'OK'; }
  await ctx.q('delete from kv_lists where key = $1 and pos not in (select pos from kv_lists where key = $1 order by pos offset $2 limit $3)', [a[0], range.start, range.stop - range.start + 1]);
  return 'OK';
}));

function popCommand(name, side) {
  define(name, write(async (ctx, a) => {
    arity(a, 1, 2, name.toLowerCase());
    if (!(await has(ctx, a[0], 'list'))) return null;
    const withCount = a[1] !== undefined;
    const count = withCount ? parseCount(a[1]) : 1;
    if (count < 0) throw new RedisError('ERR value is out of range, must be positive');
    const rows = await ctx.q(`delete from kv_lists where key = $1 and pos in (select pos from kv_lists where key = $1 order by pos ${side === 'left' ? 'asc' : 'desc'} limit $2) returning pos, val`, [a[0], count]);
    rows.sort((x, y) => (side === 'left' ? Number(BigInt(x.pos) - BigInt(y.pos)) : Number(BigInt(y.pos) - BigInt(x.pos))));
    await dropIfEmpty(ctx, a[0], 'kv_lists');
    if (!withCount) return rows.length ? rows[0].val : null;
    return rows.map((row) => row.val);
  }));
}
popCommand('LPOP', 'left');
popCommand('RPOP', 'right');

// --- sets ---
define('SADD', write(async (ctx, a) => {
  arity(a, 2, undefined, 'sadd');
  if (!(await has(ctx, a[0], 'set'))) await createKey(ctx, a[0], 'set');
  let added = 0;
  for (const member of a.slice(1)) added += (await ctx.q('insert into kv_sets (key, member) values ($1, $2) on conflict do nothing returning 1', [a[0], text(member)])).length;
  return added;
}));

define('SREM', write(async (ctx, a) => {
  arity(a, 2, undefined, 'srem');
  if (!(await has(ctx, a[0], 'set'))) return 0;
  let removed = 0;
  for (const member of a.slice(1)) removed += (await ctx.q('delete from kv_sets where key = $1 and member = $2 returning 1', [a[0], member])).length;
  await dropIfEmpty(ctx, a[0], 'kv_sets');
  return removed;
}));

define('SMEMBERS', read(async (ctx, a) => {
  arity(a, 1, 1, 'smembers');
  if (!(await has(ctx, a[0], 'set'))) return [];
  return (await ctx.q('select member from kv_sets where key = $1 order by seq', [a[0]])).map((row) => row.member);
}));

define('SISMEMBER', read(async (ctx, a) => {
  arity(a, 2, 2, 'sismember');
  if (!(await has(ctx, a[0], 'set'))) return 0;
  return (await ctx.q('select 1 from kv_sets where key = $1 and member = $2', [a[0], a[1]])).length ? 1 : 0;
}));

define('SCARD', read(async (ctx, a) => {
  arity(a, 1, 1, 'scard');
  if (!(await has(ctx, a[0], 'set'))) return 0;
  return Number((await ctx.q('select count(*)::int as n from kv_sets where key = $1', [a[0]]))[0].n);
}));

// --- sorted sets ---
define('ZADD', write(async (ctx, a) => {
  arity(a, 3, undefined, 'zadd');
  let i = 1;
  const flags = { nx: false, xx: false, gt: false, lt: false, ch: false };
  while (i < a.length && a[i].toLowerCase() in flags) { flags[a[i].toLowerCase()] = true; i += 1; }
  const rest = a.slice(i);
  if (!rest.length || rest.length % 2 !== 0) throw new RedisError(SYNTAX);
  if ((flags.nx && flags.xx) || (flags.nx && (flags.gt || flags.lt)) || (flags.gt && flags.lt)) throw new RedisError('ERR options are mutually exclusive');
  const pairs = [];
  for (let j = 0; j < rest.length; j += 2) pairs.push([parseScore(rest[j]).score, text(rest[j + 1])]);
  if (!(await has(ctx, a[0], 'zset'))) await createKey(ctx, a[0], 'zset');
  let added = 0; let changed = 0;
  for (const [score, member] of pairs) {
    const existing = await ctx.q('select score from kv_zsets where key = $1 and member = $2', [a[0], member]);
    if (!existing.length) {
      if (flags.xx) continue;
      await ctx.q('insert into kv_zsets (key, member, score) values ($1, $2, $3::float8)', [a[0], member, scoreText(score)]);
      added += 1; changed += 1;
    } else {
      const old = Number(existing[0].score);
      if (flags.nx) continue;
      if ((flags.gt && !(score > old)) || (flags.lt && !(score < old))) continue;
      if (score !== old) { await ctx.q('update kv_zsets set score = $3::float8 where key = $1 and member = $2', [a[0], member, scoreText(score)]); changed += 1; }
    }
  }
  await dropIfEmpty(ctx, a[0], 'kv_zsets');
  return flags.ch ? changed : added;
}));

define('ZREM', write(async (ctx, a) => {
  arity(a, 2, undefined, 'zrem');
  if (!(await has(ctx, a[0], 'zset'))) return 0;
  let removed = 0;
  for (const member of a.slice(1)) removed += (await ctx.q('delete from kv_zsets where key = $1 and member = $2 returning 1', [a[0], member])).length;
  await dropIfEmpty(ctx, a[0], 'kv_zsets');
  return removed;
}));

define('ZCARD', read(async (ctx, a) => {
  arity(a, 1, 1, 'zcard');
  if (!(await has(ctx, a[0], 'zset'))) return 0;
  return Number((await ctx.q('select count(*)::int as n from kv_zsets where key = $1', [a[0]]))[0].n);
}));

define('ZSCORE', read(async (ctx, a) => {
  arity(a, 2, 2, 'zscore');
  if (!(await has(ctx, a[0], 'zset'))) return null;
  const rows = await ctx.q('select score from kv_zsets where key = $1 and member = $2', [a[0], a[1]]);
  return rows.length ? scoreText(Number(rows[0].score)) : null;
}));

const ZORDER = 'score asc, member collate "C" asc';
const ZORDER_REV = 'score desc, member collate "C" desc';

async function zsetByIndex(ctx, key, startText, stopText, { reverse, withScores }) {
  if (!(await has(ctx, key, 'zset'))) return [];
  const length = Number((await ctx.q('select count(*)::int as n from kv_zsets where key = $1', [key]))[0].n);
  const range = listRange(length, startText, stopText);
  if (!range) return [];
  const rows = await ctx.q(`select member, score from kv_zsets where key = $1 order by ${reverse ? ZORDER_REV : ZORDER} offset $2 limit $3`, [key, range.start, range.stop - range.start + 1]);
  return rows.flatMap((row) => (withScores ? [row.member, scoreText(Number(row.score))] : [row.member]));
}

define('ZRANGE', read(async (ctx, a) => {
  arity(a, 3, undefined, 'zrange');
  let withScores = false; let reverse = false;
  for (const option of a.slice(3)) {
    const o = option.toUpperCase();
    if (o === 'WITHSCORES') withScores = true; else if (o === 'REV') reverse = true; else throw new RedisError(SYNTAX);
  }
  return zsetByIndex(ctx, a[0], a[1], a[2], { reverse, withScores });
}));

define('ZREVRANGE', read(async (ctx, a) => {
  arity(a, 3, 4, 'zrevrange');
  if (a[3] !== undefined && a[3].toUpperCase() !== 'WITHSCORES') throw new RedisError(SYNTAX);
  return zsetByIndex(ctx, a[0], a[1], a[2], { reverse: true, withScores: a[3] !== undefined });
}));

async function zsetByScore(ctx, a, { reverse }) {
  arity(a, 3, undefined, reverse ? 'zrevrangebyscore' : 'zrangebyscore');
  const lowArg = reverse ? a[2] : a[1];
  const highArg = reverse ? a[1] : a[2];
  const low = parseScore(lowArg, { allowExclusive: true });
  const high = parseScore(highArg, { allowExclusive: true });
  let withScores = false; let offset = 0; let count = null;
  for (let i = 3; i < a.length; i += 1) {
    const o = a[i].toUpperCase();
    if (o === 'WITHSCORES') withScores = true;
    else if (o === 'LIMIT') { offset = parseCount(a[i + 1]); count = parseCount(a[i + 2]); i += 2; if (a[i] === undefined) throw new RedisError(SYNTAX); } else throw new RedisError(SYNTAX);
  }
  if (!(await has(ctx, a[0], 'zset'))) return [];
  const rows = await ctx.q(
    `select member, score from kv_zsets where key = $1 and score ${low.exclusive ? '>' : '>='} $2::float8 and score ${high.exclusive ? '<' : '<='} $3::float8 order by ${reverse ? ZORDER_REV : ZORDER} offset $4 limit ${count === null || count < 0 ? 'all' : '$5'}`,
    count === null || count < 0 ? [a[0], scoreText(low.score), scoreText(high.score), offset] : [a[0], scoreText(low.score), scoreText(high.score), offset, count],
  );
  return rows.flatMap((row) => (withScores ? [row.member, scoreText(Number(row.score))] : [row.member]));
}
define('ZRANGEBYSCORE', read((ctx, a) => zsetByScore(ctx, a, { reverse: false })));
define('ZREVRANGEBYSCORE', read((ctx, a) => zsetByScore(ctx, a, { reverse: true })));

// --- scripting ---
define('EVAL', write(async (ctx, a) => {
  arity(a, 2, undefined, 'eval');
  const numKeys = parseInteger(a[1], 'ERR value is not an integer or out of range');
  if (numKeys < 0n) throw new RedisError("ERR Number of keys can't be negative");
  const rest = a.slice(2);
  if (numKeys > BigInt(rest.length)) throw new RedisError("ERR Number of keys can't be greater than number of args");
  const n = Number(numKeys);
  try {
    return await runScript(a[0], {
      keys: rest.slice(0, n),
      argv: rest.slice(n),
      redisCall: (argv) => execute(ctx, argv, { insideScript: true }),
    });
  } catch (error) {
    if (error instanceof RedisError) throw error;
    if (error instanceof LuaError || error instanceof ScriptReplyError) throw new RedisError(`ERR ${error.message}`);
    throw error;
  }
}));

// ---------- dispatch ----------

function normalizeArgs(argv) {
  if (!Array.isArray(argv) || !argv.length) throw new RedisError('ERR empty command');
  return argv.map((item) => {
    if (typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return String(item);
    throw new RedisError('ERR invalid command argument');
  });
}

function lookup(verb) {
  const spec = COMMANDS[verb.toUpperCase()];
  if (!spec) throw new RedisError(`ERR unknown command '${verb}'`);
  return spec;
}

async function execute(ctx, argv, { insideScript = false } = {}) {
  const args = normalizeArgs(argv);
  const verb = args[0].toUpperCase();
  if (insideScript && verb === 'EVAL') throw new RedisError('ERR This Redis command is not allowed from script');
  const spec = lookup(verb);
  if (spec.write && !ctx.writable) throw new RedisError('ERR write command not allowed here');
  return spec.run(ctx, args.slice(1));
}

export function createStore(db, { purgeChance = 0.02 } = {}) {
  async function command(argv) {
    const args = normalizeArgs(argv);
    const spec = lookup(args[0]);
    await ensureSchema(db);
    const result = await db.transaction(
      (q) => spec.run({ q, writable: spec.write }, args.slice(1)),
      spec.write ? { write: true } : { readOnly: true },
    );
    if (spec.write && Math.random() < purgeChance) purgeExpired().catch(() => {});
    return result;
  }

  // Not atomic across commands, like Upstash's /pipeline: each command runs on its own and reports its own error.
  async function pipeline(commands) {
    const out = [];
    for (const item of commands) {
      try { out.push({ result: await command(item) }); } catch (error) { out.push({ error: error.message }); }
    }
    return out;
  }

  // Atomic, like MULTI/EXEC: all commands run under one lock, in order, in one transaction.
  async function multiExec(commands) {
    await ensureSchema(db);
    return db.transaction(async (q) => {
      const ctx = { q, writable: true };
      const out = [];
      for (const item of commands) {
        try { out.push({ result: await execute(ctx, item) }); } catch (error) {
          if (!(error instanceof RedisError)) throw error;
          out.push({ error: error.message });
        }
      }
      return out;
    }, { write: true });
  }

  async function purgeExpired() {
    await ensureSchema(db);
    return db.transaction(async (q) => (await q('delete from kv_keys where expires_at is not null and expires_at <= clock_timestamp() returning key')).length, { write: true });
  }

  return { command, pipeline, multiExec, purgeExpired };
}

export { formatG };
