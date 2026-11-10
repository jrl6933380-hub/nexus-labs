// Nexus Site Language v1 - the closed vocabulary. Pure data + one describe function.
// Everything a site document may say comes from this registry; the validator rejects anything else.
// No network, storage, model or tenant credentials. Shared by browser, Vercel and the Ally.
export const SITE_LANGUAGE_VERSION = 1;

export const LIMITS = Object.freeze({
  name: 100, category: 100, location: 150, phone: 60, address: 240, headline: 150, sub: 300, kicker: 60, label: 40,
  body: 900, itemName: 100, itemText: 220, price: 40, duration: 40, url: 2000, alt: 180, credit: 180,
  services: 12, photos: 6, hours: 7, sections: 18, items: 12, steps: 6, faq: 8, packages: 4, stats: 4, marquee: 8, points: 5,
  quote: 400, html: 58000, id: 40
});

const T = (id, name, description) => Object.freeze({ id, name, description });
const list = (...a) => Object.freeze(a.map(Object.freeze));

// ---- design tokens -------------------------------------------------------------------------
export const MOODS = list(
  T('editorial', 'Editorial', 'Warm paper, large serif type, a studio journal.'),
  T('bold', 'Bold', 'Dark canvas, oversized type, graphic menu.'),
  T('fresh', 'Fresh', 'Airy colour, rounded shapes, appointment-first.'),
  T('warm', 'Warm', 'Earthy, friendly, neighbourhood feel.'),
  T('luxury', 'Luxury', 'Dark, spacious, thin rules and refined type.'),
  T('playful', 'Playful', 'Bright colour, chunky shapes, loose rhythm.'),
  T('rugged', 'Rugged', 'Heavy slab type, hard edges, workshop energy.'),
  T('clean', 'Clean', 'Plain and exact: a tidy business card.')
);

// paper/ink/muted/line/panel/accent/accentInk are contrast-tested in test/site-language.test.mjs.
const P = (id, dark, paper, ink, muted, line, panel, accent, accentInk) => Object.freeze({ id, dark, paper, ink, muted, line, panel, accent, accentInk });
export const PALETTES = list(
  P('paper-green', false, '#f4f0e7', '#282d24', '#5c6152', '#d3d0c3', '#e9e5d9', '#8b472a', '#ffffff'),
  P('lime-night', true, '#151615', '#f4f0e7', '#b6b9ac', '#42463d', '#242722', '#c7e84e', '#1d2414'),
  P('mint-air', false, '#f7faf7', '#163d36', '#4b665d', '#c8d9cf', '#e6f0e9', '#1f6f5c', '#ffffff'),
  P('barber-red', false, '#f6f1ea', '#1b1f2a', '#555a66', '#ddd3c6', '#ece4d8', '#b8321f', '#ffffff'),
  P('navy-gold', true, '#0f1b2d', '#f2ead7', '#b9c0cc', '#2c3d57', '#17283f', '#d6a84a', '#1a1405'),
  P('blush', false, '#fbf1ef', '#3a2330', '#6d5160', '#ecd3d0', '#f5e0dd', '#b83a5c', '#ffffff'),
  P('ink-bone', false, '#f2efe9', '#131313', '#555555', '#d4cfc6', '#e7e2d8', '#c93a1b', '#ffffff'),
  P('forest', true, '#14231c', '#e8efe6', '#a9bbae', '#2f4a3b', '#1c3328', '#9bd37a', '#10200f'),
  P('terracotta', false, '#f7ece1', '#3b2418', '#6c5143', '#e3cbb5', '#efdac8', '#b2491f', '#ffffff'),
  P('sky', false, '#eef5fb', '#12304a', '#4a6479', '#c7dbea', '#dde9f4', '#1766c2', '#ffffff'),
  P('plum', true, '#1d1328', '#f3ecf8', '#c3b4d1', '#3d2b52', '#291b3a', '#ff8bd1', '#2a0c20'),
  P('sand', false, '#f3ead8', '#2c2a22', '#5f5a49', '#dccfb2', '#eadfc5', '#8f5b14', '#ffffff'),
  P('graphite-orange', true, '#1c1d1f', '#f1f1ee', '#b5b6b0', '#3b3d40', '#27292c', '#ff7a1a', '#1c0e00'),
  P('lilac', false, '#f4f0fb', '#2a2140', '#5c5373', '#d9cfee', '#e8e0f7', '#6340e0', '#ffffff')
);

