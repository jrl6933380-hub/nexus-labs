import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchStore } from '../lib/researchJobs.js';
import { sniff, validateFiles, analyze, toResult, extractDocuments, MAX_TOTAL_BYTES } from '../lib/docExtract.js';
import { createDocExtractHandler } from '../api/doc-extract.js';
import { compactionAction, RECEIPT_AFTER_MS } from '../lib/jobReceipts.js';

function memory() {
  const h = new Map();
  return async (parts) => {
    const [cmd, , ...rest] = parts;
    if (cmd === 'HGET') return h.get(rest[0]) ?? null;
    if (cmd === 'HVALS') return [...h.values()];
    if (cmd === 'HDEL') { h.delete(rest[0]); return 1; }
    if (cmd === 'EVAL') {
      const [field, old, next, limit] = [parts[4], parts[5], parts[6], parts[7]];
      const cur = h.get(field) ?? '';
      if (cur !== old) return 0;
      if (cur === '' && h.size >= Number(limit)) return -1;
      h.set(field, next); return 1;
    }
    throw new Error('unexpected ' + cmd);
  };
}
const store = () => createResearchStore({ command: memory(), wake: async () => ({ woke: false }) });
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('<< /Type /Page >> << /Type /Pages >> << /Type /Page >>'), Buffer.alloc(40, 32)]);
const file = (buf, name = 'a.jpg') => ({ name, data: buf.toString('base64') });
const res = () => { const r = { code: 0, body: null, setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body });

const inv = (over = {}) => ({ file: 'inv1.jpg', page: 1, supplier: 'Acme Supply', date: '2026-10-01', invoice_number: 'A-100', currency: 'USD', subtotal: 100, tax: 8, total: 108, readable: true, notes: null, extra: {}, line_items: [{ description: 'Widget', quantity: 2, unit_price: 25, amount: 50 }, { description: 'Gadget', quantity: 1, unit_price: 50, amount: 50 }], ...over });

test('file type comes from the bytes, not what the browser says', () => {
  assert.equal(sniff(jpeg), 'image/jpeg');
  assert.equal(sniff(pdf), 'application/pdf');
  assert.equal(sniff(Buffer.from('<html>not a pdf at all, sorry</html>')), null);
});

test('upload checks: count, type, size, page limits', () => {
  assert.throws(() => validateFiles([]), /at least one/);
  assert.throws(() => validateFiles([{ name: 'x', data: Buffer.from('hello world, this is text').toString('base64') }]), /not a PDF or a photo/);
  assert.throws(() => validateFiles(Array.from({ length: 11 }, () => file(jpeg))), /up to 10 files/);
  assert.throws(() => validateFiles([file(Buffer.concat([jpeg, Buffer.alloc(MAX_TOTAL_BYTES)]))]), (e) => e.code === 'DOC_TOO_BIG');
  const many = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('<< /Type /Page >>'.repeat(11))]);
  assert.throws(() => validateFiles([file(many, 'big.pdf')]), /up to 10 pages/);
  const ok = validateFiles([file(jpeg, 'receipt\n1.jpg'), file(pdf, 'inv.pdf')]);
  assert.deepEqual(ok.map((f) => f.mime), ['image/jpeg', 'application/pdf']);
  assert.equal(ok[0].name, 'receipt 1.jpg');
});

test('a clean invoice is consistent and builds both tables', () => {
  const a = analyze({ documents: [inv()] });
  assert.equal(a.fine, 1);
  assert.deepEqual(a.flags, []);
  assert.equal(a.tables[0].rows[0][8], '108');
  assert.equal(a.tables[0].rows[0].at(-1), 'OK');
  assert.equal(a.tables[1].rows.length, 2);
  assert.match(toResult(a).summary, /Read 1 document: 1 looks consistent\./);
});

test('wrong totals, missing values, bad line math and unreadable pages are flagged, nothing is invented', () => {
  const a = analyze({ documents: [
    inv({ file: 'bad.jpg', total: 120 }),
    inv({ file: 'lines.jpg', subtotal: 90, total: 98 }),
    inv({ file: 'blank.jpg', supplier: null, date: null, total: null, invoice_number: null, subtotal: null, tax: null, line_items: [] }),
    inv({ file: 'blur.jpg', readable: false, notes: 'too blurry' }),
    inv({ file: 'qty.jpg', line_items: [{ description: 'Widget', quantity: 3, unit_price: 25, amount: 50 }, { description: 'Gadget', quantity: 1, unit_price: 50, amount: 50 }] }),
  ] });
  const text = a.flags.join('\n');
  assert.match(text, /bad\.jpg: Subtotal \+ tax is 108 but the total is 120/);
  assert.match(text, /lines\.jpg: Line items add to 100 but the subtotal is 90/);
  assert.match(text, /blank\.jpg: Missing or unreadable: supplier, date, total, invoice number/);
  assert.match(text, /blur\.jpg: Could not be read: too blurry/);
  assert.match(text, /qty\.jpg: line "Widget": Qty x price is 75 but the amount is 50/);
  const blank = a.tables[0].rows.find((r) => r[0] === 'blank.jpg');
  assert.equal(blank[2], '');
  assert.equal(blank[8], '');
  assert.equal(a.readableDocs, 4);
});

