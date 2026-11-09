// Agent-facing side of the Nexus Site Language: describe, compose and render. Read-only: nothing is saved,
// published, fetched or sent. The same pure modules the Forge preview builder and the Ally use.
import { describeSiteVocabulary, RECIPES, HONESTY_RULES } from '../public/site-vocabulary.mjs';
import { composeSite, generateSiteVariants } from '../public/site-compose.mjs';
import { renderSiteSafe } from '../public/site-render.mjs';
import { validateSite } from '../public/site-validate.mjs';

const MAX_INPUT = 60000;
const tooBig = v => { try { return JSON.stringify(v ?? null).length > MAX_INPUT; } catch { return true; } };
export const SITE_RECIPE_IDS = RECIPES.map(r => r.id);

export function describeSiteLanguage() {
  const example = composeSite({ lead: { businessName: 'Marlow Barber Studio', category: 'Barber', location: 'Iowa City, IA' }, recipe: 'bold' });
  return {
    ...describeSiteVocabulary(),
    example_site: example,
    agent_rules: [...HONESTY_RULES, 'Use only ids from this response. Unknown fields and values are rejected with a path and a fix.', 'compose_nexus_site makes a first draft; edit the returned site and pass it to render_nexus_site to iterate.', 'Rendering saves nothing. Publishing, domains and outreach are separate steps that need the owner\'s approval.']
  };
}

export function composeSiteTool(input = {}) {
  if (tooBig(input)) return { ok: false, issues: [{ path: '$', message: 'Input too large.' }] };
  try {
    const site = composeSite({ lead: input.lead, recipe: input.recipe, seed: input.seed, theme: input.theme, extras: input.extras });
    const r = renderSiteSafe(site);
    return { ok: r.ok, site, bytes: r.bytes, issues: r.issues, ...(input.include_html && r.ok ? { html: r.html } : {}) };
  } catch (e) { return { ok: false, issues: e.issues || [{ path: '$', message: String(e.message || e).slice(0, 200) }] }; }
}

export function renderSiteTool(input = {}) {
  if (tooBig(input)) return { ok: false, issues: [{ path: '$', message: 'Input too large.' }] };
  const v = validateSite(input.site);
  if (!v.ok) return { ok: false, issues: v.errors };
  const r = renderSiteSafe(v.site);
  return { ok: r.ok, site: v.site, bytes: r.bytes, issues: r.issues, ...(input.include_html && r.ok ? { html: r.html } : {}) };
}
export { generateSiteVariants };