export const TYPE_PAIRS = Object.freeze([
  { id: 'serif-sans', head: "Georgia,'Times New Roman',serif", body: "system-ui,-apple-system,'Segoe UI',Arial,sans-serif", hw: 700, hcase: 'none', track: '-.02em' },
  { id: 'impact', head: "Impact,'Arial Narrow Bold','Arial Narrow',sans-serif", body: "Arial,Helvetica,sans-serif", hw: 400, hcase: 'uppercase', track: '.01em' },
  { id: 'rounded', head: "'Avenir Next','Segoe UI',system-ui,sans-serif", body: "system-ui,-apple-system,'Segoe UI',Arial,sans-serif", hw: 800, hcase: 'none', track: '-.03em' },
  { id: 'didone', head: "'Bodoni 72',Didot,'Bodoni MT',Georgia,serif", body: "'Gill Sans','Trebuchet MS',Arial,sans-serif", hw: 400, hcase: 'none', track: '-.01em' },
  { id: 'slab', head: "Rockwell,'Roboto Slab','Courier New',Georgia,serif", body: "'Trebuchet MS',Arial,sans-serif", hw: 800, hcase: 'uppercase', track: '.005em' },
  { id: 'mono-accent', head: "ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace", body: "system-ui,-apple-system,'Segoe UI',Arial,sans-serif", hw: 700, hcase: 'uppercase', track: '-.02em' },
  { id: 'humanist', head: "'Trebuchet MS','Gill Sans',system-ui,sans-serif", body: "'Gill Sans','Trebuchet MS',system-ui,sans-serif", hw: 700, hcase: 'none', track: '-.015em' },
  { id: 'grotesk', head: "'Helvetica Neue',Helvetica,Arial,sans-serif", body: "'Helvetica Neue',Helvetica,Arial,sans-serif", hw: 900, hcase: 'none', track: '-.045em' }
].map(Object.freeze));

export const SCALES = list(T('compact', 'Compact', 'Smaller headings, denser pages.'), T('balanced', 'Balanced', 'Default sizing.'), T('grand', 'Grand', 'Oversized hero type.'));
export const SCALE_VALUES = Object.freeze({ compact: { h1: 'clamp(2.1rem,6vw,3.6rem)', h2: 'clamp(1.5rem,3.6vw,2.2rem)', pad: '56px' }, balanced: { h1: 'clamp(2.5rem,8vw,4.8rem)', h2: 'clamp(1.8rem,4.6vw,2.9rem)', pad: '72px' }, grand: { h1: 'clamp(3rem,12vw,7.4rem)', h2: 'clamp(2.1rem,6vw,3.8rem)', pad: '92px' } });
export const RADII = list(T('sharp', 'Sharp', '0px'), T('soft', 'Soft', '10px'), T('round', 'Round', '22px'), T('pill', 'Pill', '999px'));
export const RADIUS_VALUES = Object.freeze({ sharp: ['0', '0'], soft: ['10px', '8px'], round: ['24px', '14px'], pill: ['32px', '999px'] });
export const MOTIONS = list(T('none', 'None', 'Static.'), T('soft', 'Soft', 'Gentle fade-up on scroll.'), T('snappy', 'Snappy', 'Quick slide-in on scroll.'));
export const DECORS = list(T('none', 'None', 'Flat colour.'), T('grain', 'Grain', 'Fine paper grain.'), T('stripes', 'Stripes', 'Diagonal barber stripes.'), T('dots', 'Dots', 'Halftone dots.'), T('grid', 'Grid', 'Blueprint grid.'), T('rule', 'Rule', 'Double rule frame.'));
export const NAV_STYLES = list(T('bar', 'Bar', 'Brand left, links right.'), T('center', 'Center', 'Centered brand over links.'), T('minimal', 'Minimal', 'Brand and one button.'));

