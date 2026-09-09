# Portfolio — Antonio Oliva Cárceles

Web estática con HTML, CSS, JavaScript, Three.js y GSAP. Sin instalación de paquetes ni compilación. Dependencias y fuentes autoalojadas.

## Desarrollo

```sh
python3 -m http.server 8000 -d dist
```

Abre http://localhost:8000. Usa HTTP: abrir con `file://` puede bloquear módulos y modelos según el navegador.

## Estructura

- `dist/`: sitio listo para publicar; contiene también el código fuente.
- `dist/index.html`: contenido, metadatos y arranque temprano de la intro.
- `dist/style.css`: estilos base. `refinements.css`, `compact.css`, `details.css`, `orbit.css` y `personal.css` añaden ajustes de composición y secciones. Su orden de carga es intencional.
- `dist/hero3d.js` y `hero3d.css`: carga, render, interacción y presentación del hero.
- `dist/sculpture.js`: material y entorno compartidos con el panel de ajuste.
- `dist/script.js`: scroll y animaciones de entrada.
- `dist/details.js`: acordeones, carrusel y menú móvil.
- `dist/cursor-light.js`: cursor y halo.
- `dist/assets/`, `fonts/`, `vendor/`: recursos optimizados, dependencias y licencias.
- `tools/`: herramientas de desarrollo; no se publican.
- `sources/`: masters, plantilla de imagen social y versiones históricas. El GLB original ocupa unos 58 MB; no hace falta para servir la web.
- `scripts/`: comprobaciones del repositorio.

## Herramientas

Sirve la raíz para acceder a ellas:

```sh
python3 -m http.server 8001
```

- http://localhost:8001/dist/ — portfolio.
- http://localhost:8001/tools/tune.html — ajuste de material y luces.
- http://localhost:8001/tools/render-probe.html — diagnóstico numérico de GPU; `invalidAfter` debe ser cero. El resultado original depende de la GPU.

El shader limita la base del Fresnel antes de `pow` para evitar valores NaN que el bloom puede propagar como manchas negras. Conserva ese límite. Al cambiar los módulos del hero, actualiza las versiones de caché en `index.html` y `hero3d.js`.

## Verificación

Requiere Python 3 y Node.js:

```sh
python3 scripts/check.py
git diff --check
```

Revisión visual: giro del hero en Chrome y Safari, cursor, recarga desde una sección con ancla, acordeones y layout móvil. Los checks estáticos no detectan fallos de GPU.

## Publicación

Publica únicamente `dist/`. No hay comando de build. Para GitHub Pages usa un workflow que publique esa carpeta como artefacto; el modo por rama no permite seleccionar `dist/` directamente. Las rutas relativas admiten subdirectorios.

Con el dominio definitivo, configura `og:url`, `og:image` y `twitter:image` con URL absolutas en `index.html`. La imagen social es `dist/assets/og.jpg` y su plantilla está en `sources/og-card.html`.

Conserva las licencias de terceros en `dist/vendor/` y `dist/fonts/`.
