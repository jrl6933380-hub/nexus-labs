# Site library (concept previews)

One generator, many local-business concept sites.

- `gen.py` holds one short config per business: palette, fonts, services, hours, form fields, hero drawing.
- `render.py` turns each config into a full page (`out/<id>.html`) and builds `out/index.html`, a viewer with every site embedded.

    python3 site-library/render.py     # run from the repo root, writes ./out/

To add a business, copy a `site(...)` block in `gen.py` and change the values. Nothing else is needed.

Businesses so far: barber, lawn care, cleaning, food truck, bakery, auto repair, photographer, DJ,
real estate, church, tutor, gym. The contractor concept (Ridgeline Build Co) was hand-built first and
the generator was modeled on it; it lives in the private artifact "Nexus Site Library" with the rest.

Rules for every site: labeled concept preview, sample names, hours and numbers only, never invent
prices, reviews, licenses, guarantees or stats. Forms are client-side only and send nothing.

Known gap: every generated site shares one page skeleton (hero, services, one extra section, gallery,
hours, form). The hero comes in three variants (split, centered, band). Next step is richer per-business
layouts.

Planned: turn each config into an Ad Maker `site_page` ad, add menu / form / hours / gallery scene
types to the vocabulary, and a plain-language tool picker so each customer gets their own assistant.