// ---- glyphs: 24x24 stroke paths, drawn inline (no files, no network) ---------------------------
export const GLYPHS = Object.freeze({
  scissors: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.1 8.1 20 20M8.1 15.9 20 4',
  comb: 'M3 7h18v4H3zM5 11v6M8 11v6M11 11v6M14 11v6M17 11v6M20 11v6',
  razor: 'M4 15 15 4l5 5L9 20zM8 11l5 5',
  pole: 'M8 3h8v18H8zM8 8l8 4M8 13l8 4M6 3h12M6 21h12',
  wrench: 'M14.5 6a4 4 0 0 0 5 5l-9.8 9.8a2.1 2.1 0 0 1-3-3L16.5 8M14.5 6 18 2.5l3.5 3.5',
  car: 'M3 15v-3l2-5h14l2 5v3zM3 15v3h3v-3M18 15v3h3v-3M6 12h12',
  leaf: 'M5 19C5 9 11 4 20 4c0 9-5 15-15 15zM5 19 14 10',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11z',
  sparkle: 'M12 3l2 6 6 3-6 3-2 6-2-6-6-3 6-3zM19 3v4M17 5h4',
  flame: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  home: 'M3 11 12 3l9 8M5 10v10h14V10M10 20v-6h4v6',
  key: 'M8 14a4 4 0 1 1 3-1l9 9M16 18l2-2M13 15l2-2',
  brush: 'M4 20c3 0 5-1 5-4 0-2 2-3 4-3l7-9-3-1-8 8c-2 1-3 3-5 9z',
  star: 'M12 3l2.800 5.700 6.200.9-4.500 4.400 1 6.200L12 17.200 6.500 20.200l1-6.200L3 9.600l6.200-.9z',
  heart: 'M12 20S4 14.500 4 9a4.500 4.500 0 0 1 8-2.500A4.500 4.500 0 0 1 20 9c0 5.500-8 11-8 11z',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  fork: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 2-3 5-3 8h3v10',
  phone: 'M6 3h4l2 5-2.500 1.500a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 2-3z',
  pin: 'M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11zM12 12a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  hammer: 'M14 4l6 6-3 3-6-6zM12 8 4 16l4 4 8-8',
  paw: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4.500 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19.500 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 12c-3 0-6 4-6 6s2 2 6 2 6 0 6-2-3-6-6-6z',
  nail: 'M8 21V9a4 4 0 0 1 8 0v12zM10 12h4',
  needle: 'M4 20 18 6l2 2L6 22zM18 6l2-2 2 2-2 2',
  broom: 'M14 3l7 7-3 1-6-6zM13 8 4 17l3 3 9-9zM6 19l-2 2',
  tooth: 'M7 4c-3 0-4 3-3 6s2 5 2 8c0 2 2 2 2 0 0-2 1-4 2-4s2 2 2 4c0 2 2 2 2 0 0-3 1-5 2-8s0-6-3-6c-2 0-2 1-3 1S9 4 7 4z',
  bag: 'M5 8h14l1 13H4zM9 8a3 3 0 0 1 6 0'
});

