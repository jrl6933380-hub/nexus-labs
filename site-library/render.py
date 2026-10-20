# Renders every site config in gen.py to out/<id>.html and builds out/index.html (a viewer with all sites embedded).
# Usage: python3 site-library/render.py   (run from the repo root; writes ./out/)
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen import S, E, DARK, FONTS
from directions import compose, direction_css, hero_art, thumbnail
from gallery import gallery

CSS_BASE = """
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:16px/1.55 var(--fb);margin:0;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.wrap{max-width:1100px;margin:0 auto}
.m{font:500 12px/1.2 var(--fb);letter-spacing:.08em;text-transform:uppercase}
h1,h2,h3{font-family:var(--fd);line-height:1;margin:0;text-wrap:balance;font-weight:700}
a{color:inherit}
.note{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;padding:8px 0;color:var(--mut);border-bottom:1px solid var(--line);font-size:13px}
.note b{background:var(--acc);color:var(--onacc);padding:1px 8px;font-weight:600;border-radius:2px}
nav{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 0}
.logo{font-family:var(--fd);font-size:26px;font-weight:700}
nav ul{display:flex;gap:18px;list-style:none;margin:0;padding:0;font-size:14px;font-weight:500;flex-wrap:wrap}
nav ul a{text-decoration:none}
.btn{display:inline-block;font:600 15px var(--fb);background:var(--acc);color:var(--onacc);border:0;border-radius:var(--rad);padding:13px 22px;cursor:pointer;text-decoration:none}
.btn.line{background:transparent;color:var(--fg);border:1.5px solid var(--fg)}
.btn:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,.chip:focus-visible{outline:3px solid var(--acc);outline-offset:2px}
.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:36px;align-items:center;padding:30px 0 50px}
.hero h1{font-size:clamp(44px,7.5vw,92px)}
.hero .lead{max-width:48ch;color:var(--mut);font-size:18px;margin:16px 0 24px}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.status{display:inline-flex;gap:8px;align-items:center;margin-bottom:14px;color:var(--mut)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--mut)}.dot.o{background:#2E9E5B}
.art{border-radius:var(--rad);overflow:hidden;aspect-ratio:16/11;background:var(--panel)}
.art svg{display:block;width:100%;height:100%}
.hero.center{grid-template-columns:minmax(0,1fr);text-align:center;justify-items:center}
.hero.center .art{width:min(100%,640px)}.hero.center .cta{justify-content:center}
.hero.band{background:var(--deep);color:var(--ondeep);margin:0 calc(-1*max(16px,env(safe-area-inset-left,0px)));padding:40px max(16px,env(safe-area-inset-left,0px));}
.hero.band .lead,.hero.band .status{color:var(--ondeep);opacity:.82}.hero.band .btn.line{color:var(--ondeep);border-color:var(--ondeep)}
section{padding:48px 0;border-top:1px solid var(--line)}
.ey{color:var(--acc);font-weight:700}
h2{font-size:clamp(32px,5vw,54px);margin:8px 0 22px;max-width:18ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.chip{position:relative;text-align:left;background:var(--panel);border:1.5px solid var(--line);border-radius:var(--rad);padding:16px;cursor:pointer;color:var(--fg);font:inherit;min-width:0}
.chip b{display:block;font-family:var(--fd);font-size:22px;line-height:1.05;font-weight:700}
.chip span{display:block;color:var(--mut);font-size:14px;margin-top:6px}
.chip[aria-pressed="true"]{border-color:var(--acc);box-shadow:inset 0 0 0 1.5px var(--acc)}
.chip[aria-pressed="true"]::after{content:"Selected";position:absolute;right:10px;top:10px;font:600 11px var(--fb);letter-spacing:.06em;text-transform:uppercase;color:var(--acc)}
.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line);background:var(--panel);border-radius:var(--rad);overflow:hidden}
.col{padding:22px 20px;border-right:1px solid var(--line);min-width:0}.col:last-child{border-right:0}
.col h3{font-size:24px;margin:8px 0 6px}.col p{margin:0;color:var(--mut);font-size:15px}
.gal{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.tile{aspect-ratio:3/4;border-radius:var(--rad);padding:12px;display:flex;flex-direction:column;justify-content:flex-end;color:#fff;background:var(--c);position:relative;overflow:hidden;min-width:0}
.tile::before{content:"";position:absolute;inset:0;background:linear-gradient(160deg,rgba(255,255,255,.18),rgba(0,0,0,.35))}
.tile b,.tile span{position:relative}
.tile b{font-family:var(--fd);font-size:20px;line-height:1.05}
.tile span{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.85;margin-top:3px}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:var(--rad);padding:22px;min-width:0}
.box h3{font-size:26px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:15px}
td{padding:7px 0;border-bottom:1px solid var(--line)}td:last-child{text-align:right}
tr.today td{font-weight:700;color:var(--acc)}
.tags{display:flex;flex-wrap:wrap;gap:8px}.tags span{border:1px solid var(--line);padding:4px 10px;border-radius:99px;font-size:14px}
form{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:24px;align-items:start}
.fields{display:grid;gap:14px}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
label{display:grid;gap:5px;font-size:14px;font-weight:600;min-width:0}
input,select,textarea{font:inherit;color:var(--fg);background:var(--panel);border:1.5px solid var(--line);border-radius:calc(var(--rad)/2 + 1px);padding:11px 12px;width:100%;min-width:0}
textarea{min-height:90px;resize:vertical}
.err{color:#C0362C;font-size:13px;min-height:1em;font-weight:400}
.sum{background:var(--deep);color:var(--ondeep);border-radius:var(--rad);padding:22px;display:grid;gap:12px;position:sticky;top:max(16px,env(safe-area-inset-top,0px))}
.sum h3{font-size:26px}.sum dl{margin:0;display:grid;gap:8px}
.sum dt{font:600 11px var(--fb);letter-spacing:.07em;text-transform:uppercase;opacity:.7}.sum dd{margin:0;word-break:break-word}
.sum .hint{font-size:13px;opacity:.75;margin:0}
.done{background:var(--panel);border:1.5px solid #2E9E5B;border-radius:var(--rad);padding:18px;margin-top:12px}.done p{margin:6px 0 0;color:var(--mut)}
footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:24px 0 34px;border-top:1px solid var(--line);color:var(--mut);font-size:13px}
@media (max-width:860px){.hero,form,.two{grid-template-columns:minmax(0,1fr)}.cols{grid-template-columns:minmax(0,1fr)}.col{border-right:0;border-bottom:1px solid var(--line)}.col:last-child{border-bottom:0}.gal{grid-template-columns:repeat(2,minmax(0,1fr))}.sum{position:static}}
@media (max-width:520px){.row{grid-template-columns:minmax(0,1fr)}}
"""

