"""Comprueba la sintaxis del JavaScript propio y que los recursos locales existan."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stamp import stamp

ROOT = Path(__file__).resolve().parents[1]
errors = []
checked = 0


def javascript(source, label):
    global checked
    with tempfile.NamedTemporaryFile(suffix='.mjs', mode='w') as file:
        file.write(source)
        file.flush()
        result = subprocess.run(['node', '--check', file.name], capture_output=True, text=True)
    checked += 1
    if result.returncode:
        errors.append(f'{label}: {result.stderr}')


def reference(value, base):
    url = urlsplit(value)
    if url.scheme or url.netloc or not url.path:
        return
    path = unquote(url.path)
    target = ROOT / 'public' / path.lstrip('/') if path.startswith('/') else base / path
    if not target.exists():
        errors.append(f'{base.relative_to(ROOT)}: missing {value}')


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.path = path
        self.base = path.parent
        self.script = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'base':
            self.base = (self.path.parent / attrs['href']).resolve()
        for key in ('src', 'href', 'poster'):
            if key in attrs and tag != 'base':
                reference(attrs[key], self.base)
        if tag == 'script' and 'src' not in attrs and attrs.get('type', '') in ('', 'module', 'text/javascript'):
            self.script = ''

    def handle_data(self, data):
        if self.script is not None:
            self.script += data

    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            javascript(self.script, self.path.relative_to(ROOT))
            self.script = None


for path in sorted((ROOT / 'public' / 'js').rglob('*.js')):
    javascript(path.read_text(), str(path.relative_to(ROOT)))
for folder in ('public', 'tools', 'design'):
    for path in sorted((ROOT / folder).rglob('*.html')):
        Page(path).feed(path.read_text())
for path in sorted((ROOT / 'public' / 'css').glob('*.css')):
    for value in re.findall(r'url\(\s*[\'\"]?([^\'\")]+)', path.read_text()):
        reference(value.strip(), path.parent)
stale = stamp(write=False)
if stale:
    errors.append('huellas de cache sin actualizar en ' + ', '.join(map(str, stale))
                  + '\n  ejecuta: python3 scripts/stamp.py')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'OK: {checked} bloques de JavaScript; recursos locales y huellas de cache al dia.')