// ---- sections ----------------------------------------------------------------------------------
// props: name -> kind. kinds: text:<max>, list:<kind>, number, bool, enum:<a|b>, photo (index), target.
export const SECTIONS = Object.freeze({
  announcement: { variants: ['bar'], props: { text: 'text:160' }, needs: ['text'], about: 'Thin strip above the nav (e.g. a notice the owner has confirmed).' },
  nav: { variants: ['bar', 'center', 'minimal'], props: { label: 'text:40', target: 'target' }, about: 'Brand and links. Links are generated from the sections present; optional CTA button.' },
  hero: { variants: ['split', 'poster', 'editorial', 'centered', 'stacked', 'ticket'], props: { kicker: 'text:60', headline: 'text:150', sub: 'text:300', primary: 'cta', secondary: 'cta', photo: 'number', glyph: 'glyph' }, needs: ['headline'], about: 'First screen. Photo index points at business.photos; without a photo an honest brand artwork block is drawn.' },
  marquee: { variants: ['ticker'], props: { items: 'strings:8:40' }, needs: ['items'], about: 'Looping short phrases (services or craft words). Static when motion is none or reduced.' },
  services: { variants: ['list', 'cards', 'menu', 'tiles'], props: { title: 'text:100', intro: 'text:220', items: 'services' }, about: 'Service list. Items come from business.services (supplied facts) or labelled samples.' },
  packages: { variants: ['columns'], props: { title: 'text:100', items: 'packages' }, needs: ['items'], about: 'Owner-supplied bundles only; every item needs a price the owner confirmed.' },
  gallery: { variants: ['grid', 'strip', 'mosaic'], props: { title: 'text:100', slots: 'number' }, about: 'Photos from business.photos; remaining slots are labelled portfolio placeholders.' },
  about: { variants: ['split', 'text'], props: { title: 'text:100', body: 'text:900', points: 'strings:5:80', photo: 'number' }, needs: ['body'], about: 'Short story or description. Placeholder text must be marked sample.' },
  process: { variants: ['steps'], props: { title: 'text:100', steps: 'steps' }, needs: ['steps'], about: 'Numbered steps. Mark sample:true unless the owner described the process.' },
  reviews: { variants: ['strip', 'cards'], props: { title: 'text:100', items: 'quotes' }, about: 'Shows the rating (needs reviewCount) and owner-supplied quotes with a source. Never invented.' },
  stats: { variants: ['row'], props: { items: 'stats' }, needs: ['items'], about: 'Up to 4 figures; each needs a source string. Never invented.' },
  faq: { variants: ['accordion'], props: { title: 'text:100', items: 'faq' }, needs: ['items'], about: 'Questions in native details/summary. Placeholder answers must be marked sample.' },
  hours: { variants: ['table'], props: { title: 'text:100' }, about: 'Opening hours table from business.hours; otherwise "Opening hours to be confirmed".' },
  visit: { variants: ['card'], props: { title: 'text:100', mapUrl: 'url' }, about: 'Address, phone and an optional https map link from the business record.' },
  booking: { variants: ['demo', 'call'], props: { title: 'text:100', intro: 'text:220', label: 'text:40' }, about: 'demo: a dialog form that sends nothing and checks no availability (concept only). call: a tel link for live sites.' },
  cta_band: { variants: ['band'], props: { headline: 'text:150', primary: 'cta' }, needs: ['headline'], about: 'Full-width call to action.' },
  footer: { variants: ['simple', 'columns'], props: { note: 'text:220' }, about: 'Business name, location, phone, and the concept notice when concept is true.' }
});

export const CTA_TARGETS = Object.freeze(['booking', 'call', 'services', 'gallery', 'about', 'process', 'reviews', 'faq', 'hours', 'visit', 'packages']);

