// A small PostgREST-compatible layer over Postgres, covering exactly the calls the app makes to Supabase
// (`/rest/v1/<table>` with eq/neq/lt/lte/gt/gte/in/is filters, select, order, limit, on_conflict, and the
// Prefer: return=representation | resolution=merge-duplicates | resolution=ignore-duplicates headers).
// Output is built with json_agg, so numbers, timestamps and jsonb come back in the same shapes PostgREST returns.

const IDENT = /^[a-z_][a-z0-9_]*$/u;
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
const OPS = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' };

class RestError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const q = (name) => {
  if (!IDENT.test(name)) throw new RestError(400, `Invalid identifier: ${name}`, 'PGRST100');
  return `"${name}"`;
};

function parseList(text) {
  // "(a,b,"c d")" -> ['a','b','c d']
  const inner = text.replace(/^\(/u, '').replace(/\)$/u, '');
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of inner) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (inner.length) out.push(cur);
  return out;
}

function buildWhere(searchParams, params, tbl) {
  const clauses = [];
  for (const [key, raw] of searchParams) {
    if (RESERVED.has(key)) continue;
    const dot = raw.indexOf('.');
    if (dot < 0) throw new RestError(400, `Bad filter on ${key}`, 'PGRST100');
    let op = raw.slice(0, dot);
    let value = raw.slice(dot + 1);
    let negate = false;
    if (op === 'not') {
      negate = true;
      const next = value.indexOf('.');
      op = value.slice(0, next);
      value = value.slice(next + 1);
    }
    const col = `${tbl}.${q(key)}`;
    let clause;
    if (OPS[op]) {
      params.push(value);
      clause = `${col} ${OPS[op]} $${params.length}`;
    } else if (op === 'in') {
      params.push(`{${parseList(value).map((v) => `"${v.replace(/([\\"])/gu, '\\$1')}"`).join(',')}}`);
      clause = `${col} = any($${params.length})`;
    } else if (op === 'is') {
      const v = value.toLowerCase();
      if (!['null', 'true', 'false'].includes(v)) throw new RestError(400, `Bad is. value on ${key}`, 'PGRST100');
      clause = `${col} is ${v}`;
    } else {
      throw new RestError(400, `Unsupported operator ${op}`, 'PGRST100');
    }
    clauses.push(negate ? `not (${clause})` : clause);
  }
  return clauses.length ? ` where ${clauses.join(' and ')}` : '';
}

function buildSelect(searchParams) {
  const select = searchParams.get('select');
  if (!select || select === '*') return '*';
  if (/[()!:]/u.test(select)) throw new RestError(400, 'Embedded selects are not supported', 'PGRST100');
  return select.split(',').map((c) => q(c.trim())).join(', ');
}

function buildOrder(searchParams) {
  const order = searchParams.get('order');
  if (!order) return '';
  return ` order by ${order.split(',').map((part) => {
    const [col, ...mods] = part.split('.');
    let sql = q(col);
    if (mods.includes('desc')) sql += ' desc'; else sql += ' asc';
    if (mods.includes('nullsfirst')) sql += ' nulls first';
    if (mods.includes('nullslast')) sql += ' nulls last';
    return sql;
  }).join(', ')}`;
}

function rowsOf(body) {
  const rows = Array.isArray(body) ? body : [body];
  if (!rows.length || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
    throw new RestError(400, 'Body must be a JSON object or an array of objects', 'PGRST102');
  }
  return rows;
}

const parsed = (j) => (typeof j === 'string' ? JSON.parse(j) : j);

export function parsePrefer(header) {
  const prefs = {};
  for (const part of String(header || '').split(',')) {
    const [k, v] = part.trim().split('=');
    if (k) prefs[k] = v;
  }
  return prefs;
}

