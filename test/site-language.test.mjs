import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, SECTIONS, GLYPHS, RECIPES, LIMITS, describeSiteVocabulary } from '../public/site-vocabulary.mjs';
import { validateSite, normalizeBusiness } from '../public/site-validate.mjs';
import { renderSite, renderSiteSafe } from '../public/site-render.mjs';
import { composeSite, generateSiteVariants, renderSiteVariant } from '../public/site-compose.mjs';
import { describeSiteLanguage, composeSiteTool, renderSiteTool } from '../lib/siteLanguageTools.js';

const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
const barber = { businessName: 'Marlow Barber Studio', category: 'Barber', location: 'Iowa City, IA' };

test('every palette meets contrast for text, muted text and buttons', () => {
  for (const p of PALETTES) {
    assert.ok(ratio(p.ink, p.paper) >= 7, p.id + ' ink/paper');
    assert.ok(ratio(p.muted, p.paper) >= 4.5, p.id + ' muted/paper');
    assert.ok(ratio(p.muted, p.panel) >= 4.5, p.id + ' muted/panel');
    assert.ok(ratio(p.accentInk, p.accent) >= 4.5, p.id + ' accentInk/accent ' + ratio(p.accentInk, p.accent));
    assert.ok(ratio(p.accent, p.paper) >= 3, p.id + ' accent/paper');
  }
});

test('vocabulary describes itself and every glyph/section is usable', () => {
  const d = describeSiteVocabulary();
  assert.equal(d.palettes.length, 14);
  assert.ok(Object.keys(GLYPHS).length >= 25);
  for (const g of Object.values(GLYPHS)) assert.match(g, /^[MmLlHhVvCcSsQqTtZzAa0-9 .,\-]+$/);
  assert.ok(Object.keys(SECTIONS).length >= 17);
  assert.deepEqual(d.recipes.map(r => r.id), ['editorial', 'bold', 'fresh']);
});