// ---- industry playbooks ------------------------------------------------------------------------
// Sample copy only. No superlatives, years, prices, awards, counts or promises; items are marked sample.
const PB = (id, match, o) => Object.freeze({ id, match, ...o });
export const PLAYBOOKS = list(
  PB('barber', /barber|fade|shave/i, { glyphs: ['scissors', 'comb', 'razor', 'pole'], craft: 'Cut. Shape. Character.', noun: 'barbershop', services: ['Signature cut', 'Cut & finish', 'Beard detail', 'Full refresh'], words: ['Fades', 'Tapers', 'Beards', 'Hot towel', 'Line-ups'], headlines: ['Sharp lines, easy mornings.', 'A good cut changes the day.', 'Walk in rough, leave ready.'], decor: 'stripes', recipes: ['bold', 'editorial'] }),
  PB('nails', /nail|manicure|pedicure/i, { glyphs: ['nail', 'sparkle', 'brush', 'heart'], craft: 'Color. Shape. Detail.', noun: 'nail studio', services: ['Signature manicure', 'Gel color', 'Nail art', 'Pedicure'], words: ['Gel', 'Acrylic', 'Nail art', 'Pedicures', 'Fills'], headlines: ['A little color. A little you.', 'Details worth looking at.', 'Hands, finished.'], decor: 'dots', recipes: ['fresh', 'editorial'] }),
  PB('salon', /hair|salon|stylist|braid|lash|brow|spa|beauty/i, { glyphs: ['scissors', 'sparkle', 'comb', 'heart'], craft: 'Style. Care. Confidence.', noun: 'salon', services: ['Consultation', 'Cut & style', 'Colour appointment', 'Treatment'], words: ['Cuts', 'Colour', 'Styling', 'Treatments'], headlines: ['Feel like yourself, polished.', 'Hair worth the appointment.'], decor: 'grain', recipes: ['editorial', 'fresh'] }),
  PB('tattoo', /tattoo|piercing|ink/i, { glyphs: ['needle', 'flame', 'star', 'heart'], craft: 'Line. Shade. Story.', noun: 'tattoo studio', services: ['Consultation', 'Custom piece', 'Flash piece', 'Touch-up'], words: ['Custom', 'Flash', 'Fine line', 'Cover-ups'], headlines: ['Art that stays with you.', 'Your story, drawn in ink.'], decor: 'grain', recipes: ['bold', 'editorial'] }),
  PB('auto', /auto|car |mechanic|tire|detail|garage|collision|repair shop|oil change/i, { glyphs: ['wrench', 'car', 'bolt', 'key'], craft: 'Inspect. Repair. Drive.', noun: 'auto shop', services: ['Inspection', 'Maintenance visit', 'Repair estimate', 'Detail service'], words: ['Brakes', 'Oil', 'Tires', 'Diagnostics', 'Detailing'], headlines: ['Back on the road.', 'Straight answers, solid work.'], decor: 'grid', recipes: ['bold', 'fresh'] }),
  PB('trades', /plumb|electric|hvac|roof|handyman|contractor|carpent|paint|remodel|construction|fence|concrete/i, { glyphs: ['hammer', 'wrench', 'home', 'bolt'], craft: 'Plan. Build. Finish.', noun: 'service company', services: ['Estimate request', 'On-site visit', 'Repair work', 'Project work'], words: ['Repairs', 'Installs', 'Estimates', 'Projects'], headlines: ['Plain talk, tidy work.', 'Call it in. Tell us what you need.'], decor: 'grid', recipes: ['bold', 'fresh'] }),
  PB('outdoor', /lawn|landscap|garden|tree|snow|mow|yard|pressure wash/i, { glyphs: ['leaf', 'drop', 'home', 'broom'], craft: 'Tidy. Grow. Maintain.', noun: 'outdoor service', services: ['Seasonal cleanup', 'Regular visits', 'Planting & beds', 'One-time job'], words: ['Mowing', 'Cleanups', 'Beds', 'Trimming'], headlines: ['Yards that look cared for.', 'Outside, sorted.'], decor: 'dots', recipes: ['fresh', 'editorial'] }),
  PB('cleaning', /clean|maid|janitor|laundry|dry clean|window/i, { glyphs: ['broom', 'sparkle', 'drop', 'home'], craft: 'Tidy. Fresh. Done.', noun: 'cleaning service', services: ['Standard clean', 'Deep clean', 'Move-out clean', 'Recurring visits'], words: ['Homes', 'Offices', 'Move-outs', 'Windows'], headlines: ['Come home to clean.', 'Fresh space, fewer chores.'], decor: 'none', recipes: ['fresh', 'editorial'] }),
  PB('food', /restaurant|cafe|coffee|bakery|pizza|diner|taqueria|grill|catering|food truck|bar &|deli|bbq/i, { glyphs: ['fork', 'flame', 'heart', 'star'], craft: 'Cook. Serve. Gather.', noun: 'kitchen', services: ['House favourite', 'Daily special', 'Catering enquiry', 'Order ahead'], words: ['Dine in', 'Take out', 'Catering', 'Daily specials'], headlines: ['Made fresh, served warm.', 'Pull up a chair.'], decor: 'grain', recipes: ['editorial', 'bold'] }),
  PB('pets', /pet|dog|groom|vet|kennel|animal/i, { glyphs: ['paw', 'heart', 'drop', 'star'], craft: 'Care. Play. Wag.', noun: 'pet service', services: ['Intro visit', 'Grooming appointment', 'Boarding enquiry', 'Walk or day care'], words: ['Grooming', 'Walks', 'Boarding', 'Care'], headlines: ['Happy pets, happy people.', 'Care they can feel.'], decor: 'dots', recipes: ['fresh', 'editorial'] }),
  PB('photo', /photo|video|studio|film|portrait/i, { glyphs: ['camera', 'star', 'sparkle', 'heart'], craft: 'Frame. Light. Moment.', noun: 'studio', services: ['Consultation', 'Portrait session', 'Event coverage', 'Editing & delivery'], words: ['Portraits', 'Events', 'Brands', 'Prints'], headlines: ['Moments, kept.', 'Seen in the right light.'], decor: 'grain', recipes: ['editorial', 'bold'] }),
  PB('fitness', /gym|fitness|yoga|pilates|trainer|martial|boxing|crossfit|dance/i, { glyphs: ['bolt', 'flame', 'heart', 'star'], craft: 'Move. Build. Repeat.', noun: 'studio', services: ['Intro session', 'Class visit', 'Personal training', 'Membership enquiry'], words: ['Classes', 'Training', 'Strength', 'Mobility'], headlines: ['Start where you are.', 'Strong looks good on you.'], decor: 'stripes', recipes: ['bold', 'fresh'] }),
  PB('generic', /./, { glyphs: ['star', 'sparkle', 'pin', 'heart'], craft: 'Care. Craft. Detail.', noun: 'local business', services: ['Signature appointment', 'Personal consultation', 'Standard service', 'Follow-up visit'], words: ['Local', 'Personal', 'By appointment'], headlines: ['Good care starts here.', 'Local, personal, ready when you are.'], decor: 'none', recipes: ['editorial', 'fresh'] })
);

