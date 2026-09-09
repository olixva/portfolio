"""Sella los CSS y JS propios con una huella de su contenido.

Sin compilacion no hay quien reviente la cache del navegador, y mantener los
`?v=` a mano se olvida: se sirve una hoja vieja y se depura un fantasma. Esto
calcula la huella de cada fichero y la escribe en quien lo referencia.

    python3 scripts/stamp.py     actualiza las huellas
    python3 scripts/check.py     avisa si alguna se ha quedado atras
"""
from pathlib import Path
import hashlib
import re

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
PAGE = PUBLIC / 'index.html'
# hero3d importa a sculpture: si solo se sella la pagina, cambiar el material
# no llega al navegador porque el modulo que lo trae no ha cambiado de nombre.
MODULE = PUBLIC / 'js' / 'hero' / 'hero3d.js'


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def restamp(text, base, pattern):
    """Reescribe `?v=` en cada referencia local que encaje con `pattern`."""
    def replace(match):
        target = base / match.group('path')
        if not target.exists():
            return match.group(0)
        return f'{match.group("path")}?v={fingerprint(target)}'
    return re.sub(pattern, replace, text)


def stamp(write=True):
    """Devuelve los ficheros cuya huella no estaba al dia."""
    stale = []
    # Primero el modulo, para que su propia huella ya incluya la del importado.
    module = MODULE.read_text()
    sealed = restamp(module, MODULE.parent, r'(?P<path>\./[\w.-]+\.js)(\?v=[0-9a-f]+)?')
    if sealed != module:
        stale.append(MODULE.relative_to(ROOT))
        if write:
            MODULE.write_text(sealed)

    page = PAGE.read_text()
    sealed = restamp(page, PUBLIC, r'(?P<path>(?:css|js)/[\w./-]+\.(?:css|js))(\?v=[0-9a-f]+)?')
    if sealed != page:
        stale.append(PAGE.relative_to(ROOT))
        if write:
            PAGE.write_text(sealed)
    return stale


if __name__ == '__main__':
    changed = stamp()
    print('Huellas actualizadas: ' + ', '.join(map(str, changed)) if changed
          else 'Las huellas ya estaban al dia.')