RADIUS = {'bebas':'2px','saira':'3px','unbounded':'14px','dmserif':'6px','fraunces':'10px','syne':'8px','rubik':'12px','playfair':'2px'}

def page(s):
    P = s['pal']; F = FONTS[s['font']]; rad = RADIUS[s['font']]
    fam = '&family='.join(x.replace(' ', '+') for x in (F[0], F[1]))
    d = dict(DARK)
    if s['id'] in ('dj', 'tattoo'):  # preserve each dark brand's material and contrast
        d = dict(bg=P['bg'], panel=P['panel'], fg=P['fg'], mut=P['mut'], line=P['line'], deep=P['deep'], ondeep=P['ondeep'])
    lt = f"--bg:{P['bg']};--panel:{P['panel']};--fg:{P['fg']};--mut:{P['mut']};--line:{P['line']};--deep:{P['deep']};--ondeep:{P['ondeep']};--acc:{P['acc']};--onacc:{P['onacc']};--fd:{F[2]};--fb:{F[3]};--rad:{rad};"
    dk = f"--bg:{d['bg']};--panel:{d['panel']};--fg:{d['fg']};--mut:{d['mut']};--line:{d['line']};--deep:{d['deep']};--ondeep:{d['ondeep']};--acc:{P['accd']};--onacc:{P['onaccd']};color-scheme:dark"
    css = f":root{{{lt}}}\n@media (prefers-color-scheme:dark){{:root:not([data-theme=\"light\"]){{{dk}}}}}\n:root[data-theme=\"dark\"]{{{dk}}}\n" + CSS_BASE
    f = s['form']
    css += direction_css(s)
    nav = ''.join(f'<li><a href="#{i}">{E(t)}</a></li>' for i, t in (('s',s['svc_title']),('x',s['sec2'][0]),('g','Gallery'),('h','Visit'),('q','Contact')) if i != 'g' or s.get('show_gallery', True))
    sec2 = s['sec2']; kind = sec2[2]
    lab = {'steps':'Step','events':'Event','listings':'Listing','people':'Team'}[kind]
    cols = ''.join(f'<div class="col"><span class="m ey">{lab if kind != "steps" else "Step " + str(i+1)}</span><h3>{E(a)}</h3><p>{E(b)}</p></div>' for i, (a, b) in enumerate(sec2[1]))
    sec2html = f'<section id="x"><span class="m ey">{E(sec2[0])}</span><h2>{E(sec2[0])}.</h2><div class="cols">{cols}</div></section>'
    gal = ''.join(f'<div class="tile" style="--c:{c_}"><b>{E(a)}</b><span>Sample</span></div>' for a, c_ in s['gallery'])
    extras = ''
    for i, (lbl, t, opt) in enumerate(f['extra']):
        if t == 'sel': extras += f'<label for="x{i}">{E(lbl)}<select id="x{i}">' + ''.join(f'<option>{E(o)}</option>' for o in opt) + '</select></label>'
        else: extras += f'<label for="x{i}">{E(lbl)}<input id="x{i}" placeholder="{E(opt)}"></label>'
    walk = f'<label style="display:flex;gap:10px;align-items:center;font-weight:400"><input id="wk" type="checkbox" style="width:auto"> {E(f["walk"])}</label>' if f['walk'] else ''
    sumx = ''.join(f'<div><dt>{E(l)}</dt><dd id="sx{i}"></dd></div>' for i, (l, _, __) in enumerate(f['extra']))
    data = json.dumps(dict(jobs=[[a, b] for a, b in s['svcs']], hours=s['hours'], nx=len(f['extra']))).replace('<', chr(92) + 'u003c')
    blocks = dict(
        hero=f"""<header class="hero {s['layout'] if s['layout'] != 'split' else ''}"><div><div class="status m"><span class="dot" id="dot"></span><span id="ot">Checking hours</span></div><span class="m ey" style="display:block;margin-bottom:10px">{E(s['eyebrow'])}</span><h1>{E(s['headline'])}</h1><p class="lead">{E(s['lead'])}</p><div class="cta"><a class="btn" href="#q">{E(s['cta'])}</a><a class="btn line" href="#s">{E(s["svc_title"])}</a></div></div><div class="art">{hero_art(s)}</div></header>""",
        s=f"""<section id="s"><span class="m ey">{E(s['svc_title'])}</span><h2>{E(s['svc_title'])}.</h2><p class="service-hint">{E(s.get("service_hint", "Choose a service to start a sample request."))}</p><div class="grid" id="svc"></div></section>""",
        g=f"""<section id="g"><span class="m ey">Gallery</span><h2>Sample gallery.</h2><div class="gal">{gal}</div></section>""",
        h=f"""<section id="h"><span class="m ey">Hours and area</span><h2>When and where.</h2><div class="two"><div class="box"><h3>Hours</h3><table id="hrs"></table></div><div class="box"><h3>Area</h3><p style="margin:0 0 12px;color:var(--mut)">Sample list. The owner supplies the real one.</p><div class="tags">{''.join(f'<span>{E(a)}</span>' for a in s['area'])}</div><p style="margin:16px 0 0;font-weight:700">{E(s['phone'])} <span style="font-weight:400;color:var(--mut)">(sample number)</span></p></div></div></section>""",
        q=f"""<section id="q"><span class="m ey">Contact · demo form</span><h2>{E(f['title'])}.</h2>
<form id="qf" novalidate><div class="fields">
<label for="job">{E(f['jobl'])}<select id="job"></select></label>
{extras}
<div class="row"><label for="nm">Your name<input id="nm" autocomplete="name" aria-describedby="e1" required><span class="err" id="e1"></span></label><label for="ct">Phone or email<input id="ct" aria-describedby="e2" required><span class="err" id="e2"></span></label></div>
<label for="nt">Anything we should know?<textarea id="nt"></textarea></label>{walk}
<div><button class="btn" type="submit">Send request</button></div></div>
<div><div class="sum" aria-live="polite"><h3>Your request</h3><dl><div><dt>{E(f['jobl'])}</dt><dd id="sj"></dd></div>{sumx}</dl><p class="hint">Concept only. Nothing is sent from this preview. Inbox delivery would be connected during setup.</p></div><div class="done" id="dn" hidden><b>Request ready</b><p id="dt"></p></div></div></form></section>""",
        x=sec2html,
    )
    if not s.get('show_gallery', True):
        blocks['g'] = ''
    content = compose(s, blocks)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>{E(s['name'])}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family={fam}&display=swap"><style>{css}</style></head><body class="site-{s['id']}">
