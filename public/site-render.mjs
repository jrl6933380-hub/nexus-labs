// Nexus Site Language v1 - deterministic renderer. site document -> one self-contained HTML string.
// Inline CSS + one inline script. No external requests, storage, forms that submit, clocks or randomness.
import { PALETTES, TYPE_PAIRS, SCALE_VALUES, RADIUS_VALUES, GLYPHS, PLAYBOOKS, LIMITS } from './site-vocabulary.mjs';
import { validateSite, pickPlaybook } from './site-validate.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const glyph = (name, cls = 'gl') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${GLYPHS[name] || GLYPHS.star}"/></svg>`;
const NAV_LABEL = { services: 'Services', gallery: 'Work', about: 'About', process: 'How it works', reviews: 'Reviews', faq: 'FAQ', hours: 'Hours', visit: 'Visit', packages: 'Packages', booking: 'Book' };
const SAMPLE_TAG = '<span class="tag">SAMPLE</span>';

function css(site) {
  const pal = PALETTES.find(p => p.id === site.theme.palette), ty = TYPE_PAIRS.find(t => t.id === site.theme.type);
  const sc = SCALE_VALUES[site.theme.scale], [rl, rs] = RADIUS_VALUES[site.theme.radius];
  return `:root{--paper:${pal.paper};--ink:${pal.ink};--muted:${pal.muted};--line:${pal.line};--panel:${pal.panel};--accent:${pal.accent};--ai:${pal.accentInk};--rl:${rl};--rs:${rs};--h1:${sc.h1};--h2:${sc.h2};--pad:${sc.pad};--hf:${ty.head};--bf:${ty.body};--hw:${ty.hw};--hc:${ty.hcase};--tr:${ty.track}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:70px}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--bf);-webkit-text-size-adjust:100%}
a{color:inherit}img{max-width:100%;display:block}h1,h2,h3{font-family:var(--hf);font-weight:var(--hw);text-transform:var(--hc);letter-spacing:var(--tr);line-height:1.04;margin:0 0 .4em}h1{font-size:var(--h1)}h2{font-size:var(--h2)}h3{font-size:1.25rem}p{margin:0 0 1em}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.wrap{width:min(1120px,100% - 32px);margin:0 auto}.sec{padding:var(--pad) 0}.gl{width:1.2em;height:1.2em;flex:none}
.kicker{font:700 .78rem/1 var(--bf);letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:0 0 1rem}.lead{font-size:1.15rem;color:var(--muted);max-width:56ch}
.concept{background:var(--ink);color:var(--paper);font-size:.85rem;padding:9px 16px;text-align:center}.concept b{letter-spacing:.1em}.ann{background:var(--accent);color:var(--ai);text-align:center;font-size:.9rem;padding:8px 16px}
.btn{display:inline-flex;align-items:center;gap:.5em;font:700 1rem var(--bf);min-height:48px;padding:12px 24px;border-radius:var(--rs);border:2px solid var(--accent);background:var(--accent);color:var(--ai);text-decoration:none;cursor:pointer;transition:transform .15s}.btn:hover{transform:translateY(-2px)}.btn.ghost{background:transparent;color:var(--ink);border-color:var(--ink)}
.tag{display:inline-block;font:700 .65rem/1 var(--bf);letter-spacing:.12em;padding:4px 7px;border:1px solid currentColor;border-radius:4px;color:var(--muted);vertical-align:middle;margin-left:8px}
.nav{position:sticky;top:0;z-index:20;background:var(--paper);border-bottom:1px solid var(--line)}.nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px}.brand{display:flex;align-items:center;gap:10px;font:var(--hw) 1.15rem var(--hf);text-transform:var(--hc);letter-spacing:var(--tr);text-decoration:none}.brand .gl{color:var(--accent)}
.links{display:flex;gap:22px;align-items:center}.links a{text-decoration:none;font-weight:600;font-size:.95rem}.links a:hover{color:var(--accent)}.mm{display:none;background:none;border:2px solid var(--ink);color:var(--ink);border-radius:var(--rs);min-height:44px;padding:0 14px;font:700 .9rem var(--bf)}
.nav.center .wrap{flex-direction:column;padding:12px 0;gap:6px}.nav.minimal .links a:not(.btn){display:none}
.hero{padding:calc(var(--pad) * .9) 0;position:relative;overflow:hidden}.hero .row{display:grid;gap:40px;align-items:center}.acts{display:flex;gap:12px;flex-wrap:wrap;margin-top:1.6rem}
.art{position:relative;aspect-ratio:4/5;background:var(--panel);border:1px solid var(--line);border-radius:var(--rl);overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:22px;color:var(--accent)}.art .mono{font:var(--hw) clamp(5rem,16vw,9rem)/.9 var(--hf);color:var(--ink);letter-spacing:var(--tr)}.art .top,.art .foot{font:700 .75rem var(--bf);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);display:flex;justify-content:space-between;gap:8px}.art .big{position:absolute;right:-8%;bottom:-6%;width:70%;height:auto;opacity:.18;stroke-width:1}
.photo{margin:0}.photo img{width:100%;height:100%;object-fit:cover;aspect-ratio:4/5;border-radius:var(--rl)}.photo figcaption{font-size:.8rem;color:var(--muted);margin-top:6px}
.hero.split .row{grid-template-columns:1.1fr .9fr}.hero.poster{background:var(--accent);color:var(--ai)}.hero.poster h1{font-size:calc(var(--h1) * 1.15)}.hero.poster .kicker,.hero.poster .lead{color:var(--ai);opacity:.85}.hero.poster .btn{background:var(--ai);color:var(--accent);border-color:var(--ai)}.hero.poster .btn.ghost{background:transparent;color:var(--ai)}.hero.poster .row{grid-template-columns:1.3fr .7fr}.hero.poster .art,.hero.poster .photo img{aspect-ratio:1;background:var(--paper)}
.hero.editorial .row{grid-template-columns:1.25fr .75fr;align-items:end}.hero.editorial h1{font-style:italic}.hero.centered{text-align:center}.hero.centered .row{justify-items:center}.hero.centered .lead{margin-inline:auto}.hero.centered .acts{justify-content:center}.hero.centered .art,.hero.centered .photo{width:min(380px,100%)}.hero.centered .art{border-radius:999px 999px var(--rl) var(--rl);aspect-ratio:3/4}
.hero.stacked .art,.hero.stacked .photo img{aspect-ratio:21/9;width:100%}.hero.stacked .art{padding:18px 24px}.hero.stacked .row{gap:32px}.hero.stacked .mono{font-size:clamp(3rem,10vw,6rem)}
.hero.ticket .tkt{background:var(--panel);border:2px solid var(--ink);border-radius:var(--rl);display:grid;gap:0;position:relative}.hero.ticket .tkt>div{padding:clamp(22px,4vw,48px)}.hero.ticket .stub{border-top:2px dashed var(--ink);background:var(--paper);border-radius:0 0 var(--rl) var(--rl)}
.mq{overflow:hidden;background:var(--ink);color:var(--paper);padding:14px 0;white-space:nowrap}.mq .tr{display:inline-flex;gap:28px;align-items:center;font:var(--hw) 1.3rem var(--hf);text-transform:uppercase;letter-spacing:var(--tr);animation:mq 26s linear infinite}.mq .gl{color:var(--accent)}@keyframes mq{to{transform:translateX(-50%)}}
.sh{display:flex;justify-content:space-between;align-items:end;gap:24px;flex-wrap:wrap;margin-bottom:2rem}.sh p{margin:0;max-width:44ch;color:var(--muted)}
.svc-list{border-top:1px solid var(--ink)}.svc-list li{display:grid;grid-template-columns:auto 1fr auto;gap:6px 16px;padding:18px 0;border-bottom:1px solid var(--line);align-items:baseline}.svc-list .n{font:700 .8rem var(--bf);color:var(--muted)}.svc-list h3{margin:0}.svc-list p{grid-column:2;margin:0;color:var(--muted);font-size:.95rem}.svc-list .pr{font-weight:700;white-space:nowrap}
ul{list-style:none;margin:0;padding:0}.svc-cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}.svc-cards li{background:var(--panel);border:1px solid var(--line);border-radius:var(--rl);padding:24px}.svc-cards .gl{width:34px;height:34px;color:var(--accent);margin-bottom:14px}.svc-cards p{color:var(--muted);font-size:.95rem;margin:0 0 .5em}
.svc-menu{columns:2 320px;column-gap:56px}.svc-menu li{break-inside:avoid;padding:0 0 22px}.svc-menu h3{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dotted var(--ink);padding-bottom:6px}.svc-menu p{margin:0;color:var(--muted);font-size:.95rem}
.svc-tiles{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}.svc-tiles li{background:var(--panel);border:2px solid var(--ink);border-radius:var(--rs);padding:22px;min-height:190px;display:flex;flex-direction:column;justify-content:space-between}.svc-tiles li:nth-child(4n+1){background:var(--accent);color:var(--ai);border-color:var(--accent)}.svc-tiles li:nth-child(4n+1) p,.svc-tiles li:nth-child(4n+1) .tag{color:var(--ai)}.svc-tiles .num{font:var(--hw) 3rem/1 var(--hf);opacity:.35}.svc-tiles p{margin:0;font-size:.92rem;color:var(--muted)}
.meta{font-size:.85rem;color:var(--muted)}
.pk{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}.pk article{border:1px solid var(--line);border-radius:var(--rl);padding:26px;background:var(--panel)}.pk .feat{border:2px solid var(--accent)}.pk .price{font:var(--hw) 2.2rem var(--hf)}.pk li{padding:6px 0;border-top:1px solid var(--line)}
.gal{display:grid;gap:12px}.gal.grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.gal.strip{grid-auto-flow:column;grid-auto-columns:minmax(240px,32%);overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:10px}.gal.strip>*{scroll-snap-align:start}.gal.mosaic{grid-template-columns:repeat(4,1fr)}.gal.mosaic>:nth-child(1){grid-column:span 2;grid-row:span 2}.gal.mosaic>:nth-child(4){grid-column:span 2}
.slot{aspect-ratio:1;min-height:180px;display:grid;place-items:center;text-align:center;background:var(--panel);border:2px dashed var(--line);border-radius:var(--rl);color:var(--muted);font-size:.85rem;padding:16px}.slot b{display:block;font:var(--hw) 2rem var(--hf);color:var(--accent)}.gal .photo img{aspect-ratio:1}.gal.mosaic .slot,.gal.mosaic .photo img{height:100%;aspect-ratio:auto;min-height:180px}
.abt{display:grid;gap:40px;align-items:start}.abt.split{grid-template-columns:1fr 1fr}.pts li{padding:10px 0;border-top:1px solid var(--line);display:flex;gap:10px;align-items:center}.pts .gl{color:var(--accent)}
.steps{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));counter-reset:s}.steps li{counter-increment:s;border-top:3px solid var(--accent);padding-top:14px}.steps li:before{content:counter(s,decimal-leading-zero);font:var(--hw) 2rem var(--hf);color:var(--accent);display:block}
.rev{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.rev blockquote{margin:0;background:var(--panel);border-left:4px solid var(--accent);border-radius:var(--rs);padding:20px}.rev cite{font-size:.85rem;color:var(--muted)}.rating{font:var(--hw) 3rem var(--hf)}
.stats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.stats b{display:block;font:var(--hw) 2.6rem var(--hf);color:var(--accent)}
details{border-bottom:1px solid var(--line);padding:14px 0}summary{cursor:pointer;font-weight:700;list-style:none;display:flex;justify-content:space-between;gap:12px}summary:after{content:'+';font-size:1.4rem;line-height:1}details[open] summary:after{content:'\\2212'}details p{margin:.8em 0 0;color:var(--muted)}
.two{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--rl);padding:28px}table{width:100%;border-collapse:collapse}td,th{padding:10px 0;border-bottom:1px solid var(--line);text-align:left}td:last-child{text-align:right}
.band{background:var(--ink);color:var(--paper);text-align:center}.band .btn{background:var(--accent);color:var(--ai)}
footer{border-top:1px solid var(--line);padding:36px 0 90px;font-size:.9rem;color:var(--muted)}footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}footer.cols .wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
dialog{border:2px solid var(--ink);border-radius:var(--rl);padding:0;width:min(520px,calc(100% - 24px));background:var(--paper);color:var(--ink)}dialog::backdrop{background:rgba(0,0,0,.55)}dialog form{padding:26px;display:grid;gap:14px}label{display:grid;gap:6px;font-weight:600;font-size:.9rem}input,select,textarea{font:inherit;padding:12px;border:1.5px solid var(--ink);border-radius:var(--rs);background:var(--paper);color:var(--ink);min-height:46px}.say{min-height:1.4em;font-weight:600;color:var(--accent)}
.call{position:fixed;right:14px;bottom:14px;z-index:30;display:none}
.d-grain body:before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.07;background:repeating-radial-gradient(circle at 17% 23%,var(--ink) 0 .6px,transparent .6px 3px);z-index:50}
.d-stripes .hero:after{content:'';position:absolute;inset:0;pointer-events:none;opacity:.07;background:repeating-linear-gradient(-45deg,var(--ink) 0 14px,transparent 14px 34px)}
.d-dots .hero:after{content:'';position:absolute;inset:0;pointer-events:none;opacity:.12;background:radial-gradient(var(--accent) 1.6px,transparent 1.7px) 0 0/22px 22px}
.d-grid .hero:after{content:'';position:absolute;inset:0;pointer-events:none;opacity:.08;background:linear-gradient(var(--ink) 1px,transparent 1px) 0 0/36px 36px,linear-gradient(90deg,var(--ink) 1px,transparent 1px) 0 0/36px 36px}
.d-rule .hero:after{content:'';position:absolute;inset:14px;pointer-events:none;border:3px double var(--ink);opacity:.35;border-radius:var(--rs)}
.hero>.wrap{position:relative;z-index:1}
.js .rv{opacity:0;transform:translateY(18px);transition:opacity .6s,transform .6s}.js .rv.in{opacity:1;transform:none}.m-snappy.js .rv{transform:translateX(-26px);transition-duration:.3s}.m-none.js .rv{opacity:1;transform:none}
@media(max-width:760px){.hero .row,.hero.split .row,.hero.poster .row,.hero.editorial .row,.abt.split{grid-template-columns:1fr}.hero .art{aspect-ratio:16/10}.hero.poster .art,.hero.poster .photo img{aspect-ratio:16/10}.mm{display:inline-flex;align-items:center}.links{display:none;position:absolute;left:0;right:0;top:100%;background:var(--paper);border-bottom:1px solid var(--line);flex-direction:column;align-items:stretch;gap:0;padding:8px 16px}.nav.open .links{display:flex}.links a{padding:14px 0;border-top:1px solid var(--line)}.nav.minimal .links a:not(.btn){display:block}.call{display:inline-flex}.gal.mosaic{grid-template-columns:1fr 1fr}.gal.strip{grid-auto-columns:78%}.svc-list li{grid-template-columns:auto 1fr}.svc-list .pr{grid-column:2}}
@media(prefers-reduced-motion:reduce){.mq .tr{animation:none}.js .rv{opacity:1;transform:none;transition:none}html{scroll-behavior:auto}.btn{transition:none}}`;
}

