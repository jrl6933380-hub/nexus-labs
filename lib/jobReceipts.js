// lib/jobReceipts.js
// Old research jobs shrink to a short receipt so the queue stays small and fast.
// A finished free-link report is kept in full for 7 days (paid reports: 90 days), then replaced by a receipt (who,
// what, when, a short summary and counts). Receipts are deleted after 90 days.
// Ad-request records are deleted 7 days after they finish; the ad itself lives in the Ad Maker.

export const RECEIPT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const RECEIPT_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
export const PAID_REPORT_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

const finished = (rec) => rec.status === 'done' || rec.status === 'failed';
const endedAt = (rec) => rec.completed_at || rec.created_at || 0;

// 'archive' = turn a full job into a receipt, 'delete' = remove the record, null = leave it.
export function compactionAction(rec, now) {
  if (!rec || typeof rec !== 'object') return null;
  const age = now - endedAt(rec);
  if (rec.kind === 'a') return finished(rec) && age > RECEIPT_AFTER_MS ? 'delete' : null;
  if (rec.kind !== 'j' || !finished(rec)) return null;
  // Paid full reports stay available for 90 days; their receipts for a further 90.
  if (rec.receipt) return age > (rec.cost ? PAID_REPORT_KEEP_MS + RECEIPT_KEEP_MS : RECEIPT_KEEP_MS) ? 'delete' : null;
  return age > (rec.cost ? PAID_REPORT_KEEP_MS : RECEIPT_AFTER_MS) ? 'archive' : null;
}

export function toReceipt(job, now) {
  const r = job.result || {};
  const { result, error, ...keep } = job;
  return {
    ...keep,
    archived_at: now,
    receipt: {
      summary: String(r.summary || '').slice(0, 300),
      products: Array.isArray(r.products) ? r.products.length : 0,
      sources: Array.isArray(r.sources) ? r.sources.length : 0,
      ...(job.status === 'failed' ? { failed: true } : {}),
    },
  };
}