<a class="skip-link" href="#main">Skip to content</a>
<div class="wrap">
<div class="note"><b>Concept preview</b><span>A {E(s['cat'].lower())} concept. Sample content; generated images are illustrative.</span></div>
<nav><div class="logo">{E(s['name'])}</div><ul>{nav}</ul><a class="btn" href="#q">{E(s['cta'])}</a></nav>
{content}
<footer><span>{E(s['name'])} · concept preview</span><span>Licenses, reviews, prices and guarantees come from the owner. None are shown here.</span></footer>
</div>
<script>
var D={data};var sel=D.jobs[0][0];
function $(i){{return document.getElementById(i)}}
function paint(){{var g=$('svc'),j=$('job');g.innerHTML='';j.innerHTML='';
D.jobs.forEach(function(x){{var b=document.createElement('button');b.type='button';b.className='chip';b.setAttribute('aria-pressed',String(x[0]===sel));b.innerHTML='<b></b><span></span>';b.firstChild.textContent=x[0];b.lastChild.textContent=x[1];b.onclick=function(){{sel=x[0];paint();location.hash='#q';$('job').focus()}};g.appendChild(b);
var o=document.createElement('option');o.textContent=x[0];if(x[0]===sel)o.selected=true;j.appendChild(o)}});sync()}}
function sync(){{$('sj').textContent=$('job').value;for(var i=0;i<D.nx;i++){{var e=$('x'+i);$('sx'+i).textContent=e.value||'Not set'}}}}
$('job').addEventListener('change',function(){{sel=$('job').value;paint()}});
for(var i=0;i<D.nx;i++){{$('x'+i).addEventListener('input',sync);$('x'+i).addEventListener('change',sync)}}
var N=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function fmt(h){{var a=h<12?'am':'pm',x=h%12||12;return x+':00 '+a}}
function hours(){{var d=new Date(),di=(d.getDay()+6)%7,t=d.getHours()+d.getMinutes()/60,tb=$('hrs');tb.innerHTML='';
D.hours.forEach(function(h,i){{var tr=document.createElement('tr');if(i===di)tr.className='today';tr.innerHTML='<td></td><td></td>';tr.cells[0].textContent=N[i];tr.cells[1].textContent=h[0]?fmt(h[0])+' to '+fmt(h[1]):'Closed';tb.appendChild(tr)}});
var h=D.hours[di],o=h[0]&&t>=h[0]&&t<h[1];$('dot').className='dot'+(o?' o':'');$('ot').textContent=o?'Sample hours: open until '+fmt(h[1]):'Sample hours: closed'}}
$('qf').addEventListener('submit',function(e){{e.preventDefault();var ok=true;
var n=$('nm').value.trim();$('e1').textContent=n?'':'Enter your name.';ok=ok&&!!n;
var c=$('ct').value.trim(),v=/^\\S+@\\S+\\.\\S+$/.test(c)||c.replace(/\\D/g,'').length>=10;$('e2').textContent=v?'':'Enter a phone number or email.';ok=ok&&v;
if(!ok){{$(n?'ct':'nm').focus();return;}}$('dn').hidden=false;$('dt').textContent='Thanks, '+n+'. This preview does not send anything. Inbox delivery is a separate setup step.'}});
paint();hours();setInterval(hours,60000);
</script></body></html>"""

def main():
    os.makedirs('out', exist_ok=True)
    pages = {}
    for s in S:
        pages[s['id']] = page(s)
        open(f"out/{s['id']}.html", 'w', encoding='utf-8').write(pages[s['id']])
    idx = gallery(S, pages, thumbnail)
    open('out/index.html', 'w', encoding='utf-8').write(idx)
    print(len(S), 'sites written to out/')

if __name__ == '__main__':
    main()

