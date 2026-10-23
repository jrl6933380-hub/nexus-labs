// Postgres adapter for the store: `transaction(fn, opts)` hands fn a `q(sql, params) -> rows` function that runs
// inside one BEGIN/COMMIT. Writers take one global advisory lock first so they run one at a time (Redis semantics).
import { WRITE_LOCK } from './redisOnPg.js';

// `connect()` resolves to { query(sql, params) -> { rows }, release(destroy?) }. Real use: a `pg` pool. Tests: a wire client.
export function makeDb(connect) {
  async function transaction(fn, { write = false, readOnly = false } = {}) {
    const client = await connect();
    let broken = false;
    try {
      await client.query(readOnly ? 'BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
      try {
        if (write) await client.query('select pg_advisory_xact_lock($1)', [WRITE_LOCK]);
        const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { broken = true; }
        throw error;
      }
    } finally {
      client.release(broken);
    }
  }
  return { transaction };
}

export function createPgDb(connectionString, { max = 4 } = {}) {
  let pool = null;
  async function getPool() {
    if (!pool) {
      const mod = await import('pg');
      const Pool = (mod.default || mod).Pool;
      pool = new Pool({ connectionString, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
      pool.on('error', () => {});
    }
    return pool;
  }
  return makeDb(async () => (await getPool()).connect());
}
