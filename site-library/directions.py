"""Business-led compositions. Shared form mechanics stay in render.py.

Use hero_image={src: 'data:image/...;base64,...', alt: '...'} in a config
for a self-contained supplied/generated photo. Custom SVG is the offline default.
"""
from html import escape as E

# Page order is deliberate: primary customer task determines what leads.
ORDERS = {
    'barber': ('hero','s','q','x','g','h'),
    'lawn': ('hero','x','s','h','g','q'),
    'clean': ('hero','s','x','q','g','h'),
    'truck': ('hero','h','s','x','q','g'),
    'bakery': ('hero','g','s','x','q','h'),
    'auto': ('hero','q','s','x','h','g'),
    'photo': ('hero','g','x','s','q','h'),
    'dj': ('hero','x','g','s','q','h'),
    'realty': ('hero','x','g','s','q','h'),
    'church': ('hero','h','x','s','q','g'),
    'tutor': ('hero','s','x','q','h','g'),
    'gym': ('hero','x','s','q','g','h'),
    'cafe': ('hero','s','h','x','g','q'),
    'florist': ('hero','g','s','x','q','h'),
    'tattoo': ('hero','g','x','s','q','h'),
}

CSS = '''
.skip-link{position:absolute;left:16px;top:-100px;background:var(--fg);color:var(--bg);padding:12px;z-index:20}.skip-link:focus{top:12px}
.service-hint{color:var(--mut);max-width:50ch}.site-cafe #s .service-hint{grid-column:1;grid-row:3}.site-cafe #s h2{grid-column:1}.site-cafe #s .grid{grid-column:2;grid-row:2/span 2}
@media(max-width:860px){.site-cafe #s .grid,.site-cafe #s .service-hint{grid-column:1;grid-row:auto}}

html{scroll-behavior:smooth;scroll-padding-top:20px}
body{overflow-wrap:anywhere}.wrap{max-width:1240px}section{scroll-margin-top:20px}
button,input,select,a.btn{min-height:44px}nav a{display:inline-flex;align-items:center;min-height:44px}
.hero{min-height:520px;padding-block:54px 70px;gap:60px}.hero .art{aspect-ratio:4/5}
.hero h1{letter-spacing:-.035em}.hero .lead{line-height:1.65}
.ey{letter-spacing:.13em}.grid{gap:0;border-block:1px solid var(--line)}
.chip{border:0;border-bottom:1px solid var(--line);border-radius:0;padding:24px 18px}
.chip[aria-pressed="true"]{box-shadow:inset 4px 0 var(--acc);background:var(--panel)}
.chip[aria-pressed="true"]::after{position:static;display:block;margin-top:12px}
.gallery-heading{display:flex;justify-content:space-between;gap:20px;align-items:end}
.gallery-heading p{color:var(--mut);max-width:26ch}
.gal{gap:18px}.tile{border-radius:0}.tile span{font-size:12px}
.opening-note{display:flex;gap:20px;align-items:center;justify-content:space-between;border-block:1px solid var(--line);padding:18px 0}
.opening-note p{margin:0;color:var(--mut)}.opening-note a{flex-shrink:0}
.art svg{width:100%;height:100%;display:block}.art img{width:100%;height:100%;object-fit:cover;display:block}
.tile b,.tile span{z-index:1;text-shadow:0 1px 6px #000}.tile::before{z-index:1;background:linear-gradient(transparent 40%,#000a)}
.site-barber .hero{grid-template-columns:1.35fr 1fr}.site-barber .hero h1{font-size:clamp(64px,9vw,136px);text-transform:uppercase;max-width:9ch}
.site-barber #s .grid{grid-template-columns:1fr 1fr}.site-barber #q{background:var(--deep);color:var(--ondeep);padding:40px;border-radius:0}.site-barber #q input,.site-barber #q select,.site-barber #q textarea{color:var(--fg)}
.site-lawn .hero.band{grid-template-columns:1fr 1.15fr}.site-lawn .hero .art{aspect-ratio:5/4;border-radius:50% 50% 0 0}.site-lawn #x .cols{background:transparent;border:0}.site-lawn #x .col{border-top:4px solid var(--acc)}
.site-clean .hero.center{grid-template-columns:1.1fr 1fr;text-align:left}.site-clean .hero.center .cta{justify-content:start}.site-clean .hero .art{border-radius:50% 50% 8px 8px;aspect-ratio:1}.site-clean .grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;border:0}.site-clean .chip{border:1px solid var(--line);border-radius:20px}
.site-truck .hero.band{padding-block:50px;background:var(--acc);color:var(--onacc)}.site-truck .hero h1{font-size:clamp(44px,6vw,78px)}.site-truck .hero .art{aspect-ratio:1.2}.site-truck #s .grid{grid-template-columns:1fr}.site-truck #s .chip{display:grid;grid-template-columns:1fr 1fr;gap:20px}.site-truck #h h2{max-width:none}.site-truck #h .two{grid-template-columns:.8fr 1.2fr}
.site-bakery .hero .art{border-radius:50% 50% 3px 3px}.site-bakery #g .gal{grid-template-columns:1.3fr 1fr 1fr 1fr}.site-bakery #g .tile:nth-child(even){margin-top:48px}
.site-auto .hero{grid-template-columns:1fr 1fr}.site-auto .hero h1{text-transform:uppercase;font-size:clamp(52px,7vw,98px)}.site-auto #q{border-top:6px solid var(--acc)}.site-auto .cols{border-radius:0}.site-auto #s .grid{grid-template-columns:repeat(3,minmax(0,1fr))}
.site-photo nav{border-bottom:1px solid var(--line)}.site-photo .hero.center{position:relative;min-height:650px;justify-items:start;text-align:left;display:flex;align-items:end;padding:48px;color:#fff;background:#242823}.site-photo .hero>div:first-child{position:relative;z-index:2;max-width:650px;padding:24px;background:#151c18dd}.site-photo .hero .art{position:absolute;inset:0;width:100%;height:100%;aspect-ratio:auto;border-radius:0}.site-photo .hero .lead,.site-photo .hero .ey,.site-photo .hero .status{color:inherit}.site-photo .hero .btn.line{color:inherit;border-color:inherit}.site-photo .hero.center .cta{justify-content:start}.site-photo .hero .status{display:none}.site-photo #g .gal{grid-template-columns:1.4fr .7fr 1fr}.site-photo #g .tile:first-child{grid-row:span 2;aspect-ratio:auto}.site-photo #g .tile:last-child{grid-column:span 2;aspect-ratio:2.5}
.site-dj .hero.band{grid-template-columns:1.4fr 1fr;min-height:620px}.site-dj .hero h1{font-size:clamp(60px,9vw,130px);max-width:8ch}.site-dj .hero .art{aspect-ratio:1;border-radius:50%}.site-dj #x .cols{display:block;background:transparent;border:0}.site-dj #x .col{display:grid;grid-template-columns:.5fr 1fr 1fr;border-right:0;border-bottom:1px solid var(--line);align-items:center;gap:14px}
.site-realty #x .cols{border:0;background:transparent;gap:20px}.site-realty #x .col{border:1px solid var(--line);padding:36px 24px;min-height:220px;background:var(--panel)}.site-realty .hero .art{aspect-ratio:1.1;border-radius:0}.site-realty .hero h1{font-size:clamp(48px,6vw,80px)}
.site-church .hero.center{grid-template-columns:1fr 1fr;text-align:left}.site-church .hero.center .cta{justify-content:start}.site-church .hero .art{border-radius:180px 180px 0 0}.site-church #h{background:var(--panel);padding:40px 24px}.site-church #x .cols{background:transparent;border:0}
.site-tutor .hero .art{transform:rotate(-3deg);aspect-ratio:1}.site-tutor #s .grid{grid-template-columns:1fr 1fr}.site-tutor #x .col{padding:32px}.site-tutor .hero h1{font-size:clamp(48px,6vw,84px)}
.site-gym .hero.band{grid-template-columns:1.4fr 1fr;min-height:600px}.site-gym .hero h1{font-size:clamp(72px,10vw,144px);text-transform:uppercase;max-width:10ch}.site-gym .hero .art{aspect-ratio:3/4;border-radius:0}.site-gym #x .cols{border:0;border-top:4px solid var(--acc);border-radius:0}.site-gym #s .grid{grid-template-columns:1fr 1fr}
.site-cafe{--rad:0px}.site-cafe .logo{font-size:32px}.site-cafe .hero{grid-template-columns:1.15fr 1fr;background:var(--deep);color:var(--ondeep);padding:50px 40px;margin-top:12px}.site-cafe .hero h1{font-size:clamp(64px,9vw,126px);max-width:9ch;line-height:.88;text-transform:uppercase}.site-cafe .hero .lead,.site-cafe .hero .ey,.site-cafe .hero .status{color:inherit}.site-cafe .hero .btn.line{border-color:inherit;color:inherit}.site-cafe .hero .art{background:transparent;aspect-ratio:1}.site-cafe #s{display:grid;grid-template-columns:.65fr 1.35fr;gap:24px}.site-cafe #s>.ey{grid-column:1/-1}.site-cafe #s .grid{grid-template-columns:1fr}.site-cafe #s h2{font-size:clamp(42px,6vw,78px);text-transform:uppercase}.site-cafe #s .chip{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding-inline:0;background:transparent}.site-cafe #s .chip[aria-pressed=true]::after{grid-column:1/-1}.site-cafe #x .cols{background:transparent;border:0}.site-cafe #g .gal{grid-template-columns:repeat(4,minmax(0,1fr))}.site-cafe #g .tile{aspect-ratio:1}
.site-florist{--rad:0px}.site-florist .logo{font-weight:500;font-style:italic}.site-florist nav{padding-block:24px}.site-florist .hero{grid-template-columns:.85fr 1.15fr;padding-block:28px 90px;align-items:center}.site-florist .hero h1{font-size:clamp(52px,7vw,98px);font-weight:500;max-width:9ch}.site-florist .hero .art{border-radius:48% 48% 0 0;aspect-ratio:4/5}.site-florist .status{display:none}.site-florist #g .gal{grid-template-columns:1.3fr .8fr 1fr}.site-florist #g .tile:nth-child(2){margin-top:70px}.site-florist #g .tile:last-child{display:none}.site-florist .grid{grid-template-columns:1fr 1fr;border:0;gap:28px}.site-florist .chip{background:transparent;padding:24px 0}.site-florist .chip b{font-size:30px;font-weight:500}.site-florist #x .cols{border:0;border-radius:0;background:transparent}.site-florist #q h2{font-weight:500}
.site-tattoo{--rad:0px}.site-tattoo .hero{grid-template-columns:1.1fr 1fr;border-bottom:1px solid var(--line);min-height:650px}.site-tattoo .hero h1{font-size:clamp(74px,11vw,160px);max-width:8ch;text-transform:uppercase;line-height:.84}.site-tattoo .hero .art{background:transparent;aspect-ratio:1}.site-tattoo .status{display:none}.site-tattoo .hero .ey{color:var(--mut)}.site-tattoo #g h2{text-transform:uppercase}.site-tattoo #g .gal{grid-template-columns:repeat(4,minmax(0,1fr));gap:2px}.site-tattoo #g .tile{aspect-ratio:3/4}.site-tattoo #x .cols{background:transparent;border:0;border-top:1px solid var(--line)}.site-tattoo #s .grid{grid-template-columns:1fr}.site-tattoo #s .chip{display:grid;grid-template-columns:1fr 1fr;gap:16px;background:transparent}.site-tattoo #q{border-top:4px solid var(--acc)}
@media(max-width:860px){body .hero,body .hero.band,body .hero.center{grid-template-columns:minmax(0,1fr);min-height:0;gap:30px}body .hero .art{width:100%;max-width:620px;justify-self:center}body .hero h1{max-width:12ch}body.site-photo .hero{min-height:600px}body.site-photo .hero .art{max-width:none}body .hero,body .hero.band{padding-block:34px 40px}.site-cafe .hero{padding:32px 24px}.site-cafe #s{grid-template-columns:1fr}.site-clean .grid,.site-auto #s .grid{grid-template-columns:1fr 1fr}.site-dj #x .col{grid-template-columns:1fr}.site-truck #h .two{grid-template-columns:1fr}.site-barber #q{padding:28px 18px}.opening-note{align-items:start;flex-direction:column}.site-florist #g .gal{grid-template-columns:1fr 1fr}.site-florist #g .tile:last-child{display:flex}.site-florist #g .tile:nth-child(2){margin-top:30px}.site-tattoo #g .gal{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.hero h1{font-size:clamp(44px,14vw,76px)!important}body .hero .art{aspect-ratio:1}nav{align-items:start}nav ul{gap:8px 14px}.logo{max-width:100%}.site-cafe #s .chip,.site-truck #s .chip,.site-tattoo #s .chip{grid-template-columns:1fr;gap:6px}.site-clean .grid,.site-auto #s .grid,.site-tutor #s .grid,.site-gym #s .grid,.site-florist .grid,.site-barber #s .grid{grid-template-columns:1fr}.site-bakery #g .gal,.site-photo #g .gal,.site-cafe #g .gal{grid-template-columns:1fr 1fr}.site-bakery #g .tile:nth-child(even){margin-top:0}.site-photo #g .tile:first-child{grid-row:auto;aspect-ratio:3/4}.site-photo #g .tile:last-child{grid-column:auto;aspect-ratio:3/4}.site-photo .hero.center{padding:20px;min-height:560px}.site-photo .hero>div:first-child{padding:18px}.site-florist #g .tile:nth-child(2){margin-top:0}.gal{gap:10px}.tile b{font-size:18px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation:none!important;transition:none!important}}
'''


