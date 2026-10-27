// lib/docExtract.js
// Documents to Spreadsheet helpers. The Claude agent reads the uploaded photos (see the docs entry in actorCatalog.js);
// everything here is plain code: file checks on upload, and turning what the agent read into tables while checking the arithmetic,
// so a wrong total is flagged instead of trusted.

export const MAX_FILES = 10;
export const MAX_TOTAL_BYTES = 3_000_000;
export const MAX_PAGES = 10;
const fail = (message, status = 400, code = 'DOC_INVALID') => Object.assign(new Error(message), { status, code });

// Decide the real file type from its first bytes. The browser's claim is ignored.
export function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 12 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

// The agent reads images only. The page turns PDF pages into photos before upload.
export function validateFiles(files) {
  if (!Array.isArray(files) || files.length < 1) throw fail('Add at least one invoice, receipt or bill.');
  if (files.length > MAX_FILES) throw fail('Add up to ' + MAX_FILES + ' pages at a time.');
  let total = 0;
  const out = files.map((f, i) => {
    if (!f || typeof f !== 'object' || typeof f.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(f.data)) throw fail('File ' + (i + 1) + ' could not be read.');
    const buf = Buffer.from(f.data, 'base64');
    const mime = sniff(buf);
    if (mime === 'application/pdf') throw fail('PDFs are turned into photos on the Documents page. Please add it there.');
    if (!mime) throw fail('File ' + (i + 1) + ' is not a photo (JPG, PNG or WebP).');
    total += buf.length;
    const name = String(f.name || 'file ' + (i + 1)).replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 80) || 'file ' + (i + 1);
    return { name, mime, data: f.data };
  });
  if (total > MAX_TOTAL_BYTES) throw fail('Those files are too big together (limit about 3 MB). Use fewer or smaller files.', 413, 'DOC_TOO_BIG');
  return out;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, n = 300) => (v == null ? '' : String(v).replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, n));
const money = (v) => (v == null ? '' : String(Math.round(v * 100) / 100));
const close = (a, b) => Math.abs(a - b) <= 0.02 + Math.abs(b) * 0.0005;

// Turns what the agent read into spreadsheet tables, and checks the arithmetic ourselves.
export function analyze(raw) {
  const docs = (Array.isArray(raw?.documents) ? raw.documents : []).slice(0, 30);
  const extraKeys = [];
  for (const d of docs) for (const k of Object.keys(d?.extra && typeof d.extra === 'object' ? d.extra : {})) if (!extraKeys.includes(k) && extraKeys.length < 8) extraKeys.push(str(k, 60));
  const flags = [];
  const docRows = [], lineRows = [];
  let fine = 0, unreadable = 0;
  for (const d of docs) {
    const file = str(d?.file, 80) || 'file';
    const checks = [];
    const readable = d?.readable !== false;
    const supplier = d?.supplier, date = d?.date, invoice = d?.invoice_number;
    const subtotal = num(d?.subtotal), tax = num(d?.tax), total = num(d?.total);
    const lines = (Array.isArray(d?.line_items) ? d.line_items : []).slice(0, 80);
    if (!readable) { checks.push('Could not be read' + (d?.notes ? ': ' + str(d.notes, 120) : '')); unreadable++; }
    else {
      const missing = [];
      if (!supplier) missing.push('supplier'); if (!date) missing.push('date'); if (total == null) missing.push('total'); if (!invoice) missing.push('invoice number');
      if (missing.length) checks.push('Missing or unreadable: ' + missing.join(', '));
      const amounts = lines.map((l) => num(l?.amount));
      const allAmounts = lines.length > 0 && amounts.every((a) => a != null);
      const sum = allAmounts ? amounts.reduce((a, b) => a + b, 0) : null;
      if (sum != null && subtotal != null && !close(sum, subtotal)) checks.push('Line items add to ' + money(sum) + ' but the subtotal is ' + money(subtotal));
      if (subtotal != null && tax != null && total != null && !close(subtotal + tax, total)) checks.push('Subtotal + tax is ' + money(subtotal + tax) + ' but the total is ' + money(total));
      else if (subtotal == null && sum != null && tax != null && total != null && !close(sum + tax, total)) checks.push('Line items + tax is ' + money(sum + tax) + ' but the total is ' + money(total));
      else if (subtotal == null && tax == null && sum != null && total != null && !close(sum, total)) checks.push('Line items add to ' + money(sum) + ' but the total is ' + money(total));
      if (d?.notes) checks.push(str(d.notes, 160));
      if (!checks.length) fine++;
    }
    for (const c of checks) flags.push(file + ': ' + c);
    const extra = d?.extra && typeof d.extra === 'object' ? d.extra : {};
    docRows.push([file, d?.page == null ? '' : str(d.page, 6), str(supplier), str(date, 20), str(invoice, 60), str(d?.currency, 10), money(subtotal), money(tax), money(total), ...extraKeys.map((k) => str(extra[k], 200)), checks.length ? checks.join('; ') : 'OK']);
    for (const l of lines) {
      const q = num(l?.quantity), u = num(l?.unit_price), a = num(l?.amount);
      const lineCheck = q != null && u != null && a != null && !close(q * u, a) ? 'Qty x price is ' + money(q * u) : '';
      lineRows.push([file, str(supplier), str(invoice, 60), str(l?.description, 200), q == null ? '' : String(q), money(u), money(a), lineCheck]);
      if (lineCheck) flags.push(file + ': line "' + str(l?.description, 40) + '": ' + lineCheck + ' but the amount is ' + money(a));
    }
  }
  const readableDocs = docs.length - unreadable;
  const tables = [{ name: 'Documents', columns: ['File', 'Page', 'Supplier', 'Date', 'Invoice number', 'Currency', 'Subtotal', 'Tax', 'Total', ...extraKeys, 'Checks'], rows: docRows.slice(0, 300) }];
  if (lineRows.length) tables.push({ name: 'Line items', columns: ['File', 'Supplier', 'Invoice number', 'Description', 'Quantity', 'Unit price', 'Amount', 'Check'], rows: lineRows.slice(0, 400) });
  return { docs: docs.length, readableDocs, fine, flags, tables };
}

export function toResult(a) {
  const need = a.readableDocs - a.fine + (a.docs - a.readableDocs);
  return {
    summary: 'Read ' + a.docs + ' document' + (a.docs === 1 ? '' : 's') + ': ' + a.fine + ' look' + (a.fine === 1 ? 's' : '') + ' consistent' + (need ? ', ' + need + ' need a look.' : '.'),
    sections: [
      { title: 'Checks', body: '', items: a.flags.length ? a.flags.slice(0, 40).map((f) => f.slice(0, 780)) : ['No problems found. The totals added up on every document.'] },
      { title: 'Before you use this', body: '', items: ['Blank cells mean the value was missing or unreadable. Nothing was guessed.', 'Spot-check a few rows against the originals, especially totals and invoice numbers.', 'This is an aid for data entry, not accounting or tax advice.'] },
    ],
    tables: a.tables,
    notes: '',
  };
}
