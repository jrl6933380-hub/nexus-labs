"""Self-contained, script-free gallery for mobile document previewers.

Native details expose complete inline pages, without JS or iframe permission.
Site styles and fragment IDs are namespaced to avoid cross-concept collisions.
"""
import re
from html import escape as E

CSS = '''
:root{color-scheme:light dark;--gallery-bg:#f1eee7;--gallery-fg:#242624;--gallery-panel:#fffdf8;--gallery-line:#d9d5cb;--gallery-muted:#60655e}
@media(prefers-color-scheme:dark){:root{--gallery-bg:#111513;--gallery-fg:#f0ece3;--gallery-panel:#1b211e;--gallery-line:#343c36;--gallery-muted:#bdc4bc}}
*{box-sizing:border-box}body{margin:0;background:var(--gallery-bg);color:var(--gallery-fg);font:16px/1.5 system-ui,sans-serif;padding:24px max(16px,env(safe-area-inset-left)) 48px}
.library{max-width:1240px;margin:auto}.library>h1{font-size:clamp(30px,5vw,48px);line-height:1.1;margin:0 0 12px}.library>p{max-width:64ch;color:var(--gallery-muted);margin:0 0 24px}
.concepts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:18px;align-items:start}
.concept{border:1px solid var(--gallery-line);border-radius:12px;background:var(--gallery-panel);overflow:hidden;min-width:0}
.concept[open]{grid-column:1/-1}.concept summary{cursor:pointer;list-style:none}.concept summary::-webkit-details-marker{display:none}.concept summary:focus-visible{outline:3px solid currentColor;outline-offset:-4px}
.concept[open]>summary{border-bottom:1px solid var(--gallery-line);display:flex;align-items:center;gap:16px;padding:12px 16px}
.thumb{position:relative;aspect-ratio:16/10;overflow:hidden;background:var(--thumb-bg)}.thumb>img,.thumb>svg{display:block;width:100%;height:100%;object-fit:cover;position:absolute;inset:0}
.concept[open]>summary .thumb{width:90px;aspect-ratio:1;flex-shrink:0;border-radius:6px}.caption{padding:16px;display:grid;gap:3px}.caption b{font-size:20px}.caption span{color:var(--gallery-muted);font-size:14px}.caption .close-label{display:none}.concept[open] .open-label{display:none}.concept[open] .close-label{display:block}.caption small{color:var(--gallery-muted)}
.preview-page{overflow:hidden;min-width:0}.preview-notice{padding:12px 16px;color:var(--gallery-fg);background:var(--gallery-panel);border-bottom:1px solid var(--gallery-line);font-size:14px}
@media(max-width:520px){.concept[open]>summary{padding:10px;gap:10px}.concept[open]>summary .caption{padding:0}.concept[open]>summary .caption b{font-size:17px}}
'''


def prefix_selector(selector, namespace):
    selector = selector.strip()
    # Only fragment selectors are rewritten; declaration colors are untouched.
    selector = re.sub(r'#([A-Za-z][\w-]*)', lambda m: '#' + namespace + '-' + m[1], selector)
    selector = re.sub(r':root|\bhtml\b|\bbody\b', '#' + namespace, selector)
    root = '#' + namespace
    if selector.startswith('.site-'):
        selector = root + selector
    if not selector.startswith(root):
        selector = root + ' ' + selector
    # html/body descendants in these styles are alternatives for the same wrapper.
    selector = selector.replace(root + ' ' + root, root)
    return selector


def scope_css(css, namespace):
    """Scope the generator's flat rules and nested media blocks, without dependencies."""
    result = []
    position = 0
    while position < len(css):
        opening = css.find('{', position)
        if opening < 0:
            break
        selector = css[position:opening].strip()
        depth, closing = 1, opening + 1
        quote = None
        while closing < len(css) and depth:
            char = css[closing]
            if quote:
                if char == quote and css[closing - 1] != '\\':
                    quote = None
            elif char in ('"', "'"):
                quote = char
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
            closing += 1
        if depth:
            raise ValueError('Unbalanced concept CSS')
        block = css[opening + 1:closing - 1]
        if selector.startswith('@media'):
            result.append(selector + '{' + scope_css(block, namespace) + '}')
        elif selector.startswith('@'):
            raise ValueError('Unsupported concept CSS rule: ' + selector)
        else:
            # Current generator selectors contain no comma within a function.
            selectors = ','.join(prefix_selector(x, namespace) for x in selector.split(','))
            result.append(selectors + '{' + block + '}')
        position = closing
    return ''.join(result)