// Returns { status, body } where body is a JSON-serialisable value or null.
export async function handleRestRequest(db, { method, table, searchParams, prefer, bodyText }) {
  const prefs = parsePrefer(prefer);
  const tbl = q(table);
  const wantRows = prefs.return === 'representation';
  const params = [];
  let body;
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch { throw new RestError(400, 'Invalid JSON body', 'PGRST102'); }
  }

  if (method === 'GET' || method === 'HEAD') {
    const where = buildWhere(searchParams, params, tbl);
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');
    let tail = buildOrder(searchParams);
    if (limit !== null) { params.push(Number(limit)); tail += ` limit $${params.length}`; }
    if (offset !== null) { params.push(Number(offset)); tail += ` offset $${params.length}`; }
    const sql = `select coalesce(json_agg(t), '[]'::json) as j from (select ${buildSelect(searchParams)} from ${tbl}${where}${tail}) t`;
    const rows = await db.transaction((run) => run(sql, params), { readOnly: true });
    return { status: 200, body: parsed(rows[0].j) };
  }

  if (method === 'POST') {
    const rows = rowsOf(body);
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    if (!cols.length) throw new RestError(400, 'Empty insert', 'PGRST102');
    const colSql = cols.map(q).join(', ');
    params.push(JSON.stringify(rows));
    let conflict = '';
    const onConflict = searchParams.get('on_conflict');
    if (onConflict && prefs.resolution) {
      const keys = onConflict.split(',').map((c) => c.trim());
      const target = keys.map(q).join(', ');
      if (prefs.resolution === 'ignore-duplicates') conflict = ` on conflict (${target}) do nothing`;
      else if (prefs.resolution === 'merge-duplicates') {
        const sets = cols.filter((c) => !keys.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`);
        conflict = sets.length ? ` on conflict (${target}) do update set ${sets.join(', ')}` : ` on conflict (${target}) do nothing`;
      }
    } else if (prefs.resolution === 'ignore-duplicates') {
      conflict = ' on conflict do nothing';
    }
    const insert = `insert into ${tbl} (${colSql}) select ${colSql} from jsonb_populate_recordset(null::${tbl}, $1::jsonb)${conflict}`;
    const sql = wantRows
      ? `with r as (${insert} returning *) select coalesce(json_agg(r), '[]'::json) as j from r`
      : insert;
    const out = await db.transaction((run) => run(sql, params));
    return { status: 201, body: wantRows ? parsed(out[0].j) : null };
  }

  if (method === 'PATCH') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RestError(400, 'Body must be a JSON object', 'PGRST102');
    const cols = Object.keys(body);
    if (!cols.length) throw new RestError(400, 'Empty update', 'PGRST102');
    params.push(JSON.stringify(body));
    const sets = cols.map((c) => `${q(c)} = _p.${q(c)}`).join(', ');
    const where = buildWhere(searchParams, params, tbl);
    const update = `update ${tbl} set ${sets} from jsonb_populate_record(null::${tbl}, $1::jsonb) as _p${where}`;
    const sql = wantRows
      ? `with r as (${update} returning ${tbl}.*) select coalesce(json_agg(r), '[]'::json) as j from r`
      : update;
    const out = await db.transaction((run) => run(sql, params));
    return wantRows ? { status: 200, body: parsed(out[0].j) } : { status: 204, body: null };
  }

  if (method === 'DELETE') {
    const where = buildWhere(searchParams, params, tbl);
    if (!where) throw new RestError(400, 'DELETE requires a filter', 'PGRST100');
    const del = `delete from ${tbl}${where}`;
    const sql = wantRows
      ? `with r as (${del} returning ${tbl}.*) select coalesce(json_agg(r), '[]'::json) as j from r`
      : del;
    const out = await db.transaction((run) => run(sql, params));
    return wantRows ? { status: 200, body: parsed(out[0].j) } : { status: 204, body: null };
  }

  throw new RestError(405, `Method ${method} not supported`, 'PGRST000');
}

export function restErrorResponse(error) {
  if (error instanceof RestError) return { status: error.status, body: { code: error.code, message: error.message } };
  const message = String(error?.message || error);
  const code = error?.code || /ERROR (\w{5}):/u.exec(message)?.[1];
  if (code === '42P01') return { status: 404, body: { code, message } };
  if (code === '23505') return { status: 409, body: { code, message } };
  if (typeof code === 'string' && /^(22|23|42)/u.test(code)) return { status: 400, body: { code, message } };
  return { status: 500, body: { code, message } };
}