// ---- recipes: named design directions the composer expands per business -----------------------
export const RECIPES = list(
  Object.freeze({ id: 'editorial', name: 'Editorial', description: 'Warm paper, large serif type, a studio journal.', mood: 'editorial', palettes: ['paper-green', 'sand', 'terracotta', 'blush', 'ink-bone'], types: ['serif-sans', 'didone', 'humanist'], heroes: ['editorial', 'split'], services: ['menu', 'list'], gallery: 'mosaic', radius: ['sharp', 'soft'], motion: 'soft', nav: ['bar', 'minimal'], order: ['announcement', 'nav', 'hero', 'about', 'services', 'gallery', 'process', 'hours', 'visit', 'booking', 'footer'] }),
  Object.freeze({ id: 'bold', name: 'Bold', description: 'Dark canvas, oversized type, a graphic service menu.', mood: 'bold', palettes: ['lime-night', 'graphite-orange', 'navy-gold', 'plum', 'forest'], types: ['impact', 'slab', 'grotesk', 'mono-accent'], heroes: ['poster', 'ticket'], services: ['tiles', 'cards'], gallery: 'strip', radius: ['sharp', 'soft'], motion: 'snappy', nav: ['bar', 'center'], order: ['nav', 'hero', 'marquee', 'services', 'gallery', 'about', 'hours', 'booking', 'cta_band', 'visit', 'footer'] }),
  Object.freeze({ id: 'fresh', name: 'Fresh', description: 'Airy colour, clear service choices, an appointment-first layout.', mood: 'fresh', palettes: ['mint-air', 'sky', 'lilac', 'blush', 'terracotta'], types: ['rounded', 'humanist', 'grotesk'], heroes: ['centered', 'stacked', 'split'], services: ['cards', 'list'], gallery: 'grid', radius: ['round', 'pill'], motion: 'soft', nav: ['bar', 'minimal'], order: ['nav', 'hero', 'booking', 'services', 'about', 'gallery', 'hours', 'visit', 'cta_band', 'footer'] })
);

