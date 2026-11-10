# Nexus Site Language v1

A closed vocabulary for building small-business websites, the way the Ad vocabulary builds ads.
A **site document** (JSON) says what the site is; a strict validator checks it; a deterministic renderer
turns it into one self-contained HTML file. Agents, Forge, and the Ally all use the same four modules.

| File | Role |
| --- | --- |
| `public/site-vocabulary.mjs` | The registry: 8 moods, 14 contrast-tested palettes, 8 system-font type pairs, scales, radii, motions, decor, ~29 inline SVG glyphs, 17 section types with variants and props, 12 trade playbooks, 3 recipes, limits, honesty rules. |
| `public/site-validate.mjs` | `validateSite(doc)` (strict: unknown fields/ids/targets rejected with a path and fix) and `normalizeBusiness(lead)`. |
| `public/site-render.mjs` | `renderSite(doc)` -> HTML. Inline CSS, one inline script, CSP meta, no network or storage. |
| `public/site-compose.mjs` | `composeSite({lead, recipe, seed, theme, extras})` and `generateSiteVariants(lead)` (editorial / bold / fresh). Per-business identity from a stable hash. |
| `lib/siteLanguageTools.js` | Agent tools. |

Each module is under 60 KB so the Ally installer can pin and download them.

## Document shape

```json
{ "v": 1, "concept": true,
  "business": { "name": "", "category": "", "location": "", "phone": "", "services": [], "hours": [], "photos": [] },
  "theme": { "mood": "bold", "palette": "lime-night", "type": "impact", "scale": "grand", "radius": "sharp", "motion": "snappy", "decor": "stripes", "nav": "bar", "glyphs": ["scissors"] },
  "sections": [ { "type": "nav" }, { "type": "hero", "variant": "poster", "headline": "..." }, { "type": "services", "variant": "tiles" } ] }
```

Sections: announcement, nav, hero (split/poster/editorial/centered/stacked/ticket), marquee, services (list/cards/menu/tiles),
packages, gallery (grid/strip/mosaic), about, process, reviews, stats, faq, hours, visit, booking (demo/call), cta_band, footer.
`describe_nexus_site_language` returns the full list with props.

## Honesty rules (enforced by the validator)

- `concept: true` (default) keeps an unremovable "SAMPLE PREVIEW ... No availability is checked" banner.
- Anything not in the business record is `sample: true`, tagged SAMPLE, and cannot carry a price or duration.
- Never invented: prices, hours, phones, addresses, reviews, ratings, awards, years, counts, guarantees, photos.
  Claim words ("best", "since 1998", "licensed", "free estimate", ...) are rejected in concept mode.
- Ratings need a reviewCount; stats and quotes need a source; photos must be https without credentials.
- `concept: false` needs an approval note and rejects samples, the demo booking dialog and unbacked gallery slots.
- Deterministic: the same document always renders the same bytes. Output must stay under 58,000 characters.

## Agent tools (MCP, read-only)

`describe_nexus_site_language`, `compose_nexus_site` (lead + recipe -> site document), `render_nexus_site` (document -> validated HTML).
Nothing is saved, published or sent.

## Where it is used

Forge Leads and the call-screen site picker (`api/forge-site.js`), the Ally preview macro (`scripts/ally/forge-preview.mjs`),
the public gallery (`/forge-templates.html`) and lead storage (`lib/forgeLeads.js`). The old service-template renderer is removed.
Recipe ids stay `editorial`, `bold`, `fresh` so saved leads and previews keep working.

## Tests

`node --test test/site-language.test.mjs`
