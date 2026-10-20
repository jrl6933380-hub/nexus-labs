"""Structural regression checks; deliberately does not claim browser QA."""
import base64
import copy
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import tempfile

from gen import S
from render import page, INDEX_JS
from directions import ORDERS, compose


class Document(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.hrefs = []
        self.labels = []
        self.inputs = []
        self.sections = []
        self.scripts = []
        self.in_script = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'a' and attrs.get('href', '').startswith('#'):
            self.hrefs.append(attrs['href'][1:])
        if tag == 'label' and attrs.get('for'):
            self.labels.append(attrs['for'])
        if tag in ('input', 'select', 'textarea'):
            self.inputs.append(attrs.get('id'))
        if tag == 'header':
            self.sections.append('hero')
        if tag == 'section':
            self.sections.append(attrs['id'])
        if tag == 'script':
            self.in_script = True
            self.scripts.append('')

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_script = False

    def handle_data(self, data):
        if self.in_script:
            self.scripts[-1] += data


def main():
    assert len(S) == 15 and len({s['id'] for s in S}) == 15
    with tempfile.TemporaryDirectory() as temp:
        for s in S:
            rendered = page(s)
            d = Document()
            d.feed(rendered)
            assert len(d.ids) == len(set(d.ids)), (s['id'], 'duplicate ID')
            assert set(d.hrefs) <= set(d.ids), (s['id'], 'broken fragment')
            assert set(d.labels) <= set(d.inputs), (s['id'], 'broken form label')
            expected = [x for x in ORDERS[s['id']] if x != 'g' or s.get('show_gallery', True)]
            assert d.sections == expected, (s['id'], d.sections, expected)
            assert 'main' in d.ids and 'qf' in d.ids
            assert 'Nothing is sent' in rendered
            script = Path(temp) / (s['id'] + '.js')
            script.write_text(d.scripts[0], encoding='utf-8')
            subprocess.run(['node', '--check', str(script)], check=True, capture_output=True)
            if s.get('hero_image'):
                raw = base64.b64decode(s['hero_image']['src'].split(',', 1)[1], validate=True)
                assert raw.startswith(b'\xff\xd8') and raw.endswith(b'\xff\xd9')
                assert s['hero_image']['alt']
                assert 'provenance' in s['hero_image']
        viewer = Path(temp) / 'viewer.js'
        viewer.write_text(INDEX_JS)
        subprocess.run(['node', '--check', str(viewer)], check=True, capture_output=True)
        hostile = copy.deepcopy(S[0])
        hostile['svcs'][0] = ('</script><img src=x onerror=alert(1)>', 'literal sample')
        d = Document()
        d.feed(page(hostile))
        assert len(d.scripts) == 1, 'config must not terminate the script element'
        script = Path(temp) / 'escaping.js'
        script.write_text('function check(){\n' + d.scripts[0].split('function $(i)')[0] + '\nreturn D.jobs[0][0]}\nif(check()!==' + json.dumps(hostile['svcs'][0][0]) + ')process.exit(1)')
        subprocess.run(['node', str(script)], check=True, capture_output=True)
    try:
        compose(S[0], {'hero': ''})
        raise AssertionError('invalid section order accepted')
    except ValueError:
        pass
    print('PASS: 15 concepts; sections, links, labels, assets, script escaping and JS syntax. Browser QA not performed.')


if __name__ == '__main__':
    main()
