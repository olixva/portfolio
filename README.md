# Portfolio — Antonio Oliva Cárceles

Portfolio personal con proyectos, hackathons, experiencia y formación. El hero combina una animación de entrada con una escultura 3D interactiva y partículas.

**Web:** [antoniooliva.com](https://antoniooliva.com)

HTML, CSS y JavaScript, con Three.js y GSAP autoalojados. No requiere instalación de paquetes ni compilación: se publica directamente la carpeta `public/`.

## Desarrollo local

Requiere Python 3:

```sh
python3 -m http.server 8000 -d public
```

Abre [localhost:8000](http://localhost:8000). Usa un servidor HTTP para que el navegador pueda cargar los módulos, el vídeo y el modelo.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `public/index.html` | Contenido, metadatos y arranque de la página |
| `public/css/` | Estilos: base, layout, componentes, secciones y hero, en ese orden |
| `public/js/` | Navegación, animaciones de scroll, cursor e interfaz |
| `public/js/hero/` | Escena 3D, entrada, materiales y partículas |
| `public/assets/` | Vídeo de entrada y modelo GLB |
| `public/vendor/`, `public/fonts/` | Dependencias, fuentes y licencias |
| `tools/` | Panel de ajuste visual y diagnóstico de GPU |
| `scripts/` | Validación y actualización de huellas de caché |
| `design/` | Recursos de diseño y plantilla de imagen social |

## Escultura y animación

El vídeo `public/assets/intro.mp4` se reproduce mientras carga el modelo. Al terminar, su último fotograma se funde con la escultura plateada y dorada. Después, una onda transforma los reflejos a verde y emite partículas desde la superficie.

La pieza responde al puntero y permite girarla arrastrando; en móvil gira automáticamente. Las partículas reaccionan al movimiento y a clics breves. La página respeta la preferencia de movimiento reducido y dispone de un fallback si WebGL o el modelo no están disponibles.

Los ajustes principales están en:

- `hero3d.js`: cámara, pose, tiempos, render e interacción.
- `intro.js`: reproducción y carga del vídeo.
- `sculpture.js`: paleta, material, luces de estudio y onda de transformación.
- `atmosphere.js`: cantidad, aspecto y puntos de emisión de partículas.
- `atmosphere-motion.js`: velocidades, deriva y fuerzas de las partículas.

Todos ellos se encuentran en `public/js/hero/`. El vídeo y el GLB tienen diferencias geométricas; la continuidad visual depende tanto del material como de la pose y del fundido.

### Herramientas visuales

Sirve la raíz del repositorio en un segundo puerto:

```sh
python3 -m http.server 8001
```

- [Panel de materiales y luces](http://localhost:8001/tools/tune.html).
- [Diagnóstico de GPU](http://localhost:8001/tools/render-probe.html): `invalidAfter` debe ser cero.
- [Portfolio](http://localhost:8001/public/).

## Verificación

Requiere Python 3 y Node.js. Después de editar CSS o JavaScript:

```sh
python3 scripts/stamp.py
python3 scripts/check.py
git diff --check
node scripts/test-atmosphere.cjs
```

`stamp.py` actualiza las huellas de los recursos para invalidar la caché. `check.py` comprueba sintaxis, rutas locales y vigencia de esas huellas.

Las pruebas de navegador requieren `playwright`, `pngjs`, Chrome y el navegador WebKit de Playwright. Si los paquetes están fuera del repositorio, configura `NODE_PATH` con la ruta a su carpeta `node_modules`.

```sh
node scripts/test-intro.cjs http://localhost:8000
node scripts/test-hero-handoff.cjs http://localhost:8000
node scripts/test-surface-handoff.cjs http://localhost:8000
node scripts/test-atmosphere-browser.cjs http://localhost:8000
node scripts/test-hero-layout.cjs http://localhost:8000
node scripts/test-mobile-layout.cjs http://localhost:8000
node scripts/test-intro-safari.cjs http://localhost:8000
```

Completa la validación con una revisión visual en escritorio y móvil: final del vídeo, reflejos, transformación a verde, arrastre, navegación y movimiento reducido. Los checks estáticos no detectan defectos de renderizado en GPU.

## Publicación

`wrangler.jsonc` configura un Worker de Cloudflare que sirve `public/` en `antoniooliva.com` y `www.antoniooliva.com`. No hay paso de build. Las herramientas y los scripts de desarrollo quedan fuera de la carpeta publicada.

La imagen social se sirve desde Cloudflare R2; su plantilla está en `design/og-card.html`. Modificar la plantilla no actualiza la imagen publicada: hay que regenerarla y subirla a R2, conservando o actualizando la URL de los metadatos en `index.html`.

Conserva las licencias de las dependencias y fuentes incluidas en `public/vendor/` y `public/fonts/`.
