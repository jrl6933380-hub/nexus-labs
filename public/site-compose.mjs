// Nexus Site Language v1 - composer. Business record + recipe -> a valid site document (deterministic).
// Same business and recipe always give the same site; different businesses get different identities.
import { RECIPES, PLAYBOOKS, GLYPHS } from './site-vocabulary.mjs';
import { normalizeBusiness, validateSite, pickPlaybook } from './site-validate.mjs';
import { renderSite } from './site-render.mjs';

export const SITE_RECIPES = RECIPES;
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }

export function composeSite(brief = {}) {
  const lead = brief.lead || brief.business || {};
  const biz = normalizeBusiness(lead);
  const pb = PLAYBOOKS.find(p => p.id === biz.playbook) || pickPlaybook(biz.category);
  const recipe = RECIPES.find(r => r.id === (brief.recipe || pb.recipes[0]));
  if (!recipe) throw Error('Unknown recipe. Use one of: ' + RECIPES.map(r => r.id).join(', '));
  const key = [biz.name, biz.category, biz.location, recipe.id, brief.seed || ''].join('|');
  const pick = (arr, salt) => arr[fnv(key + '#' + salt) % arr.length];
  const theme = {
    mood: recipe.mood, palette: pick(recipe.palettes, 'pal'), type: pick(recipe.types, 'type'),
    scale: recipe.id === 'bold' ? 'grand' : recipe.id === 'editorial' ? 'balanced' : 'balanced',
    radius: pick(recipe.radius, 'rad'), motion: recipe.motion, decor: pb.decor, nav: pick(recipe.nav, 'nav'),
    glyphs: pb.glyphs.map((g, i, a) => a[(i + fnv(key + '#gl') % a.length) % a.length]),
    ...(brief.theme && typeof brief.theme === 'object' ? brief.theme : {})
  };
  const x = brief.extras && typeof brief.extras === 'object' ? brief.extras : {};
  const place = biz.location ? ` in ${biz.location}` : '';
  const heroVariant = pick(recipe.heroes, 'hero');
  const photoSlots = Math.min(6, Math.max(biz.photos.length, recipe.gallery === 'mosaic' ? 5 : 4));
  const make = {
    announcement: () => x.announcement ? { type: 'announcement', text: x.announcement } : null,
    nav: () => ({ type: 'nav', variant: theme.nav, label: 'Book', target: 'booking' }),
    hero: () => ({ type: 'hero', variant: heroVariant, kicker: [biz.category, biz.location].filter(Boolean).join(' · '), headline: biz.headline || pick(pb.headlines, 'hl'), sub: biz.intro || `A sample direction for ${biz.name}${place}. Details and photos are placeholders until the owner confirms them.`, primary: { label: 'Request a time', target: 'booking' }, secondary: { label: 'See services', target: 'services' }, ...(biz.photos.length ? { photo: 0 } : {}), glyph: theme.glyphs[0] }),
    marquee: () => ({ type: 'marquee', items: pb.words.slice(0, 6) }),
    services: () => ({ type: 'services', variant: pick(recipe.services, 'svc'), title: 'Services' }),
    packages: () => x.packages?.length ? { type: 'packages', title: 'Packages', items: x.packages } : null,
    gallery: () => ({ type: 'gallery', variant: recipe.gallery, title: 'Recent work', slots: photoSlots }),
    about: () => ({ type: 'about', variant: 'split', title: 'About', body: biz.about || `${biz.name} is a ${pb.noun}${place}. This is placeholder text for a short story the owner will write.`, sample: !biz.about, ...(biz.about ? {} : {}) }),
    process: () => ({ type: 'process', title: 'How it works', sample: true, steps: [{ title: 'Choose a service', body: 'Pick what you need from the list.' }, { title: 'Ask for a time', body: 'Send a request or call.' }, { title: 'Come in', body: 'Arrive and we take it from there.' }] }),
    reviews: () => biz.rating || x.quotes?.length ? { type: 'reviews', variant: x.quotes?.length ? 'cards' : 'strip', title: 'What people say', ...(x.quotes?.length ? { items: x.quotes } : {}) } : null,
    stats: () => x.stats?.length ? { type: 'stats', items: x.stats } : null,
    faq: () => x.faq?.length ? { type: 'faq', title: 'Questions', items: x.faq, sample: x.faqSample === true } : null,
    hours: () => ({ type: 'hours', title: 'Hours' }),
    visit: () => ({ type: 'visit', title: 'Visit', ...(x.mapUrl ? { mapUrl: x.mapUrl } : {}) }),
    booking: () => ({ type: 'booking', variant: 'demo', title: 'Request an appointment', label: 'Request a time' }),
    cta_band: () => ({ type: 'cta_band', headline: 'Ready when you are.', primary: { label: 'Request a time', target: 'booking' } }),
    footer: () => ({ type: 'footer', variant: recipe.id === 'bold' ? 'columns' : 'simple' })
  };
  const order = [...recipe.order];
  const swap = (a, b) => { const i = order.indexOf(a), j = order.indexOf(b); if (i > -1 && j > -1) [order[i], order[j]] = [order[j], order[i]]; };
  if (fnv(key + '#swap') % 2) swap('about', 'services');
  for (const extra of ['reviews', 'stats', 'packages', 'faq']) if (!order.includes(extra) && make[extra]()) order.splice(Math.max(order.indexOf('hours'), 0), 0, extra);
  if (x.announcement && !order.includes('announcement')) order.unshift('announcement');
  const sections = order.map(t => make[t]()).filter(Boolean);
  const site = { v: 1, concept: true, business: biz, theme, sections, seo: {} };
  const v = validateSite(site);
  if (!v.ok) throw Object.assign(new Error('Composer produced an invalid site: ' + v.errors[0].path + ' ' + v.errors[0].message), { issues: v.errors });
  return v.site;
}

// Pitch-ready variants for a lead, ordered with the best-fit recipe for the trade first.
export function generateSiteVariants(lead) {
  const pb = pickPlaybook(normalizeBusiness(lead).category);
  const order = [...pb.recipes, ...RECIPES.map(r => r.id).filter(id => !pb.recipes.includes(id))];
  return order.map(id => { const r = RECIPES.find(x => x.id === id); return { id, label: r.name, description: r.description, html: renderSite(composeSite({ lead, recipe: id })) }; });
}
export const renderSiteVariant = (lead, recipe = 'editorial', overrides = {}) => renderSite(composeSite({ lead, recipe, ...overrides }));
