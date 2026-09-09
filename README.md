# Portfolio — Antonio Oliva Cárceles

Web personal estática construida con HTML, CSS y JavaScript, sin proceso de compilación.
Las dependencias van autoalojadas en `dist/vendor/` y `dist/fonts/`: la web
funciona sin conexión y sin CDN.

## Abrir el proyecto

Abre `dist/index.html` en un navegador o sírvelo desde la carpeta raíz:

```bash
python3 -m http.server 8000 -d dist
```

Después, visita `http://localhost:8000`.

## Estructura

- `dist/index.html`: contenido y estructura de la página.
- `dist/style.css`: estilos base.
- `dist/refinements.css`, `compact.css`, `details.css`, `orbit.css` y `personal.css`: ajustes por secciones y responsive.
- `dist/script.js`: progreso de lectura, animaciones de entrada y comportamiento del hero.
- `dist/details.js`: carrusel de tecnologías y menú móvil.
- `dist/spark-cursor.js`: efecto de destellos del cursor en escritorio.
- `dist/assets/`: imágenes de la web, retrato e imagen de compartición (`og.jpg`).
- `dist/fonts/`: DM Sans autoalojada (SIL OFL 1.1).
- `dist/vendor/`: three.js y GSAP, a la espera del hero 3D.
- `dist/hero3d.js` y `hero3d.css`: hero WebGL, **aún sin enlazar** desde
  `index.html`. Se activará cuando esté el asset 3D definitivo.
- `sources/`: material que no se publica — masters de las imágenes, la
  plantilla `og-card.html` y CSS/JS de versiones anteriores.

## Preferencias de diseño actuales

- Fondo oscuro carbón, texto marfil y acentos verde lima.
- Navegación y footer con el logotipo `ao/`.
- Animaciones respetan `prefers-reduced-motion`.
- La web es responsive y no requiere backend.

## Regenerar la imagen de compartición

`sources/og-card.html` es la plantilla. Cópiala a `dist/`, sírvela y captúrala:

```bash
cp sources/og-card.html dist/ && python3 -m http.server 8000 -d dist &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --force-device-scale-factor=2 --window-size=1200,630 \
  --screenshot=/tmp/og.png http://localhost:8000/og-card.html
sips -Z 1200 -s format jpeg -s formatOptions 82 /tmp/og.png --out dist/assets/og.jpg
rm dist/og-card.html
```

## Pendiente

- `og:url` y `og:image` deberían pasar a URL absolutas cuando la web tenga
  dominio propio; ahora son relativas.
