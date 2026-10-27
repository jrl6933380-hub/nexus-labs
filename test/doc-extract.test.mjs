import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchStore, genericResultSchema } from '../lib/researchJobs.js';
import { sniff, validateFiles, analyze, toResult, MAX_TOTAL_BYTES } from '../lib/docExtract.js';
import { createDocExtractHandler } from '../api/doc-extract.js';
import { compactionAction, RECEIPT_AFTER_MS } from '../lib/jobReceipts.js';
import { ACTORS, publicActor } from '../lib/actorCatalog.js';

const FILES = 'nexus:research:files:v1';
function memory() {
  const h = new Map(), f = new Map();
  const fn = async (parts) => {
    const [cmd, key, ...rest] = parts;
    if (key === FILES) {
      if (cmd === 'HSET') { f.set(rest[0], rest[1]); return 1; }
      if (cmd === 'HGET') return f.get(rest[0]) ?? null;
      if (cmd === 'HDEL') { f.delete(rest[0]); return 1; }
      throw new Error('unexpected files ' + cmd);
    }
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
  fn.files = f;
  return fn;
}
const store = () => { const command = memory(); const s = createResearchStore({ command, wake: async () => ({ woke: false }) }); s.command = command; return s; };
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(40, 32)]);
const file = (buf, name = 'a.jpg') => ({ name, data: buf.toString('base64') });
const res = () => { const r = { code: 0, body: null, setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body });

const inv = (over = {}) => ({ file: 'inv1.jpg', page: 1, supplier: 'Acme Supply', date: '2026-10-01', invoice_number: 'A-100', currency: 'USD', subtotal: 100, tax: 8, total: 108, readable: true, notes: null, extra: {}, line_items: [{ description: 'Widget', quantity: 2, unit_price: 25, amount: 50 }, { description: 'Gadget', quantity: 1, unit_price: 50, amount: 50 }], ...over });
const agentResult = (documents) => ({ summary: 'Read documents', sections: [{ title: 'Checks', items: [] }], documents });

test('file type comes from the bytes, not what the browser says', () => {
  assert.equal(sniff(jpeg), 'image/jpeg');
  assert.equal(sniff(pdf), 'application/pdf');
  assert.equal(sniff(Buffer.from('<html>not a pdf at all, sorry</html>')), null);
});

test('upload checks: photos only, count and size limits', () => {
  assert.throws(() => validateFiles([]), /at least one/);
  assert.throws(() => validateFiles([{ name: 'x', data: Buffer.from('hello world, this is text').toString('base64') }]), /not a photo/);
  assert.throws(() => validateFiles([file(pdf, 'inv.pdf')]), /turned into photos/);
  assert.throws(() => validateFiles(Array.from({ length: 11 }, () => file(jpeg))), /up to 10 pages/);
  assert.throws(() => validateFiles([file(Buffer.concat([jpeg, Buffer.alloc(MAX_TOTAL_BYTES)]))]), (e) => e.code === 'DOC_TOO_BIG');
  const ok = validateFiles([file(jpeg, 'receipt\n1.jpg')]);
  assert.equal(ok[0].mime, 'image/jpeg');
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

test('the upload goes through the queue: 12 credits, files held, agent reads them, math checked, files deleted', async () => {
  const s = store();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 30 });
  const q = await s.submitDocs(token, { fields: 'PO number', files: validateFiles([file(jpeg, 'a.jpg'), file(jpeg, 'b.jpg')]) });
  assert.equal(q.status, 'queued');
  assert.equal(q.credits_left, 18);
  assert.equal(s.command.files.size, 1);
  const c = await s.claim({ job_id: q.job_id });
  assert.equal(c.claimed, true);
  assert.equal(c.actor, 'docs');
  assert.equal(c.inline_images.length, 2);
  assert.equal(c.inline_images[0].mime, 'image/jpeg');
  assert.match(c.inline_images[1].label, /File 2: b\.jpg/);
  assert.match(c.instructions, /NEVER guess/);
  assert.match(c.instructions, /PO number/);
  const done = await s.complete({ job_id: q.job_id, result: agentResult([inv({ file: 'a.jpg', total: 120 }), inv({ file: 'b.jpg' })]) });
  assert.equal(done.status, 'done');
  assert.equal(s.command.files.size, 0);
  const st = await s.status(token, { job_id: q.job_id });
  assert.equal(st.status, 'done');
  assert.equal(st.result.tables[0].name, 'Documents');
  assert.equal(st.result.documents, undefined);
  assert.match(st.result.sections[0].items.join(' '), /a\.jpg: Subtotal \+ tax is 108 but the total is 120/);
  assert.equal((await s.walletInfo({ link_id })).credits, 18);
});

