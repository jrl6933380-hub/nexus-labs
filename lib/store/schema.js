// Postgres tables that hold what used to live in Redis. One registry table (kv_keys) records each key's type and
// expiry; the value tables hold the data and cascade-delete with their key. Everything is idempotent, so running
// it on every cold start is safe.

export const SCHEMA_LOCK = 727000; // advisory lock so two cold starts don't create the tables at the same moment

export const SCHEMA_SQL = `
create table if not exists kv_keys (
  key text primary key,
  type text not null check (type in ('string','hash','list','set','zset')),
  expires_at timestamptz
);
create index if not exists kv_keys_expires_idx on kv_keys (expires_at) where expires_at is not null;

create table if not exists kv_strings (
  key text primary key references kv_keys(key) on delete cascade,
  val text not null
);

create table if not exists kv_hashes (
  key text not null references kv_keys(key) on delete cascade,
  field text not null,
  val text not null,
  seq bigint generated always as identity,
  primary key (key, field)
);

create table if not exists kv_lists (
  key text not null references kv_keys(key) on delete cascade,
  pos bigint not null,
  val text not null,
  primary key (key, pos)
);

create table if not exists kv_sets (
  key text not null references kv_keys(key) on delete cascade,
  member text not null,
  seq bigint generated always as identity,
  primary key (key, member)
);

create table if not exists kv_zsets (
  key text not null references kv_keys(key) on delete cascade,
  member text not null,
  score double precision not null,
  primary key (key, member)
);
create index if not exists kv_zsets_score_idx on kv_zsets (key, score);
`;

let ready = null;

// Creates the tables once per process. `db.transaction(fn)` must run fn inside BEGIN/COMMIT.
export function ensureSchema(db) {
  if (!ready) {
    ready = db.transaction(async (q) => {
      await q('select pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
      await q(SCHEMA_SQL);
    }).catch((error) => { ready = null; throw error; });
  }
  return ready;
}

export function resetSchemaCacheForTests() { ready = null; }