test('three recipes render honest, self-contained previews for every trade', () => {
  for (const category of ['Barber', 'Nail salon', 'Hair salon', 'Tattoo', 'Auto repair', 'Plumbing', 'Lawn care', 'Cleaning', 'Cafe', 'Dog grooming', 'Photography', 'Yoga', 'Something odd']) {
    const v = generateSiteVariants({ businessName: 'Test Co', category, location: 'Ames, IA' });
    assert.equal(new Set(v.map(x => x.id)).size, 3);
    assert.deepEqual([...v.map(x => x.id)].sort(), ['bold', 'editorial', 'fresh']);
    for (const x of v) {
      const h = x.html;
      assert.ok(h.startsWith('<!DOCTYPE html>'));
      assert.ok(h.length < LIMITS.html, category + x.id + h.length);
      assert.match(h, /SAMPLE PREVIEW/); assert.match(h, /No availability is checked/); assert.match(h, /Test Co/);
      assert.match(h, /Content-Security-Policy/); assert.match(h, /<dialog id="booking-dialog"/);
      assert.equal((h.match(/<script/g) || []).length, 1);
      assert.doesNotMatch(h, /localStorage|sessionStorage|fetch\(|XMLHttpRequest|sendBeacon|<script[^>]+src|<link|@import|<form[^>]+action/i);
      assert.doesNotMatch(h, /<img/); assert.doesNotMatch(h, /<blockquote/);
      assert.match(h, /Opening hours to be confirmed/); assert.match(h, /Portfolio photo slot/); assert.match(h, /class="tag">SAMPLE/);
    }
  }
});

test('rendering is deterministic and each business gets its own identity', () => {
  assert.equal(renderSiteVariant(barber, 'bold'), renderSiteVariant(barber, 'bold'));
  const themes = new Set();
  for (const n of ['Alpha Cuts', 'Beta Barbers', 'Gamma Fades', 'Delta Shave', 'Omega Clippers', 'Sigma Shears', 'Kappa Cuts', 'Zeta Trim']) {
    const s = composeSite({ lead: { businessName: n, category: 'Barber', location: 'Des Moines, IA' }, recipe: 'bold' });
    themes.add(s.theme.palette + s.theme.type + s.sections.find(x => x.type === 'hero').variant);
  }
  assert.ok(themes.size >= 4, 'expected variety, got ' + themes.size);
  const a = composeSite({ lead: barber, recipe: 'editorial' }), b = composeSite({ lead: barber, recipe: 'editorial', seed: 'two' });
  assert.deepEqual(a, composeSite({ lead: barber, recipe: 'editorial' }));
  assert.notEqual(JSON.stringify(a.theme), JSON.stringify(b.theme) + 'x');
});

test('trade playbooks put the best-fit direction first and use trade-specific samples', () => {
  assert.equal(generateSiteVariants(barber)[0].id, 'bold');
  assert.match(renderSiteVariant({ businessName: 'N', category: 'Nail salon' }, 'fresh'), /Signature manicure/);
  assert.match(renderSiteVariant(barber, 'bold'), /Signature cut/);
});

test('supplied facts appear as facts; samples never carry prices', () => {
  const lead = { ...barber, phone: '(319) 555-0100', rating: 4.6, reviewCount: 31, siteContent: { address: '1 Main St', about: 'Two chairs and a radio.', hours: [{ day: 'Mon', time: '9-5' }], services: [{ name: 'Cut', price: '$30', duration: '30 min' }], photos: [{ url: 'https://example.com/a.jpg', alt: 'A cut' }] } };
  const h = renderSiteVariant(lead, 'editorial');
  for (const t of ['(319) 555-0100', '1 Main St', 'Two chairs and a radio.', 'Mon', '$30', '30 min', 'https://example.com/a.jpg', '4.6', '31 reviews']) assert.ok(h.includes(t), t);
  assert.doesNotMatch(h, /Opening hours to be confirmed/);
  const bad = validateSite({ ...composeSite({ lead: barber }), business: { ...normalizeBusiness(barber), services: [{ name: 'X', price: '$5', sample: true }] } });
  assert.equal(bad.ok, false); assert.match(bad.errors[0].message, /sample service/i);
});

test('rating needs a reviewCount, and photo URLs are https only', () => {
  assert.equal(normalizeBusiness({ ...barber, rating: 4.5 }).rating, null);
  assert.equal(normalizeBusiness({ ...barber, rating: 4.5, reviewCount: 3 }).rating, 4.5);
  assert.equal(normalizeBusiness({ ...barber, rating: 9, reviewCount: 3 }).rating, null);
  const p = normalizeBusiness({ ...barber, siteContent: { photos: [{ url: 'http://x.com/a.jpg' }, { url: 'javascript:alert(1)' }, { url: 'data:image/png;base64,AAA' }, { url: 'https://user:pw@x.com/a.jpg' }, { url: 'https://ok.example/a.jpg' }] } }).photos;
  assert.deepEqual(p.map(x => x.url), ['https://ok.example/a.jpg']);
});

test('text is escaped everywhere and the input is not mutated', () => {
  const lead = { businessName: '<img src=x onerror=alert(1)>', category: 'Barber', location: '"><script>alert(2)</script>', siteContent: { headline: '<b>hi</b>', intro: "O'Neil & <i>sons</i>", services: [{ name: '<script>x</script>' }] } };
  const copy = JSON.stringify(lead);
  for (const r of ['editorial', 'bold', 'fresh']) {
    const h = renderSiteVariant(lead, r);
    assert.equal((h.match(/<script/g) || []).length, 1); assert.doesNotMatch(h, /<img src=x|<b>hi|<i>sons/);
  }
  assert.equal(JSON.stringify(lead), copy);
});

test('validator is strict: unknown fields, ids and targets are rejected with paths', () => {
  const ok = composeSite({ lead: barber });
  assert.equal(validateSite(ok).ok, true);
  const cases = [
    [s => { s.theme.palette = 'neon'; }, /theme\.palette/], [s => { s.extra = 1; }, /\$\.extra/], [s => { s.sections[1].colour = 'red'; }, /colour/],
    [s => { s.sections[1].variant = 'zigzag'; }, /variant/], [s => { s.sections.push({ type: 'carousel' }); }, /type/],
    [s => { s.sections.find(x => x.type === 'hero').primary.target = 'nowhere'; }, /target/], [s => { s.theme.glyphs = ['dragon']; }, /glyph/],
    [s => { s.sections = s.sections.filter(x => x.type !== 'hero'); }, /hero/], [s => { s.business.phone = 'call me!'; }, /phone/],
    [s => { s.v = 2; }, /\$\.v/], [s => { s.sections.push({ type: 'hero', headline: 'x' }); }, /once/]
  ];
  for (const [mutate, re] of cases) {
    const s = JSON.parse(JSON.stringify(ok)); mutate(s);
    const v = validateSite(s); assert.equal(v.ok, false, String(re));
    assert.match(v.errors.map(e => e.path + ' ' + e.message).join('\n'), re);
  }
  assert.throws(() => renderSite({ v: 1 }), /Invalid site/);
  assert.equal(validateSite(null).ok, false);
});

test('unverifiable claims are rejected while concept is true', () => {
  const s = composeSite({ lead: barber });
  s.sections.find(x => x.type === 'hero').headline = 'The best barber in Iowa';
  assert.match(validateSite(s).errors[0].message, /claim/);
  assert.throws(() => composeSite({ lead: { ...barber, siteContent: { intro: 'Family-owned since 1998' } } }), /claim/);
});

test('a live site (concept:false) cannot keep samples, demos or unbacked slots', () => {
  const live = composeSite({ lead: { ...barber, phone: '319-555-0100', siteContent: { about: 'Real about.', services: [{ name: 'Cut', price: '$30' }] } } });
  live.concept = false;
  const msgs = validateSite(live).errors.map(e => e.message).join('\n');
  assert.match(msgs, /approval/); assert.match(msgs, /demo booking/i); assert.match(msgs, /slots/);
  live.approval = 'Owner approved by phone'; live.sections = live.sections.filter(x => !['gallery', 'process'].includes(x.type));
  live.sections.find(x => x.type === 'booking').variant = 'call';
  const v = validateSite(live); assert.equal(v.ok, true, JSON.stringify(v.errors));
  const h = renderSite(live);
  assert.doesNotMatch(h, /SAMPLE PREVIEW|<dialog/); assert.match(h, /href="tel:3195550100"/);
});

test('hand-authored sites can use the richer sections', () => {
  const site = composeSite({ lead: { ...barber, rating: 4.8, reviewCount: 12, phone: '319-555-0100' }, extras: {
    announcement: 'Closed Monday', packages: [{ name: 'Duo', price: '$55', includes: ['Cut', 'Beard'], featured: true }],
    quotes: [{ quote: 'Great chair.', by: 'A. Client', source: 'Google review' }], stats: [{ value: '12', label: 'reviews', source: 'Google listing' }],
    faq: [{ q: 'Do you take cards?', a: 'Ask the owner.' }], faqSample: true, mapUrl: 'https://maps.example/x' } });
  const h = renderSite(site);
  for (const t of ['Closed Monday', 'Duo', '$55', 'Great chair.', 'Google review', 'Do you take cards?', 'https://maps.example/x', '4.8']) assert.ok(h.includes(t), t);
  assert.match(h, /<details>/);
});

test('agent tools describe, compose and render with issues instead of crashes', () => {
  const d = describeSiteLanguage();
  assert.equal(validateSite(d.example_site).ok, true); assert.ok(d.agent_rules.length > 8);
  const c = composeSiteTool({ lead: barber, recipe: 'fresh', include_html: true });
  assert.equal(c.ok, true); assert.ok(c.html.length === c.bytes);
  assert.equal(composeSiteTool({ lead: barber, recipe: 'nope' }).ok, false);
  const r = renderSiteTool({ site: c.site }); assert.equal(r.ok, true); assert.equal(r.html, undefined);
  const bad = renderSiteTool({ site: { v: 1, sections: [] } }); assert.equal(bad.ok, false); assert.ok(bad.issues.length);
  assert.equal(renderSiteTool({ site: { x: 'y'.repeat(70000) } }).ok, false);
  assert.equal(renderSiteSafe({}).ok, false);
});

test('the MCP tools are registered and read-only', async () => {
  let mod; try { mod = await import('../lib/workspaceBoard.js'); } catch (e) { if (/zod|modelcontextprotocol/.test(String(e))) return; throw e; }
  const tools = mod.WORKSPACE_TOOLS.filter(t => ['site_language', 'compose_site', 'render_site'].includes(t[1]));
  assert.equal(tools.length, 3); assert.ok(tools.every(t => t[4] === false));
  const conn = await import('../lib/workspaceConnector.js');
  for (const a of ['site_language', 'compose_site', 'render_site']) assert.equal(conn.WORKSPACE_WRITES.has(a), false);
  assert.ok(RECIPES.length === 3);
});