test('nothing readable fails the job, deletes the files and puts the credits back', async () => {
  const s = store();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 30 });
  const q = await s.submitDocs(token, { files: validateFiles([file(jpeg)]) });
  await s.claim({ job_id: q.job_id });
  const out = await s.complete({ job_id: q.job_id, result: agentResult([inv({ readable: false, notes: 'blurry' })]) });
  assert.equal(out.status, 'failed');
  assert.equal(out.refunded, true);
  assert.equal(s.command.files.size, 0);
  assert.equal((await s.walletInfo({ link_id })).credits, 30);
  const q2 = await s.submitDocs(token, { files: validateFiles([file(jpeg)]) });
  await s.claim({ job_id: q2.job_id });
  const err = await s.complete({ job_id: q2.job_id, error: 'cannot read' });
  assert.equal(err.status, 'failed');
  assert.equal(s.command.files.size, 0);
  assert.equal((await s.walletInfo({ link_id })).credits, 30);
});

test('a job whose files are gone is failed and refunded instead of claimed', async () => {
  const s = store();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 30 });
  const q = await s.submitDocs(token, { files: validateFiles([file(jpeg)]) });
  s.command.files.clear();
  const c = await s.claim({ job_id: q.job_id });
  assert.equal(c.claimed, false);
  assert.equal((await s.walletInfo({ link_id })).credits, 30);
});

test('too few credits and run-only links are refused, and the normal submit path points to the upload page', async () => {
  const s = store();
  const poor = await s.createLink({ label: 'P', credits: 5 });
  await assert.rejects(() => s.submitDocs(poor.token, { files: validateFiles([file(jpeg)]) }), (e) => e.code === 'NO_CREDITS');
  const runs = await s.createLink({ label: 'R', runs: 3 });
  await assert.rejects(() => s.submitDocs(runs.token, { files: validateFiles([file(jpeg)]) }), (e) => e.code === 'NO_CREDITS');
  const rich = await s.createLink({ label: 'W', credits: 30 });
  await assert.rejects(() => s.submit(rich.token, { actor: 'docs' }), (e) => e.code === 'USE_UPLOAD');
  assert.equal(publicActor(ACTORS.docs).upload, true);
  assert.equal(s.command.files.size, 0);
});

test('the stored result never keeps the raw documents field', () => {
  assert.ok(genericResultSchema.parse({ summary: 's', sections: [{ title: 't' }], documents: [{ file: 'x' }] }).documents);
});

test('upload endpoint validates before spending and queues the job', async () => {
  const s = store();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 30 });
  const h = createDocExtractHandler({ store: s });
  const bad = res(); await h(req({ key: token, files: [{ name: 'x', data: Buffer.from('plain text file here').toString('base64') }] }), bad);
  assert.equal(bad.code, 400);
  assert.equal((await s.walletInfo({ link_id })).credits, 30);
  const nokey = res(); await h(req({ key: 'x'.repeat(24), files: [file(jpeg)] }), nokey);
  assert.equal(nokey.code, 404);
  const ok = res(); await h(req({ key: token, files: [file(jpeg)], fields: 'PO number' }), ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.data.status, 'queued');
  assert.equal(ok.body.data.credits_left, 18);
  const extra = res(); await h(req({ key: token, files: [file(jpeg)], hack: 1 }), extra);
  assert.equal(extra.code, 400);
});

test('document results are cleared after 7 days even though they were paid for', () => {
  const now = 2_000_000_000_000;
  const base = { kind: 'j', status: 'done', cost: 12, created_at: now - RECEIPT_AFTER_MS - 5000, completed_at: now - RECEIPT_AFTER_MS - 1000 };
  assert.equal(compactionAction({ ...base, actor: 'docs' }, now), 'archive');
  assert.equal(compactionAction({ ...base, actor: 'gbp' }, now), null);
});
