// Nexus Site Language v1 - strict validator and business normaliser. Pure; no network, storage or model.
import { LIMITS, MOODS, PALETTES, TYPE_PAIRS, SCALES, RADII, MOTIONS, DECORS, GLYPHS, SECTIONS, CTA_TARGETS, PLAYBOOKS, SITE_LANGUAGE_VERSION } from './site-vocabulary.mjs';

export const text = (value, max = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '';
export function httpsUrl(value) {
  const raw = text(value, LIMITS.url);
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export const pickPlaybook = category => PLAYBOOKS.find(p => p.match.test(category || '')) || PLAYBOOKS[PLAYBOOKS.length - 1];
const PHONE = /^[0-9+().\-\s]{7,30}$/;
// Words that assert something about the business that Nexus cannot know. Rejected while concept is true.
export const CLAIM = /\b(best|#\s?1|no\.?\s?1|number one|top[- ]rated|award[- ]?winning|awards?|years? (?:of experience|in business)|since (?:19|20)\d\d|established|guarantee[ds]?|licen[sc]ed|insured|certified|bonded|family[- ]owned|voted|leading|premier|cheapest|lowest price|free (?:estimates?|quotes?|consultations?)|same[- ]day|24\/7|open late|walk-?ins? welcome)\b/i;

// Supply verified facts in lead.siteContent; everything else becomes a labelled sample.
export function normalizeBusiness(lead = {}) {
  const c = lead.siteContent && typeof lead.siteContent === 'object' ? lead.siteContent : {};
  const name = text(lead.businessName, LIMITS.name) || 'Your local studio';
  const category = text(lead.category, LIMITS.category) || 'Local services';
  const pb = pickPlaybook(category);
  const supplied = Array.isArray(c.services) ? c.services.filter(s => s && text(s.name, LIMITS.itemName)).slice(0, LIMITS.services) : [];
  const services = (supplied.length ? supplied : pb.services.map(n => ({ name: n, sample: true }))).map(s => ({
    name: text(s.name, LIMITS.itemName), description: text(s.description, LIMITS.itemText),
    price: supplied.length && s.sample !== true ? text(s.price, LIMITS.price) : '', duration: supplied.length && s.sample !== true ? text(s.duration, LIMITS.duration) : '',
    sample: s.sample === true || !supplied.length
  }));
  const photos = (Array.isArray(c.photos) ? c.photos : []).slice(0, LIMITS.photos).map(p => ({
    url: httpsUrl(p?.url), alt: text(p?.alt, LIMITS.alt) || 'Business portfolio photograph', credit: text(p?.credit, LIMITS.credit)
  })).filter(p => p.url);
  const hours = (Array.isArray(c.hours) ? c.hours : []).slice(0, LIMITS.hours).filter(h => text(h?.day) && text(h?.time)).map(h => ({ day: text(h.day, 30), time: text(h.time, 70) }));
  const phone = text(lead.phone, LIMITS.phone);
  return {
    name, category, location: text(lead.location, LIMITS.location), phone: PHONE.test(phone) ? phone : '',
    address: text(c.address, LIMITS.address), intro: text(c.intro, LIMITS.sub), about: text(c.about, LIMITS.body), headline: text(c.headline, LIMITS.headline),
    services, photos, hours,
    rating: Number.isFinite(lead.rating) && lead.rating > 0 && lead.rating <= 5 && Number.isInteger(lead.reviewCount) && lead.reviewCount > 0 ? lead.rating : null,
    reviewCount: Number.isInteger(lead.reviewCount) && lead.reviewCount > 0 && Number.isFinite(lead.rating) && lead.rating > 0 && lead.rating <= 5 ? lead.reviewCount : null,
    initials: name.split(/\s+/).map(x => x[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'N',
    playbook: pb.id
  };
}

const ids = a => new Set(a.map(x => x.id));
const SETS = { mood: ids(MOODS), palette: ids(PALETTES), type: ids(TYPE_PAIRS), scale: ids(SCALES), radius: ids(RADII), motion: ids(MOTIONS), decor: ids(DECORS), nav: new Set(['bar', 'center', 'minimal']) };
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

export function validateSite(input) {
  const errors = [];
  const err = (path, message) => { if (errors.length < 60) errors.push({ path, message }); };
  const only = (obj, allowed, path) => { for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`${path}.${k}`, 'Unknown field (not in the vocabulary).'); };
  const str = (v, path, max, { required = false } = {}) => {
    if (v === undefined || v === null || v === '') { if (required) err(path, 'Required.'); return ''; }
    if (typeof v !== 'string') { err(path, 'Must be text.'); return ''; }
    if (v.length > max) err(path, `At most ${max} characters.`);
    return text(v, max);
  };
  const bool = (v, path) => { if (v !== undefined && typeof v !== 'boolean') err(path, 'Must be true or false.'); return v === true; };
  const arr = (v, path, max) => { if (v === undefined) return []; if (!Array.isArray(v)) { err(path, 'Must be a list.'); return []; } if (v.length > max) err(path, `At most ${max} items.`); return v.slice(0, max); };
  const enumOf = (v, set, path, fallback) => { if (v === undefined) return fallback; if (!set.has(v)) { err(path, `Not in the vocabulary. Use one of: ${[...set].join(', ')}.`); return fallback; } return v; };

  if (!isObj(input)) return { ok: false, errors: [{ path: '$', message: 'Site must be an object.' }], site: null };
  only(input, ['v', 'concept', 'approval', 'business', 'theme', 'sections', 'seo'], '$');
  if (input.v !== SITE_LANGUAGE_VERSION) err('$.v', `Must be ${SITE_LANGUAGE_VERSION}.`);
  const concept = input.concept !== false;
  if (input.concept !== undefined && typeof input.concept !== 'boolean') err('$.concept', 'Must be true or false.');
  const approval = str(input.approval, '$.approval', 120);
  if (!concept && !approval) err('$.approval', 'A live (concept:false) site needs a short approval note, e.g. who approved it and when.');

  // business
  const b = isObj(input.business) ? input.business : (err('$.business', 'Required.'), {});
  only(b, ['name', 'category', 'location', 'phone', 'address', 'intro', 'about', 'headline', 'services', 'photos', 'hours', 'rating', 'reviewCount', 'initials', 'playbook'], '$.business');
  const business = {
    name: str(b.name, '$.business.name', LIMITS.name, { required: true }), category: str(b.category, '$.business.category', LIMITS.category, { required: true }),
    location: str(b.location, '$.business.location', LIMITS.location), phone: str(b.phone, '$.business.phone', LIMITS.phone),
    address: str(b.address, '$.business.address', LIMITS.address), intro: str(b.intro, '$.business.intro', LIMITS.sub),
    about: str(b.about, '$.business.about', LIMITS.body), headline: str(b.headline, '$.business.headline', LIMITS.headline)
  };
  if (business.phone && !PHONE.test(business.phone)) err('$.business.phone', 'Digits, spaces and + ( ) - . only.');
  business.initials = str(b.initials, '$.business.initials', 4) || business.name.split(/\s+/).map(x => x[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'N';
  business.playbook = enumOf(b.playbook, new Set(PLAYBOOKS.map(p => p.id)), '$.business.playbook', pickPlaybook(business.category).id);
  business.services = arr(b.services, '$.business.services', LIMITS.services).map((s, i) => {
    const p = `$.business.services[${i}]`;
    if (!isObj(s)) { err(p, 'Must be an object.'); return null; }
    only(s, ['name', 'description', 'price', 'duration', 'sample'], p);
    const o = { name: str(s.name, p + '.name', LIMITS.itemName, { required: true }), description: str(s.description, p + '.description', LIMITS.itemText), price: str(s.price, p + '.price', LIMITS.price), duration: str(s.duration, p + '.duration', LIMITS.duration), sample: bool(s.sample, p + '.sample') };
    if (o.sample && (o.price || o.duration)) err(p, 'A sample service cannot carry a price or duration: those are facts.');
    if (!concept && o.sample) err(p, 'Sample services are not allowed when concept is false.');
    return o;
  }).filter(Boolean);
  business.photos = arr(b.photos, '$.business.photos', LIMITS.photos).map((ph, i) => {
    const p = `$.business.photos[${i}]`;
    if (!isObj(ph)) { err(p, 'Must be an object.'); return null; }
    only(ph, ['url', 'alt', 'credit'], p);
    const url = httpsUrl(ph.url);
    if (!url) err(p + '.url', 'Must be an https URL without credentials.');
    return { url, alt: str(ph.alt, p + '.alt', LIMITS.alt) || 'Business portfolio photograph', credit: str(ph.credit, p + '.credit', LIMITS.credit) };
  }).filter(p => p && p.url);
  business.hours = arr(b.hours, '$.business.hours', LIMITS.hours).map((h, i) => {
    const p = `$.business.hours[${i}]`;
    if (!isObj(h)) { err(p, 'Must be an object.'); return null; }
    only(h, ['day', 'time'], p);
    return { day: str(h.day, p + '.day', 30, { required: true }), time: str(h.time, p + '.time', 70, { required: true }) };
  }).filter(Boolean);
  business.rating = null; business.reviewCount = null;
  if (b.rating !== undefined && b.rating !== null) {
    if (!(Number.isFinite(b.rating) && b.rating > 0 && b.rating <= 5)) err('$.business.rating', 'Between 0 and 5.');
    else if (!(Number.isInteger(b.reviewCount) && b.reviewCount > 0)) err('$.business.rating', 'A rating needs a reviewCount.');
    else { business.rating = b.rating; business.reviewCount = b.reviewCount; }
  } else if (b.reviewCount !== undefined && b.reviewCount !== null) err('$.business.reviewCount', 'A reviewCount needs a rating.');

  // theme
  const th = isObj(input.theme) ? input.theme : (input.theme === undefined ? {} : (err('$.theme', 'Must be an object.'), {}));
  only(th, ['mood', 'palette', 'type', 'scale', 'radius', 'motion', 'decor', 'nav', 'glyphs'], '$.theme');
  const theme = {
    mood: enumOf(th.mood, SETS.mood, '$.theme.mood', 'editorial'), palette: enumOf(th.palette, SETS.palette, '$.theme.palette', 'paper-green'),
    type: enumOf(th.type, SETS.type, '$.theme.type', 'serif-sans'), scale: enumOf(th.scale, SETS.scale, '$.theme.scale', 'balanced'),
    radius: enumOf(th.radius, SETS.radius, '$.theme.radius', 'soft'), motion: enumOf(th.motion, SETS.motion, '$.theme.motion', 'soft'),
    decor: enumOf(th.decor, SETS.decor, '$.theme.decor', 'none'), nav: enumOf(th.nav, SETS.nav, '$.theme.nav', 'bar'),
    glyphs: arr(th.glyphs, '$.theme.glyphs', 4).filter((g, i) => { if (!GLYPHS[g]) { err(`$.theme.glyphs[${i}]`, 'Not a glyph in the vocabulary.'); return false; } return true; })
  };
  if (!theme.glyphs.length) theme.glyphs = ['star', 'sparkle'];

  // sections
  const sections = [];
  const rawSections = arr(input.sections, '$.sections', LIMITS.sections);
  if (!rawSections.length && input.sections === undefined) err('$.sections', 'Required.');
  const seen = new Map();
  rawSections.forEach((s, i) => {
    const p = `$.sections[${i}]`;
    if (!isObj(s)) { err(p, 'Must be an object.'); return; }
    const spec = SECTIONS[s.type];
    if (!spec) { err(p + '.type', `Not a section in the vocabulary. Use one of: ${Object.keys(SECTIONS).join(', ')}.`); return; }
    only(s, ['type', 'variant', 'id', 'sample', ...Object.keys(spec.props)], p);
    const out = { type: s.type, variant: spec.variants.includes(s.variant) ? s.variant : spec.variants[0], sample: bool(s.sample, p + '.sample') };
    if (s.variant !== undefined && !spec.variants.includes(s.variant)) err(p + '.variant', `Use one of: ${spec.variants.join(', ')}.`);
    const n = (seen.get(s.type) || 0) + 1; seen.set(s.type, n);
    if (n > 1 && !['marquee', 'cta_band'].includes(s.type)) err(p + '.type', 'Each section type may appear once.');
    out.id = s.id === undefined ? (n > 1 ? `${s.type}-${n}` : s.type) : str(s.id, p + '.id', LIMITS.id);
    if (!/^[a-z][a-z0-9_-]*$/.test(out.id)) err(p + '.id', 'Lowercase letters, digits and dashes.');
    for (const need of spec.needs || []) if (s[need] === undefined || s[need] === '' || (Array.isArray(s[need]) && !s[need].length)) err(`${p}.${need}`, 'Required for this section.');
    for (const [key, kind] of Object.entries(spec.props)) {
      const v = s[key], vp = `${p}.${key}`;
      if (v === undefined) continue;
      const [k, a, bmax] = kind.split(':');
      if (k === 'text') out[key] = str(v, vp, Number(a));
      else if (k === 'url') { const u = httpsUrl(v); if (!u) err(vp, 'Must be an https URL.'); out[key] = u; }
      else if (k === 'number') {
        const lo = key === 'slots' ? 1 : 0, hi = key === 'slots' ? LIMITS.photos : LIMITS.photos - 1;
        if (!Number.isInteger(v) || v < lo || v > hi) err(vp, `Whole number ${lo}-${hi}.`); else out[key] = v;
      } else if (k === 'glyph') { if (!GLYPHS[v]) err(vp, 'Not a glyph in the vocabulary.'); else out[key] = v; }
      else if (k === 'target') { if (!CTA_TARGETS.includes(v)) err(vp, `Use one of: ${CTA_TARGETS.join(', ')}.`); else out[key] = v; }
      else if (k === 'cta') {
        if (!isObj(v)) { err(vp, 'Must be {label,target}.'); continue; }
        only(v, ['label', 'target'], vp);
        if (!CTA_TARGETS.includes(v.target)) err(vp + '.target', `Use one of: ${CTA_TARGETS.join(', ')}.`);
        out[key] = { label: str(v.label, vp + '.label', LIMITS.label, { required: true }), target: v.target };
      } else if (k === 'strings') out[key] = arr(v, vp, Number(a)).map((x, j) => str(x, `${vp}[${j}]`, Number(bmax), { required: true }));
      else if (k === 'services') out[key] = arr(v, vp, LIMITS.services).map((x, j) => {
        const q = `${vp}[${j}]`; if (!isObj(x)) { err(q, 'Must be an object.'); return null; }
        only(x, ['name', 'description', 'price', 'duration', 'sample'], q);
        const o = { name: str(x.name, q + '.name', LIMITS.itemName, { required: true }), description: str(x.description, q + '.description', LIMITS.itemText), price: str(x.price, q + '.price', LIMITS.price), duration: str(x.duration, q + '.duration', LIMITS.duration), sample: bool(x.sample, q + '.sample') };
        if (o.sample && (o.price || o.duration)) err(q, 'A sample service cannot carry a price or duration.');
        return o;
      }).filter(Boolean);
      else if (k === 'packages') out[key] = arr(v, vp, LIMITS.packages).map((x, j) => {
        const q = `${vp}[${j}]`; if (!isObj(x)) { err(q, 'Must be an object.'); return null; }
        only(x, ['name', 'price', 'includes', 'featured'], q);
        return { name: str(x.name, q + '.name', LIMITS.itemName, { required: true }), price: str(x.price, q + '.price', LIMITS.price, { required: true }), includes: arr(x.includes, q + '.includes', LIMITS.points).map((t, m) => str(t, `${q}.includes[${m}]`, 80, { required: true })), featured: bool(x.featured, q + '.featured') };
      }).filter(Boolean);
      else if (k === 'steps') out[key] = arr(v, vp, LIMITS.steps).map((x, j) => {
        const q = `${vp}[${j}]`; if (!isObj(x)) { err(q, 'Must be an object.'); return null; }
        only(x, ['title', 'body'], q);
        return { title: str(x.title, q + '.title', LIMITS.itemName, { required: true }), body: str(x.body, q + '.body', LIMITS.itemText) };
      }).filter(Boolean);
      else if (k === 'quotes') out[key] = arr(v, vp, 3).map((x, j) => {
        const q = `${vp}[${j}]`; if (!isObj(x)) { err(q, 'Must be an object.'); return null; }
        only(x, ['quote', 'by', 'source'], q);
        return { quote: str(x.quote, q + '.quote', LIMITS.quote, { required: true }), by: str(x.by, q + '.by', 60), source: str(x.source, q + '.source', 120, { required: true }) };
      }).filter(Boolean);
      else if (k === 'stats') out[key] = arr(v, vp, LIMITS.stats).map((x, j) => {
        const q = `${vp}[${j}]`; if (!isObj(x)) { err(q, 'Must be an object.'); return null; }
        only(x, ['value', 'label', 'source'], q);
        return { value: str(x.value, q + '.value', 20, { required: true }), label: str(x.label, q + '.label', 60, { required: true }), source: str(x.source, q + '.source', 120, { required: true }) };
      }).filter(Boolean);
      else if (k === 'faq') out[key] = arr(v, vp, LIMITS.faq).map((x, j) => {
        const q = `${vp}[${j}]`; if (!isObj(x)) { err(q, 'Must be an object.'); return null; }
        only(x, ['q', 'a'], q);
        return { q: str(x.q, q + '.q', 160, { required: true }), a: str(x.a, q + '.a', LIMITS.itemText, { required: true }) };
      }).filter(Boolean);
    }
    sections.push(out);
  });
  const types = sections.map(s => s.type);
  if (!types.includes('hero')) err('$.sections', 'A hero section is required.');
  if (types.includes('footer') && types.lastIndexOf('footer') !== types.length - 1) err('$.sections', 'The footer must be the last section.');
  if (types.includes('nav') && types.indexOf('nav') > (types[0] === 'announcement' ? 1 : 0)) err('$.sections', 'The nav must come first (after an announcement).');
  const targets = new Set(['booking', 'call', ...types]);
  const checkTarget = (t, p) => { if (t && !targets.has(t)) err(p, `Target "${t}" has no matching section in this site.`); };
  sections.forEach((s, i) => { for (const k of ['primary', 'secondary']) checkTarget(s[k]?.target, `$.sections[${i}].${k}.target`); checkTarget(s.target, `$.sections[${i}].target`); });
  sections.forEach((s, i) => {
    if (s.type === 'booking' && s.variant === 'call' && !business.phone) err(`$.sections[${i}]`, 'A call booking section needs a verified business phone.');
    if (s.type === 'booking' && s.variant === 'demo' && !concept) err(`$.sections[${i}].variant`, 'The demo booking dialog is concept-only; use variant "call" on a live site.');
    if (s.type === 'gallery' && !concept && (s.slots || 0) > business.photos.length) err(`$.sections[${i}].slots`, 'A live gallery cannot have more slots than owner-approved photos.');
    if (s.type === 'reviews' && !s.items?.length && !business.rating) err(`$.sections[${i}]`, 'Reviews needs a rating with reviewCount or owner-supplied quotes.');
    if (!concept && s.sample) err(`$.sections[${i}].sample`, 'Sample sections are not allowed when concept is false.');
    if (['process', 'faq', 'about'].includes(s.type) && !s.sample && concept && !business.about && s.type === 'about') err(`$.sections[${i}]`, 'About text not supplied by the owner must be marked sample:true.');
  });

  // seo
  const seoIn = isObj(input.seo) ? input.seo : (input.seo === undefined ? {} : (err('$.seo', 'Must be an object.'), {}));
  only(seoIn, ['title', 'description'], '$.seo');
  const seo = { title: str(seoIn.title, '$.seo.title', 70), description: str(seoIn.description, '$.seo.description', 170) };

  // unverifiable claims
  const scan = (v, p) => {
    if (typeof v === 'string') { const m = v.match(CLAIM); if (m && concept) err(p, `"${m[0]}" is a claim Nexus cannot verify. Remove it or build with concept:false after the owner confirms it.`); }
    else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${p}[${i}]`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) if (!['url', 'name', 'address', 'location', 'source', 'by'].includes(k)) scan(x, `${p}.${k}`);
  };
  scan({ intro: business.intro, about: business.about, headline: business.headline, services: business.services.filter(s => s.sample) }, '$.business');
  sections.forEach((s, i) => scan(s, `$.sections[${i}]`));
  scan(seo, '$.seo');

  const ok = errors.length === 0;
  return { ok, errors, site: ok ? { v: SITE_LANGUAGE_VERSION, concept, approval, business, theme, sections, seo } : null };
}