def direction_css(s):
    return CSS


def hero_art(s):
    image = s.get('hero_image')
    if image:
        # Only embedded image formats: gallery srcdoc remains portable and private.
        src = image['src']
        if not src.startswith(('data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,')):
            raise ValueError('hero_image.src must be an embedded PNG, JPEG or WebP')
        return f'<img src="{E(src, quote=True)}" alt="{E(image["alt"], quote=True)}" decoding="async">'
    return s['hero']


def thumbnail(s):
    return hero_art(s)


def compose(s, blocks):
    order = ORDERS.get(s['id'], ('hero','s','x','g','h','q'))
    if set(order) != set(blocks) or len(order) != len(blocks):
        raise ValueError('Every composition must contain each section exactly once')
    # These are task shortcuts, never claims about real availability or locations.
    shortcuts = {
        'barber': ('Your next cut starts here.', 'Choose a service, then request a chair.', 'Choose your cut', '#s'),
        'truck': ('Find lunch. Then find us.', 'Sample stops and hours below; choose a menu item to try the order form.', 'See sample stops', '#h'),
        'gym': ('Make room for movement.', 'Explore the sample class week, then request an introduction.', 'Explore classes', '#x'),
        'cafe': ('A little ritual. A better day.', 'Browse the sample drinks menu and plan a visit.', 'Read the menu', '#s'),
    }
    intro = ''
    if s['id'] in shortcuts:
        title, copy, label, href = shortcuts[s['id']]
        intro = f'<aside class="opening-note"><div><b>{E(title)}</b><p>{E(copy)}</p></div><a class="btn line" href="{href}">{E(label)}</a></aside>'
    # Semantic sections and IDs stay intact when composed in a new order.
    return intro + '<main id="main">' + ''.join(blocks[k] for k in order) + '</main>'
