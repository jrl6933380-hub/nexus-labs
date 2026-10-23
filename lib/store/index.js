// The process-wide store, backed by the Postgres database named in NEXUS_DATABASE_URL (falling back to DATABASE_URL).
import { createStore } from './redisOnPg.js';
import { createPgDb } from './pgDb.js';

let dbSingleton = null;
let singleton = null;
let singletonUrl = null;
const FORCED = Symbol('forced');

export function databaseUrl(env = process.env) {
  return String(env.NEXUS_DATABASE_URL || env.DATABASE_URL || '').trim();
}

export function getDb(env = process.env) {
  const url = databaseUrl(env);
  if (!url) return null;
  if (!dbSingleton || dbSingleton.url !== url) dbSingleton = { url, db: createPgDb(url) };
  return dbSingleton.db;
}

export function setDbForTests(db) { dbSingleton = db ? { url: databaseUrl() || 'test', db } : null; }

export function getStore(env = process.env) {
  const url = databaseUrl(env);
  if (!url) return null;
  if (singletonUrl === FORCED) return singleton;
  if (!singleton || singletonUrl !== url) {
    singleton = createStore(getDb(env));
    singletonUrl = url;
  }
  return singleton;
}

export function setStoreForTests(store) { singleton = store; singletonUrl = store ? FORCED : null; }
