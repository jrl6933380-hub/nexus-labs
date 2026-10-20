# Site library (concept previews)

One generator, many local-business concept sites. Each business is a short config in `gen.py`
(palette, fonts, services, hours, form fields, hero drawing). Running it writes one HTML page per
business plus an `index.html`.

    python3 site-library/gen.py        # writes out/ in the current directory

The contractor concept (Ridgeline Build Co) was hand-built first and the generator was modeled on it.
All 13 sites live in the private artifact "Nexus Site Library".

Rules for every site: labeled concept preview, sample names/hours/numbers only, never invent prices,
reviews, licenses, guarantees or stats. Forms are client-side only and send nothing.

Known gap: every generated site shares one layout skeleton (hero, services, section, gallery, hours,
form). Next step is per-business layout variants.

Planned: turn each config into an Ad Maker `site_page` ad, add menu / form / hours / gallery scene
types to the vocabulary, and a plain-language tool picker so each customer gets their own assistant.
