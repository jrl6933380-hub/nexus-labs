// test/helpers/fake-redis.mjs
//
// A small in-memory stand-in for the Upstash/Redis `command` interface used
// by lib/roomMetering.js.
//
// This exists as ONE shared helper on purpose. It used to be copy-pasted
// into each metering test file ("duplicated here rather than imported since
// it is a private test helper"), and the copies then drifted: CLEANUP,
// RESERVE and SETTLE were implemented, but when GLOBAL_SPEND_SCRIPT and
// GRANT_SCRIPT were added to lib/roomMetering.js nothing taught the fakes
// about them. Every metering test that touched the daily pool, the global
// ceiling, or a credit grant then died on "Unexpected fake Redis command:
// EVAL" — which meant the credit system (reservations, ceilings, rollbacks,
// refunds, owner exemption) had no effective test coverage at all.
//
// Structured as real primitives (hashes / strings / sorted sets) with EVAL
// dispatching to a JS transcription of each Lua script, so the fake behaves
// like Redis rather than like a bag of special cases. If a new script is
// added to roomMetering.js, add it here once and every metering test file
// gets it.
import {
  CLEANUP_SCRIPT,
  RESERVE_SCRIPT,
  SETTLE_SCRIPT,
  GLOBAL_SPEND_SCRIPT,
  GRANT_SCRIPT,
} from '../../lib/roomMetering.js';

export function fakeRedis() {
  const hashes = new Map();   // key -> Map(field -> value)
  const strings = new Map();  // key -> value   (reservation keys, counters)
  const zsets = new Map();    // key -> Map(member -> score)

  const hashFor = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  const zsetFor = (key) => {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key);
  };
  const num = (value) => Number(value || 0);

  const hget = (key, field) => hashes.get(key)?.get(field) ?? null;
  const hset = (key, ...pairs) => {
    const hash = hashFor(key);
    for (let i = 0; i < pairs.length; i += 2) hash.set(String(pairs[i]), pairs[i + 1]);
  };
  const hincrby = (key, field, delta) => {
    const hash = hashFor(key);
    const next = num(hash.get(field)) + Number(delta);
    hash.set(field, next);
    return next;
  };
  // ZRANGEBYSCORE key -inf <max> — members scoring at or below max.
  const zrangebyscore = (key, max) => [...zsetFor(key)]
    .filter(([, score]) => score <= Number(max))
    .sort((a, b) => a[1] - b[1])
    .map(([member]) => member);

  // --- Lua scripts, transcribed ---------------------------------------

  // Release any reservation whose expiry has passed, returning its held
  // credits to the meter. KEYS: usage, index. ARGV: timestamp.
  function cleanup(usageKey, indexKey, timestamp) {
    const expired = zrangebyscore(indexKey, timestamp);
    for (const reservationKey of expired) {
      const amount = num(strings.get(reservationKey));
      if (amount > 0) hincrby(usageKey, 'reserved', -amount);
      strings.delete(reservationKey);
      zsetFor(indexKey).delete(reservationKey);
    }
    return expired.length;
  }

  function reserve({ usageKey, reservationKey, indexKey, requested, limit, timestamp, expiresAt }) {
    cleanup(usageKey, indexKey, timestamp);
    // Idempotency: the same request id must not reserve twice.
    const existing = strings.get(reservationKey);
    if (existing !== undefined) return Number(existing);
    const consumed = num(hget(usageKey, 'consumed'));
    const reserved = num(hget(usageKey, 'reserved'));
    if (consumed + reserved + requested > limit) return 0;
    hset(usageKey, 'limit', limit, 'updatedAt', timestamp);
    hincrby(usageKey, 'reserved', requested);
    strings.set(reservationKey, requested);
    zsetFor(indexKey).set(reservationKey, Number(expiresAt));
    return requested;
  }

  function settle({ usageKey, reservationKey, indexKey, charge, timestamp }) {
    const reserved = num(strings.get(reservationKey));
    if (reserved <= 0) return 0;
    const capped = Math.min(Math.max(0, Number(charge) || 0), reserved);
    hincrby(usageKey, 'reserved', -reserved);
    if (capped > 0) hincrby(usageKey, 'consumed', capped);
    hset(usageKey, 'updatedAt', timestamp);
    strings.delete(reservationKey);
    zsetFor(indexKey).delete(reservationKey);
    return capped;
  }

  function globalSpend(key, amount) {
    const total = num(strings.get(key)) + Number(amount);
    strings.set(key, total);
    return total;
  }

  // A fulfilled credit pack lowers 'consumed' (never below zero) rather
  // than raising 'limit', which reserve overwrites on every call.
  function grant(usageKey, amount, timestamp) {
    const updated = Math.max(0, num(hget(usageKey, 'consumed')) - Number(amount));
    hset(usageKey, 'consumed', updated, 'updatedAt', timestamp);
    return updated;
  }

  return {
    hashes,
    strings,
    zsets,
    // Back-compat alias: the previous per-file fakes exposed reservation
    // keys as `reservations`, and some assertions still read it.
    reservations: strings,
    counters: strings,

    async command(command) {
      const [verb] = command;

      if (verb === 'EVAL') {
        const script = command[1];
        // command = ['EVAL', script, numKeys, ...KEYS, ...ARGV]
        const numKeys = Number(command[2]);
        const keys = command.slice(3, 3 + numKeys);
        const argv = command.slice(3 + numKeys);

        if (script === CLEANUP_SCRIPT) return cleanup(keys[0], keys[1], Number(argv[0]));
        if (script === RESERVE_SCRIPT) {
          return reserve({
            usageKey: keys[0],
            reservationKey: keys[1],
            indexKey: keys[2],
            requested: Number(argv[0]),
            limit: Number(argv[1]),
            timestamp: Number(argv[3]),
            expiresAt: Number(argv[4]),
          });
        }
        if (script === SETTLE_SCRIPT) {
          return settle({
            usageKey: keys[0],
            reservationKey: keys[1],
            indexKey: keys[2],
            charge: Number(argv[0]),
            timestamp: Number(argv[1]),
          });
        }
        if (script === GLOBAL_SPEND_SCRIPT) return globalSpend(keys[0], Number(argv[0]));
        if (script === GRANT_SCRIPT) return grant(keys[0], Number(argv[0]), Number(argv[1]));
        throw new Error('Fake Redis has no transcription for this EVAL script. Add it to test/helpers/fake-redis.mjs.');
      }

      switch (verb) {
        case 'HMGET':
          return command.slice(2).map((field) => hget(command[1], field));
        case 'HGET':
          return hget(command[1], command[2]);
        case 'HSET':
          hset(command[1], ...command.slice(2));
          return 1;
        case 'HINCRBY':
          return hincrby(command[1], command[2], Number(command[3]));
        case 'GET':
          return strings.has(command[1]) ? strings.get(command[1]) : null;
        case 'SET':
          strings.set(command[1], command[2]);
          return 'OK';
        case 'DEL':
          return (strings.delete(command[1]) || hashes.delete(command[1])) ? 1 : 0;
        case 'INCRBY':
          return globalSpend(command[1], Number(command[2]));
        case 'ZADD':
          zsetFor(command[1]).set(command[3], Number(command[2]));
          return 1;
        case 'ZREM':
          return zsetFor(command[1]).delete(command[2]) ? 1 : 0;
        case 'ZRANGEBYSCORE':
          return zrangebyscore(command[1], command[3]);
        case 'EXPIRE':
          return 1; // TTL is not modelled; nothing under test depends on it.
        default:
          throw new Error('Unexpected fake Redis command: ' + verb);
      }
    },
  };
}
