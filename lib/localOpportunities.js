// Structured output contract for Local Opportunity Finder. No provider calls.
export const OPPORTUNITY_COLUMNS = [
  'Business', 'Category', 'City', 'Address', 'Website', 'Website status',
  'Site inspected', 'Phone', 'Email', 'Source URL', 'Contact source URL',
  'Observed opportunity', 'Evidence URL', 'Checked at', 'Outreach draft',
];
const invalid = message => Object.assign(new Error(message), { status: 400, code: 'LOCAL_RESULT_INVALID' });
const http = value => {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
};
const key = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function normalizeLocalOpportunities(result) {
  if (result.tables.length !== 1) throw invalid('Return one Opportunities table.');
  const table = result.tables[0];
  if (table.name !== 'Opportunities' || JSON.stringify(table.columns) !== JSON.stringify(OPPORTUNITY_COLUMNS))
    throw invalid('Use the declared Opportunities columns in order.');
  if (!table.rows.length || table.rows.length > 25) throw invalid('Return 1–25 observed businesses; fail an empty search.');
  let inspected = 0, duplicates = 0;
  const seen = new Set(), rows = [];
  for (const raw of table.rows) {
    if (raw.length !== OPPORTUNITY_COLUMNS.length) throw invalid('Every opportunity must have all 15 cells; use empty strings for unknown contacts.');
    const row = raw.map(cell => cell.trim());
    const [name, category, city, address, website, status, inspection, phone, email, source, contactSource, reason, evidence, checked] = row;
    if (!name || !category || !city || !reason || !http(source) || !http(evidence))
      throw invalid('Each business needs its name, category, city, observed reason and source/evidence URLs.');
    if (!['listed', 'not listed', 'verified absent', 'blocked'].includes(status))
      throw invalid('Use listed, not listed, verified absent or blocked for Website status.');
    if (!['yes', 'no', 'blocked'].includes(inspection)) throw invalid('Use yes, no or blocked for Site inspected.');
    if (website && !http(website)) throw invalid('Website must be a public HTTP(S) URL or empty.');
    if ((status === 'listed' || status === 'blocked') && !website) throw invalid('A listed or blocked website needs its URL.');
    if ((status === 'not listed' || status === 'verified absent') && website) throw invalid('Absent/unlisted websites must have an empty Website cell.');
    if (inspection !== 'no' && !website) throw invalid('A site inspection needs the website URL.');
    if (status === 'blocked' && inspection !== 'blocked') throw invalid('A blocked website must be marked blocked, not inspected successfully.');
    if (phone || email) { if (!http(contactSource)) throw invalid('Public contacts need their own source URL.'); }
    else if (contactSource && !http(contactSource)) throw invalid('Contact source URL must be HTTP(S) or empty.');
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(checked) || !Number.isFinite(Date.parse(checked)))
      throw invalid('Checked at must be an observed UTC ISO timestamp.');
    if (inspection !== 'no' && ++inspected > 10) throw invalid('Inspect at most 10 websites, including blocked attempts.');
    // Keep separate street locations of a chain. Collapse repeat listings at the same location.
    const identity = key(name) + '|' + key(city) + '|' + key(address);
    if (seen.has(identity)) { duplicates++; continue; }
    seen.add(identity); rows.push(row);
  }
  return { ...result, tables: [{ ...table, rows }],
    notes: [result.notes, duplicates ? 'Removed ' + duplicates + ' duplicate business/location listing(s); kept the first observed entry.' : ''].filter(Boolean).join(' ').slice(0,1000) };
}
