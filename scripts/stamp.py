"""Sella con una huella de su contenido todo lo que el navegador cachea.

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
INTRO = PUBLIC / 'js' / 'hero' / 'intro.js'
ATMOSPHERE = MODULE.parent / 'atmosphere.js'

# El video y el modelo se piden desde JavaScript, no desde el HTML, y sus rutas
# se resuelven contra la pagina: tanto fetch() como el cargador de GLTF usan la
# URL del documento como base, no la del modulo que los pide.
ASSETS = r'(?P<path>assets/[\w.-]+\.(?:mp4|glb|webm|webp|jpg|png|svg))(\?v=[0-9a-f]+)?'
IMPORTS = r'(?P<path>\./[\w.-]+\.js)(\?v=[0-9a-f]+)?'
PAGE_REFS = r'(?P<path>(?:css|js)/[\w./-]+\.(?:css|js))(\?v=[0-9a-f]+)?'


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
    """Devuelve los ficheros cuya huella no estaba al dia.

    El orden es de dentro hacia fuera: quien sella a otro tiene que hacerlo
    despues de que ese otro haya cambiado, o su propia huella nace caducada.
    """
    stale = []

    def seal(path, rules):
        text = original = path.read_text()
        for base, pattern in rules:
            text = restamp(text, base, pattern)
        if text != original:
            stale.append(path.relative_to(ROOT))
            if write:
                path.write_text(text)

    # 1. intro.js apunta al video; 2. hero3d.js al modelo y ademas importa a
    # intro.js, que acaba de cambiar; 3. la pagina, a todo lo anterior.
    seal(INTRO, [(PUBLIC, ASSETS)])
    if ATMOSPHERE.exists():
        seal(ATMOSPHERE, [(ATMOSPHERE.parent, IMPORTS)])
    seal(MODULE, [(PUBLIC, ASSETS), (MODULE.parent, IMPORTS)])
    seal(PAGE, [(PUBLIC, PAGE_REFS)])
    return stale


if __name__ == '__main__':
    changed = stamp()
    print('Huellas actualizadas: ' + ', '.join(map(str, changed)) if changed
          else 'Las huellas ya estaban al dia.')
