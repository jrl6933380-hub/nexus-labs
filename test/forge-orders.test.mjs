import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveOrder, listOrders, setOrderStatus } from '../lib/forgeOrders.js';
import { createForgeOrdersHandler } from '../api/forge-orders.js';

const hash = () => { const h = new Map(); return async c => { if (c[0] === 'HSET') { h.set(c[2], c[3]); return 1; } if (c[0] === 'HGET') return h.get(c[2]) ?? null; if (c[0] === 'HGETALL') return [...h].flat(); } };
const lead = { id: 'l1', businessName: 'Shop', phone: '555', category: 'barber', location: 'DSM', assignedTo: 'caller01', siteVariants: [{ id: 'bold', label: 'Bold' }, { id: 'fresh', label: 'Fresh' }], siteContent: { headline: 'H', photos: [] }, sitePalette: 'sky' };
const res = () => { const r = { setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (method, body) => ({ method, headers: { origin: 'https://x.test', host: 'x.test' }, body });

test('order stores the picked look, notes and a snapshot; resaving keeps status and createdAt', async () => {
  const redis = hash(); let t = 1;
  const a = await saveOrder(lead, { lookId: 'fresh', notes: 'make it green', by: 'caller01' }, { redis, now: () => t++ });
  assert.equal(a.order.lookLabel, 'Fresh'); assert.equal(a.order.sitePalette, 'sky'); assert.equal(a.order.status, 'new');
  await setOrderStatus('l1', 'building', { redis });
  const b = await saveOrder(lead, { lookId: 'bold', notes: 'x', by: 'caller01' }, { redis, now: () => t++ });
  assert.equal(b.order.status, 'building'); assert.equal(b.order.createdAt, a.order.createdAt);
  assert.equal((await listOrders({ redis })).length, 1);
});

test('rejects an unknown look and an unknown status', async () => {
  const redis = hash();
  assert.ok((await saveOrder(lead, { lookId: 'nope' }, { redis })).error);
  assert.ok((await setOrderStatus('l1', 'weird', { redis })).error);
});

test('API: callers save only for their own lead and see only summaries; managers see all and set status', async () => {
  const redis = hash();
  const d = { worker: async () => true, lead: async () => lead, save: (l, o) => saveOrder(l, o, { redis }), list: () => listOrders({ redis }), setStatus: (id, s) => setOrderStatus(id, s, { redis }) };
  let r = res(); await createForgeOrdersHandler({ ...d, user: async () => 'other', manager: async () => false })(req('POST', { leadId: 'l1', lookId: 'bold' }), r); assert.equal(r.code, 403);
  r = res(); await createForgeOrdersHandler({ ...d, user: async () => 'caller01', manager: async () => false })(req('POST', { leadId: 'l1', lookId: 'bold', notes: 'n' }), r); assert.equal(r.code, 200);
  r = res(); await createForgeOrdersHandler({ ...d, user: async () => 'caller01', manager: async () => false })({ method: 'GET', headers: {} }, r);
  assert.deepEqual(Object.keys(r.body.orders[0]).sort(), ['leadId', 'lookLabel', 'status', 'updatedAt']);
  r = res(); await createForgeOrdersHandler({ ...d, user: async () => 'caller01', manager: async () => false })(req('PATCH', { leadId: 'l1', status: 'live' }), r); assert.equal(r.code, 403);
  r = res(); await createForgeOrdersHandler({ ...d, user: async () => 'boss', manager: async () => true })(req('PATCH', { leadId: 'l1', status: 'live' }), r); assert.equal(r.code, 200);
  r = res(); await createForgeOrdersHandler({ ...d, user: async () => 'boss', manager: async () => true })({ method: 'GET', headers: {} }, r); assert.ok(r.body.orders[0].notes === 'n');
});