def static_body(s, html, namespace):
    body = re.search(r'<body[^>]*>(.*?)</body>', html, re.S)[1]
    body = re.sub(r'<script\b[^>]*>.*?</script>', '', body, flags=re.S)
    services = ''.join(f'<a class="chip" href="#q"><b>{E(a)}</b><span>{E(b)}</span></a>' for a, b in s['svcs'])
    body = body.replace('<div class="grid" id="svc"></div>', '<div class="grid" id="svc">' + services + '</div>')
    options = ''.join(f'<option>{E(a)}</option>' for a, _ in s['svcs'])
    body = body.replace('<select id="job"></select>', '<select id="job">' + options + '</select>')
    names = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
    def fmt(hour):
        return f'{hour % 12 or 12}:00 {"am" if hour < 12 else "pm"}'
    rows = ''.join(f'<tr><td>{day}</td><td>{fmt(a) + " to " + fmt(b) if a else "Closed"}</td></tr>' for day, (a, b) in zip(names, s['hours']))
    body = body.replace('<table id="hrs"></table>', '<table id="hrs">' + rows + '</table>')
    body = body.replace('Checking hours', 'Sample opening hours below')
    body = body.replace('<dd id="sj"></dd>', f'<dd id="sj">{E(s["svcs"][0][0])}</dd>')
    body = re.sub(r'(<dd id="sx\d+">)</dd>', r'\1Not set</dd>', body)
    body = body.replace('<button class="btn" type="submit">Send request</button>', '<button class="btn" type="button" disabled>Preview only — nothing is sent</button>')
    body = body.replace('<form id="qf" novalidate>', '<div id="qf" class="static-form">').replace('</form>', '</div>')
    # Make all IDs, labels and internal anchors independent across the inline pages.
    body = re.sub(r'\b(id|for|aria-describedby)="([^"]+)"', lambda m: f'{m[1]}="{namespace}-{m[2]}"', body)
    body = re.sub(r'href="#([^"]+)"', lambda m: f'href="#{namespace}-{m[1]}"', body)
    return body


def gallery(sites, pages, thumbnail):
    styles, concepts, fonts = [], [], []
    for s in sites:
        ns = 'concept-' + s['id']
        html = pages[s['id']]
        css = re.search(r'<style>(.*?)</style>', html, re.S)[1]
        css += '\n.static-form{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:24px}.chip{text-decoration:none}.btn[disabled]{opacity:.65;cursor:default}@media(max-width:860px){.static-form{grid-template-columns:1fr}}'
        styles.append(scope_css(css, ns))
        fonts += re.findall(r'<link rel="stylesheet" href="([^"]+)"', html)
        concepts.append(f'<details class="concept" id="card-{s["id"]}"><summary><div class="thumb" style="--thumb-bg:{s["pal"]["deep"]}">{thumbnail(s)}</div><div class="caption"><b>{E(s["name"])}</b><span>{E(s["cat"])}</span><small class="open-label">Tap to open site preview ↓</small><small class="close-label">Tap here to close ↑</small></div></summary><div class="preview-notice">Site preview · sample information. Forms are display-only in this gallery.</div><div id="{ns}" class="preview-page site-{s["id"]}">{static_body(s, html, ns)}</div></details>')
    links = ''.join(f'<link rel="stylesheet" href="{url}">' for url in sorted(set(fonts)))
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Nexus Site Library</title>' + links + '<style>' + CSS + ''.join(styles) + '</style></head><body><main class="library"><h1>Nexus site library</h1><p>Tap a card to expand the complete site. Tap its heading again to close it. These concepts contain sample information and illustrative artwork.</p><div class="concepts">' + ''.join(concepts) + '</div></main></body></html>'
