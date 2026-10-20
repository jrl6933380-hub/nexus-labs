# Nexus concept site library

Fifteen local-business concepts. Run from the repository root:

```sh
python3 site-library/render.py
```

Open `out/index.html` for the embedded viewer, or any `out/<id>.html` directly.
No Python dependencies or image downloads are required. Google Fonts is optional;
system fonts work offline. Nothing here is deployed by running the generator.

## Source

- `gen.py`: original twelve business recipes, with palettes, copy, SVG illustrations,
  services, sample hours and enquiry fields.
- `new_sites.py`: café, florist and tattoo studio recipes.
- `directions.py`: explicit business-specific section order and visual composition.
  Reuse form mechanics; deliberately vary hierarchy, proportions and page rhythm.
- `assets/*.json`: optimized embedded JPEGs with alt text, generation provenance and
  a retained prompt brief. Text assets keep the standalone viewer portable and let
  both agents update the same source through the existing text commit tools.
- `render.py`: shared accessible form, hours, navigation and viewer mechanics.

To add a business, add a `site(...)` recipe. Give it an explicit `ORDERS` entry and
scoped visual rules in `directions.py`; omitted entries retain the original order.
Each order must contain `hero`, `s`, `x`, `g`, `h`, `q` exactly once. A recipe can use
`show_gallery=False` when a sample gallery would add filler. The corresponding
navigation item and section are omitted together.

Use `hero_image={"src": "data:image/jpeg;base64,...", "alt": "..."}` for supplied
or generated images. PNG and WebP data URLs also work. The renderer rejects remote
image URLs to preserve the self-contained preview. Keep the original generation
outside the recipe when iterating, and commit the chosen optimized asset. Do not
mistake a generated image for a customer's product, premises or finished work.

## Design fingerprints

| Business | Purpose and composition | Type, material and signature |
| --- | --- | --- |
| Barber | Service choice and booking before team/gallery | Condensed poster type, cream/ink/red, oversized narrow headline, dark booking area |
| Lawn | Process and coverage before the gallery | Rounded sturdy type, green/field colors, arched landscape and linear process |
| Cleaning | Package selection then checklist and enquiry | Soft serif/sans, airy teal, rounded package groups and arched opening |
| Food truck | Sample stops/hours immediately after the opening, then menu | Heavy geometric type, warm orange, full-width menu rows |
| Bakery | Sample gallery before products | Warm expressive serif, pastry colors, staggered gallery rhythm |
| Auto repair | Appointment enquiry before full service list | Industrial condensed type, steel/blue, practical repair-first hierarchy |
| Photography | Image-led opening then asymmetric sample portfolio | Editorial serif, neutral materials, full-bleed illustration with readable caption panel |
| DJ | Event list before gallery and services | Geometric expressive type, dark violet, circular record and event rows |
| Realty | Sample listings immediately after opening | Calm serif, navy/green, generous listing panels |
| Church | Visitor hours/location and upcoming events first | Welcoming serif, warm paper, arched illustration and visitor information band |
| Tutor | Subjects and learning process before enquiry | Friendly sans, indigo, angled lesson illustration and two-column subject list |
| Gym | Class week before programs | Athletic condensed type, charcoal/orange, tall poster and schedule band |
| Café | Drink menu beside a typographic heading; visit info next | Condensed display/sans, vermilion/cream, editorial espresso photo and ruled menu |
| Florist | Large arched arrangement image, occasion selection, process | Restrained serif/sans, ivory/olive/rose, asymmetric whitespace and open occasion rows |
| Tattoo | Illustration and consultation process before styles | Condensed display/sans, charcoal/ivory, original moth engraving and horizontal style rows |

The three new image assets were generated with the built-in image tool. Briefs:
editorial espresso on vermilion; a loose rose/dahlia/cosmos arrangement on plaster;
an original moth blackwork engraving on charcoal. Full descriptive briefs are in
the JSON assets. No photographed client work is implied.

## Preview boundaries

Every site is a labeled concept with sample business information. Never invent
prices, reviews, licenses, guarantees or performance statistics. The contractor
concept remains separate in the original private library page.

Forms validate locally and show a demo confirmation. They send nothing and do not
create a real booking, payment or order. Sample open/closed status uses the viewer's
local clock; actual business timezone/availability requires setup. Inbox delivery
and other integrations must be connected separately.

The gallery uses native expandable cards with complete inline pages. It requires
no scripts, iframe support or external page files, including in mobile document
previewers. Styles and IDs are scoped per business; service choices and sample
hours are present in the markup. Gallery forms are display-only. Individual site
files retain their interactive demo forms.
Reduced-motion, keyboard focus, touch targets and mobile layout rules are included.

## Validation

```sh
python3 site-library/check.py
```

Checks all fifteen generated documents, section order and uniqueness, fragment
links, form labels, embedded image decoding, script escaping, and JavaScript
syntax (requires Node for syntax validation). This is structural validation, not
browser layout or interaction testing. Gallery checks also cover native expand controls, unique scoped IDs, working
fragment/label references and static services/hours without scripts or iframes.
Browser inspection is still needed at
mobile and desktop widths before treating a design as production-ready.

Future work: replace remaining legacy SVG illustrations and sample gallery tiles
with business-specific imagery; build richer actual portfolios; connect forms only
when a real business's information and delivery destination are supplied.