test('requested extra columns become table columns', () => {
  const a = analyze({ documents: [inv({ extra: { 'PO number': 'PO-77', 'Due date': null } })] });
  assert.deepEqual(a.tables[0].columns.slice(9, 11), ['PO number', 'Due date']);
  assert.equal(a.tables[0].rows[0][9], 'PO-77');
});

test('extractDocuments reads through Gemini JSON, and refuses when nothing is readable', async () => {
  const reply = (obj) => async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(obj) + '\n```' }] } }] }) });
  const files = validateFiles([file(jpeg)]);
  const ok = await extractDocuments({ files, fields: '' }, { fetchImpl: reply({ documents: [inv()] }), env: { GEMINI_API_KEY: 'k' } });
  assert.equal(ok.tables.length, 2);
  await assert.rejects(() => extractDocuments({ files }, { fetchImpl: reply({ documents: [inv({ readable: false })] }), env: { GEMINI_API_KEY: 'k' } }), (e) => e.code === 'UNREADABLE');
  await assert.rejects(() => extractDocuments({ files }, { fetchImpl: reply({ documents: [] }), env: { GEMINI_API_KEY: 'k' } }), (e) => e.code === 'UNREADABLE');
  await assert.rejects(() => extractDocuments({ files }, { fetchImpl: async () => ({ ok: true, json: async () => ({}) }), env: { GEMINI_API_KEY: 'k' } }), (e) => e.code === 'UNREADABLE');
  await assert.rejects(() => extractDocuments({ files }, { fetchImpl: reply({}), env: {} }), (e) => e.code === 'UNAVAILABLE');
});

test('the wallet pays 12 credits for a good run and gets them back when reading fails', async () => {
  const s = store();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 30 });
  const good = await s.runNow(token, 'docs', {}, async () => toResult(analyze({ documents: [inv()] })));
  assert.equal(good.credits_left, 18);
  assert.equal(good.result.tables.length, 2);
  const err = await s.runNow(token, 'docs', {}, async () => { throw Object.assign(new Error('Could not read.'), { status: 422 }); }).catch((e) => e);
  assert.equal(err.refunded, true);
  assert.equal((await s.walletInfo({ link_id })).credits, 18);
  const crash = await s.runNow(token, 'docs', {}, async () => { throw new Error('boom internal detail'); }).catch((e) => e);
  assert.doesNotMatch(crash.message, /boom/);
  assert.equal((await s.walletInfo({ link_id })).credits, 18);
  const st = await s.status(token, { job_id: good.job_id });
  assert.equal(st.actor, 'docs');
  assert.equal(st.result.tables[0].name, 'Documents');
});

test('too few credits, run-only links and the agent queue are all refused for documents', async () => {
  const s = store();
  const poor = await s.createLink({ label: 'P', credits: 5 });
  await assert.rejects(() => s.runNow(poor.token, 'docs', {}, async () => ({})), (e) => e.code === 'NO_CREDITS');
  const runs = await s.createLink({ label: 'R', runs: 3 });
  await assert.rejects(() => s.runNow(runs.token, 'docs', {}, async () => ({})), (e) => e.code === 'NO_CREDITS');
  const rich = await s.createLink({ label: 'W', credits: 30 });
  await assert.rejects(() => s.submit(rich.token, { actor: 'docs' }), (e) => e.code === 'USE_UPLOAD');
  await assert.rejects(() => s.runNow(rich.token, 'reviews', { reviews: 'Great place, loved it' }, async () => ({})), (e) => e.code === 'NOT_INSTANT');
});

test('upload endpoint validates before spending and returns the spreadsheet', async () => {
  const s = store();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 30 });
  const h = createDocExtractHandler({ store: s, extract: async () => toResult(analyze({ documents: [inv()] })) });
  const bad = res(); await h(req({ key: token, files: [{ name: 'x', data: Buffer.from('plain text file here').toString('base64') }] }), bad);
  assert.equal(bad.code, 400);
  assert.equal((await s.walletInfo({ link_id })).credits, 30);
  const nokey = res(); await h(req({ key: 'x'.repeat(24), files: [file(jpeg)] }), nokey);
  assert.equal(nokey.code, 404);
  const ok = res(); await h(req({ key: token, files: [file(jpeg)], fields: 'PO number' }), ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.data.credits_left, 18);
  assert.equal(ok.body.data.result.tables[0].name, 'Documents');
  const extra = res(); await h(req({ key: token, files: [file(jpeg)], hack: 1 }), extra);
  assert.equal(extra.code, 400);
});

test('document results are cleared after 7 days even though they were paid for', () => {
  const now = 2_000_000_000_000;
  const base = { kind: 'j', status: 'done', cost: 12, created_at: now - RECEIPT_AFTER_MS - 5000, completed_at: now - RECEIPT_AFTER_MS - 1000 };
  assert.equal(compactionAction({ ...base, actor: 'docs' }, now), 'archive');
  assert.equal(compactionAction({ ...base, actor: 'gbp' }, now), null);
});
