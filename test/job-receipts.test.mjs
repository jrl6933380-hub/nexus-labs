import test from 'node:test';
import assert from 'node:assert/strict';
import { compactionAction, toReceipt, RECEIPT_AFTER_MS, RECEIPT_KEEP_MS } from '../lib/jobReceipts.js';

const now = 1_000_000_000_000;
const job = (over = {}) => ({ kind: 'j', id: 'rj-a', link: 'l1', status: 'done', competitor: 'Casey', created_at: now - 10, completed_at: now - 5, result: { summary: 'S'.repeat(500), products: [1, 2], sources: [1] }, ...over });

test('recent and unfinished jobs are left alone', () => {
  assert.equal(compactionAction(job(), now), null);
  assert.equal(compactionAction(job({ status: 'queued', completed_at: undefined, created_at: now - RECEIPT_AFTER_MS * 5 }), now), null);
  assert.equal(compactionAction(job({ status: 'working' }), now), null);
});

test('finished jobs older than 7 days become receipts', () => {
  const old = job({ completed_at: now - RECEIPT_AFTER_MS - 1 });
  assert.equal(compactionAction(old, now), 'archive');
  assert.equal(compactionAction(job({ status: 'failed', completed_at: now - RECEIPT_AFTER_MS - 1 }), now), 'archive');
});

test('receipts drop the report, keep who and when, and cap the summary', () => {
  const r = toReceipt(job({ completed_at: now - RECEIPT_AFTER_MS - 1 }), now);
  assert.equal(r.result, undefined);
  assert.equal(r.competitor, 'Casey');
  assert.equal(r.receipt.summary.length, 300);
  assert.equal(r.receipt.products, 2);
  assert.equal(r.receipt.sources, 1);
  assert.equal(r.archived_at, now);
  assert.equal(compactionAction(r, now), null);
});

test('receipts are deleted after 90 days, ad requests 7 days after they finish', () => {
  const receipt = toReceipt(job({ completed_at: now - RECEIPT_KEEP_MS - 1 }), now);
  assert.equal(compactionAction(receipt, now), 'delete');
  assert.equal(compactionAction({ kind: 'a', status: 'done', completed_at: now - RECEIPT_AFTER_MS - 1 }, now), 'delete');
  assert.equal(compactionAction({ kind: 'a', status: 'queued', created_at: now - RECEIPT_AFTER_MS * 9 }, now), null);
  assert.equal(compactionAction({ kind: 'l', status: 'done' }, now), null);
  assert.equal(compactionAction(null, now), null);
});
