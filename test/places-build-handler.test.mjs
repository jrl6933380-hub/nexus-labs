import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForgePlacesBuildHandler } from '../api/forge-places-build.js';

const lead = { name: 'Baghdad Barber Shop', address: '5806 Franklin Ave, Des Moines, IA', phone: '(773) 807-6741', rating: 5, reviewCount: 228, status: 'no_dedicated_site_found' };
const req = () => ({ method: 'POST', headers: { origin: 'https://x.test', host: 'x.test', 'content-type': 'application/json' }, body: { business: 'barber', city: 'Des Moines, Iowa', lead } });
const res = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

test('default save is wired: the handler really calls saveBuiltLead when none is injected', async () => {
  // No `save` injected. With no store configured the real saver must fail cleanly, not throw a ReferenceError.
  const r = res(), errors = [], orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try { await createForgePlacesBuildHandler({ resolveAccount: async () => ({ owner: true, username: 'justin' }) })(req(), r); } finally { console.error = orig; }
  assert.equal(errors.filter(e => /not defined|is not a function/.test(e)).length, 0, errors.join(' | '));
  assert.equal(r.code, 200);
  assert.equal(r.body.previews.length, 3);
  assert.ok(['saved', 'already', 'skipped', 'failed'].includes(r.body.saved.status));
});

test('passes the built lead to save and returns its result', async () => {
  const calls = [];
  const r = res();
  await createForgePlacesBuildHandler({ resolveAccount: async () => ({ owner: true, username: 'justin' }), save: async a => { calls.push(a); return { status: 'saved', message: 'ok' }; } })(req(), r);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lead.phone, '(773) 807-6741');
  assert.equal(calls[0].createdBy, 'justin');
  assert.equal(r.body.saved.status, 'saved');
});

test('a save error is reported as failed but the build still returns', async () => {
  const r = res();
  await createForgePlacesBuildHandler({ resolveAccount: async () => ({ owner: true }), save: async () => { throw new Error('redis down'); } })(req(), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.saved.status, 'failed');
  assert.equal(r.body.previews.length, 3);
});

test('non-owner is refused', async () => {
  const r = res();
  await createForgePlacesBuildHandler({ resolveAccount: async () => ({ owner: false }) })(req(), r);
  assert.equal(r.code, 403);
});