function build(site) {
  const b = site.business, T = site.theme, sections = site.sections, concept = site.concept;
  const pb = PLAYBOOKS.find(p => p.id === b.playbook) || pickPlaybook(b.category);
  const byType = Object.fromEntries(sections.map(s => [s.type, s]));
  const idOf = type => (sections.find(s => s.type === type) || {}).id;
  const hasDemo = byType.booking?.variant === 'demo';
  const tel = b.phone ? 'tel:' + b.phone.replace(/[^0-9+]/g, '') : '';
  const cta = (c, cls = '') => {
    if (!c) return '';
    if (c.target === 'booking' && hasDemo) return `<button type="button" class="btn ${cls}" data-open>${esc(c.label)}</button>`;
    if ((c.target === 'call' || c.target === 'booking') && tel) return `<a class="btn ${cls}" href="${esc(tel)}">${esc(c.label)}</a>`;
    const id = c.target === 'call' || c.target === 'booking' ? (idOf('visit') || 'top') : (idOf(c.target) || 'top');
    return `<a class="btn ${cls}" href="#${esc(id)}">${esc(c.label)}</a>`;
  };
  const rv = T.motion === 'none' ? '' : ' rv';
  const head = (title, intro, kick) => `<div class="sh"><div>${kick ? `<p class="kicker">${esc(kick)}</p>` : ''}<h2>${esc(title)}</h2></div>${intro ? `<p>${esc(intro)}</p>` : ''}</div>`;
  const art = (hero, i = 0) => {
    const ph = b.photos[i];
    if (ph) return `<figure class="photo"><img src="${esc(ph.url)}" alt="${esc(ph.alt)}" ${hero ? 'fetchpriority="high"' : 'loading="lazy"'}>${ph.credit ? `<figcaption>${esc(ph.credit)}</figcaption>` : ''}</figure>`;
    return `<div class="art" role="img" aria-label="Brand artwork placeholder for ${esc(b.name)}"><span class="top"><span>${esc(b.category)}</span><span>${esc(b.location)}</span></span>${glyph(T.glyphs[0], 'gl big')}<span class="mono">${esc(b.initials)}</span><span class="foot"><span>${esc(pb.craft)}</span></span></div>`;
  };
  const svcItems = s => (s.items && s.items.length ? s.items : b.services);
  const svcMeta = x => `${x.sample ? SAMPLE_TAG : ''}${x.duration ? ` <span class="meta">${esc(x.duration)}</span>` : ''}`;
  const R = {
    announcement: s => `<div class="ann">${esc(s.text)}</div>`,
    nav: s => {
      const links = sections.filter(x => NAV_LABEL[x.type] && x.type !== 'booking').slice(0, 5).map(x => `<a href="#${esc(x.id)}">${NAV_LABEL[x.type]}</a>`).join('');
      const c = s.label ? cta({ label: s.label, target: s.target || 'booking' }) : (hasDemo || tel ? cta({ label: 'Book', target: 'booking' }) : '');
      return `<header class="nav ${s.variant === 'bar' ? '' : s.variant}" id="top"><div class="wrap"><a class="brand" href="#top">${glyph(T.glyphs[0])}<span>${esc(b.name)}</span></a><button class="mm" type="button" aria-expanded="false" aria-controls="lk">Menu</button><nav class="links" id="lk" aria-label="Main">${links}${c}</nav></div></header>`;
    },
    hero: s => {
      const head1 = `${s.kicker ? `<p class="kicker">${esc(s.kicker)}</p>` : ''}<h1>${esc(s.headline)}</h1>${s.sub ? `<p class="lead">${esc(s.sub)}</p>` : ''}<div class="acts">${cta(s.primary)}${cta(s.secondary, 'ghost')}</div>`;
      const a = art(true, s.photo ?? 0);
      if (s.variant === 'ticket') return `<section class="hero ticket"><div class="wrap"><div class="tkt"><div>${head1}</div><div class="stub">${a}</div></div></div></section>`;
      return `<section class="hero ${s.variant}"><div class="wrap"><div class="row"><div>${head1}</div>${a}</div></div></section>`;
    },
    marquee: s => { const row = s.items.map(x => `<span>${esc(x)}</span>${glyph(T.glyphs[1] || T.glyphs[0])}`).join(''); return `<div class="mq" aria-hidden="true"><div class="tr">${row}${row}</div></div>`; },
    services: s => {
      const items = svcItems(s);
      const body = {
        list: () => `<ul class="svc-list">${items.map((x, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(x.name)}${x.sample ? SAMPLE_TAG : ''}</h3><span class="pr">${esc(x.price)}</span>${x.description ? `<p>${esc(x.description)}</p>` : ''}${x.duration ? `<p class="meta">${esc(x.duration)}</p>` : ''}</li>`).join('')}</ul>`,
        cards: () => `<ul class="svc-cards">${items.map((x, i) => `<li>${glyph(T.glyphs[i % T.glyphs.length])}<h3>${esc(x.name)}${x.sample ? SAMPLE_TAG : ''}</h3>${x.description ? `<p>${esc(x.description)}</p>` : ''}<p><b>${esc(x.price)}</b>${x.duration ? ` <span class="meta">${esc(x.duration)}</span>` : ''}</p></li>`).join('')}</ul>`,
        menu: () => `<ul class="svc-menu">${items.map(x => `<li><h3><span>${esc(x.name)}${x.sample ? SAMPLE_TAG : ''}</span><span>${esc(x.price)}</span></h3>${x.description ? `<p>${esc(x.description)}</p>` : ''}${x.duration ? `<p class="meta">${esc(x.duration)}</p>` : ''}</li>`).join('')}</ul>`,
        tiles: () => `<ul class="svc-tiles">${items.map((x, i) => `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(x.name)}${x.sample ? SAMPLE_TAG : ''}</h3>${x.description ? `<p>${esc(x.description)}</p>` : ''}${x.price || x.duration ? `<p><b>${esc(x.price)}</b> ${esc(x.duration)}</p>` : ''}</div></li>`).join('')}</ul>`
      }[s.variant]();
      return `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap">${head(s.title || 'Services', s.intro || (items.some(x => x.sample) ? 'Sample services shown until the owner confirms the real list and prices.' : ''), 'What we do')}${body}</div></section>`;
    },
    packages: s => `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap">${head(s.title || 'Packages', '', 'Bundles')}<div class="pk">${s.items.map(x => `<article class="${x.featured ? 'feat' : ''}"><h3>${esc(x.name)}</h3><p class="price">${esc(x.price)}</p><ul>${x.includes.map(i => `<li>${esc(i)}</li>`).join('')}</ul></article>`).join('')}</div></div></section>`,
    gallery: s => {
      const n = s.slots || (s.variant === 'mosaic' ? 5 : 4);
      const cells = Array.from({ length: n }, (_, i) => b.photos[i] ? art(false, i) : `<div class="slot"><div><b aria-hidden="true">${String(i + 1).padStart(2, '0')}</b>Your work goes here<br>Portfolio photo slot</div></div>`).join('');
      return `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap">${head(s.title || 'Recent work', b.photos.length ? (b.photos.some(x => x.stock) ? 'Stock photos for illustration only. The shop\'s own work replaces these.' : '') : 'Photo slots shown until the owner supplies photos they are happy to share.', 'Gallery')}<div class="gal ${s.variant}">${cells}</div></div></section>`;
    },
    about: s => `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap"><div class="abt ${s.variant}"><div>${head(s.title || 'About', '', 'Our story')}<p class="lead">${esc(s.body)}${s.sample ? SAMPLE_TAG : ''}</p></div>${s.variant === 'split' ? (s.points?.length ? `<ul class="pts">${s.points.map(p => `<li>${glyph(T.glyphs[1] || 'star')}<span>${esc(p)}</span></li>`).join('')}</ul>` : art(false, s.photo ?? 1)) : ''}</div></div></section>`,
    process: s => `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap">${head(s.title || 'How it works', s.sample ? 'A sample flow until the owner describes theirs.' : '', 'Process')}<ol class="steps" style="list-style:none;padding:0;margin:0">${s.steps.map(x => `<li><h3>${esc(x.title)}</h3><p class="meta">${esc(x.body)}</p></li>`).join('')}</ol></div></section>`,
    reviews: s => `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap">${head(s.title || 'What people say', '', 'Reviews')}${b.rating ? `<p><span class="rating">${esc(b.rating.toFixed(1))}</span> <span class="meta">out of 5 from ${esc(b.reviewCount)} reviews on the source listing</span></p>` : ''}${s.items?.length ? `<div class="rev">${s.items.map(x => `<blockquote><p>${esc(x.quote)}</p><cite>${x.by ? esc(x.by) + ', ' : ''}${esc(x.source)}</cite></blockquote>`).join('')}</div>` : ''}</div></section>`,
    stats: s => `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap"><div class="stats">${s.items.map(x => `<div><b>${esc(x.value)}</b>${esc(x.label)}<br><span class="meta">${esc(x.source)}</span></div>`).join('')}</div></div></section>`,
    faq: s => `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap">${head(s.title || 'Questions', s.sample ? 'Sample questions; answers to be confirmed with the owner.' : '', 'FAQ')}${s.items.map(x => `<details><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join('')}</div></section>`,
    hours: s => `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap"><div class="two"><div>${head(s.title || 'Hours', '', 'Opening times')}</div><div class="card">${b.hours.length ? `<table><tbody>${b.hours.map(h => `<tr><th scope="row">${esc(h.day)}</th><td>${esc(h.time)}</td></tr>`).join('')}</tbody></table>` : '<p class="lead">Opening hours to be confirmed.</p>'}</div></div></div></section>`,
    visit: s => `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap"><div class="two"><div>${head(s.title || 'Visit', '', 'Find us')}</div><div class="card"><p><b>${esc(b.name)}</b></p><p>${b.address ? esc(b.address) : 'Address to be confirmed.'}${b.location && !b.address ? '<br>' + esc(b.location) : ''}</p>${b.phone ? `<p><a href="${esc(tel)}">${esc(b.phone)}</a></p>` : ''}${s.mapUrl ? `<p><a href="${esc(s.mapUrl)}" rel="noopener noreferrer">Open in maps</a></p>` : ''}</div></div></div></section>`,
    booking: s => s.variant === 'demo'
      ? `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap"><div class="card">${head(s.title || 'Request an appointment', s.intro || 'This form is a preview. It sends nothing and checks no availability.', 'Booking')}<button type="button" class="btn" data-open>${esc(s.label || 'Request a time')}</button></div></div></section>`
      : `<section class="sec${rv}" id="${esc(s.id)}"><div class="wrap"><div class="card">${head(s.title || 'Book by phone', s.intro, 'Booking')}<a class="btn" href="${esc(tel)}">${esc(s.label || 'Call ' + b.phone)}</a></div></div></section>`,
    cta_band: s => `<section class="sec band${rv}" id="${esc(s.id)}"><div class="wrap"><h2>${esc(s.headline)}</h2>${cta(s.primary)}</div></section>`,
    footer: s => `<footer class="${s.variant === 'columns' ? 'cols' : ''}"><div class="wrap"><div><b>${esc(b.name)}</b><br>${esc(b.location)}${b.phone ? `<br><a href="${esc(tel)}">${esc(b.phone)}</a>` : ''}</div><div>${s.note ? esc(s.note) : ''}${concept ? `${s.note ? '<br>' : ''}Concept preview by Nexus. Not the business’s own website.` : ''}</div></div></footer>`
  };
  const body = sections.map(s => R[s.type](s)).join('\n');
  const dialog = hasDemo ? `<dialog id="booking-dialog" aria-labelledby="bk-t"><form method="dialog" id="bk"><h2 id="bk-t">Request a time</h2><p class="meta">Preview only: nothing is sent and no availability is checked.</p><label>Service<select name="service">${b.services.map(x => `<option>${esc(x.name)}</option>`).join('')}</select></label><label>Your name<input name="name" autocomplete="name" maxlength="80"></label><label>Preferred day and time<input name="when" maxlength="80"></label><p class="say" role="status" aria-live="polite"></p><div class="acts"><button class="btn" type="submit">Preview request</button><button class="btn ghost" type="button" data-close>Close</button></div></form></dialog>` : '';
  const sticky = tel ? `<a class="btn call" href="${esc(tel)}">Call</a>` : '';
  const script = `<script>(function(){var d=document,r=d.documentElement;r.classList.add('js');var n=d.querySelector('.nav'),m=d.querySelector('.mm');if(m)m.addEventListener('click',function(){var o=n.classList.toggle('open');m.setAttribute('aria-expanded',String(o))});var dl=d.getElementById('booking-dialog');d.querySelectorAll('[data-open]').forEach(function(x){x.addEventListener('click',function(){if(dl&&dl.showModal)dl.showModal()})});d.querySelectorAll('[data-close]').forEach(function(x){x.addEventListener('click',function(){if(dl)dl.close()})});var f=d.getElementById('bk');if(f)f.addEventListener('submit',function(e){e.preventDefault();f.querySelector('.say').textContent='Preview only. Nothing was sent.'});var q=d.querySelectorAll('.rv');if('IntersectionObserver'in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.08});q.forEach(function(x){io.observe(x)})}else q.forEach(function(x){x.classList.add('in')})})();</script>`;
  const title = site.seo.title || `${b.name} | ${b.category}${b.location ? ' in ' + b.location : ''}`;
  const desc = site.seo.description || `${b.name}: ${pb.noun}${b.location ? ' in ' + b.location : ''}.`;
  const banner = concept ? `<div class="concept" role="note"><b>SAMPLE PREVIEW</b> &middot; A concept by Nexus for ${esc(b.name)}. Not their own website. No availability is checked and nothing is sent.</div>` : '';
  const cls = `d-${T.decor} m-${T.motion} mood-${T.mood}`;
  return `<!DOCTYPE html>\n<html lang="en" class="${cls}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="color-scheme" content="${PALETTES.find(p => p.id === T.palette).dark ? 'dark' : 'light'}"><style>${css(site)}</style></head><body class="${cls}">${banner}\n${body}\n${dialog}${sticky}${script}</body></html>`;
}

export function renderSite(input) {
  const v = validateSite(input);
  if (!v.ok) throw Object.assign(new Error('Invalid site: ' + v.errors.slice(0, 3).map(e => `${e.path} ${e.message}`).join(' | ')), { issues: v.errors });
  const html = build(v.site);
  if (html.length > LIMITS.html) throw Object.assign(new Error(`Site is ${html.length} characters; the limit is ${LIMITS.html}. Remove sections or text.`), { issues: [{ path: '$', message: 'Too large.' }] });
  return html;
}
export function renderSiteSafe(input) {
  try { const html = renderSite(input); return { ok: true, html, bytes: html.length, issues: [] }; }
  catch (e) { return { ok: false, html: '', bytes: 0, issues: e.issues || [{ path: '$', message: String(e.message || e).slice(0, 200) }] }; }
}