export const INTERACTIONS = list(
  T('booking-dialog', 'Booking dialog', 'Native <dialog> request form. Sends nothing, stores nothing, checks no availability.'),
  T('mobile-menu', 'Mobile menu', 'Toggle for nav links on narrow screens.'),
  T('reveal', 'Scroll reveal', 'IntersectionObserver fade/slide, disabled for reduced motion.'),
  T('faq-accordion', 'FAQ accordion', 'Native details/summary, no script.'),
  T('sticky-cta', 'Sticky call button', 'Phone-only fixed button when a verified phone exists.')
);

export const HONESTY_RULES = Object.freeze([
  'concept:true is the default. The unremovable banner says it is a sample preview made by Nexus, not the business\'s own site, and that no availability is checked.',
  'Only facts in the business record appear as facts. Anything else is marked sample:true and rendered with a SAMPLE tag or placeholder.',
  'Never invent: prices, hours, phone numbers, addresses, reviews, ratings, awards, years in business, counts, guarantees, licences, photos.',
  'A rating is shown only with a reviewCount. Stats need a source. Review quotes need a source.',
  'Photos must be https URLs the owner supplied or approved; otherwise honest portfolio placeholders are drawn.',
  'concept:false is rejected while any sample item, placeholder, demo booking or unapproved claim remains.',
  'Output is one self-contained HTML file: inline CSS, one inline script, no external requests, no forms that submit anywhere, no storage.',
  'Same site document always renders to the same HTML (deterministic; no clocks or randomness).'
]);

export const AGENT_WORKFLOW = Object.freeze([
  '1. describe_nexus_site_language once, then reuse the ids exactly.',
  '2. Gather verified facts into a business record (name, category, location, phone, address, services, hours, photos). Mark everything else sample.',
  '3. compose_nexus_site with the business and a recipe for a first draft, or write a site document yourself from the vocabulary.',
  '4. render_nexus_site to validate and get the HTML; fix every issue it lists rather than working around it.',
  '5. Review the page on a phone-width viewport, adjust sections/theme, render again.',
  '6. Keep concept:true until the owner has approved every fact and photo; deploying and domains are separate, approved steps.'
]);

const names = a => a.map(x => x.id);
export function describeSiteVocabulary() {
  return {
    version: SITE_LANGUAGE_VERSION,
    moods: names(MOODS), palettes: PALETTES.map(p => ({ id: p.id, dark: p.dark, accent: p.accent })), type_pairs: names(TYPE_PAIRS),
    scales: names(SCALES), radii: names(RADII), motions: names(MOTIONS), decors: names(DECORS), nav_styles: names(NAV_STYLES),
    glyphs: Object.keys(GLYPHS), cta_targets: CTA_TARGETS, interactions: INTERACTIONS.map(x => ({ id: x.id, description: x.description })),
    sections: Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, { variants: v.variants, props: v.props, required: v.needs || [], about: v.about }])),
    recipes: RECIPES.map(r => ({ id: r.id, name: r.name, description: r.description, order: r.order })),
    playbooks: PLAYBOOKS.map(p => ({ id: p.id, sample_services: p.services })),
    limits: LIMITS, honesty_rules: HONESTY_RULES, workflow: AGENT_WORKFLOW
  };
}
