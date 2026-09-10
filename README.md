# Portfolio — Antonio Oliva Cárceles

Web estática con HTML, CSS, JavaScript, Three.js y GSAP. Sin instalación de paquetes ni compilación: lo que hay en `public/` es exactamente lo que se sirve. Dependencias y fuentes autoalojadas.

## Desarrollo

```sh
python3 -m http.server 8000 -d public
```

Abre http://localhost:8000. Usa HTTP: abrir con `file://` puede bloquear módulos y modelos según el navegador.

## Estructura

```
public/          lo que se publica, sin pasos intermedios
  index.html     contenido, metadatos y arranque temprano de la intro
  css/           cinco capas, de lo general a lo concreto
  js/            main, ui, cursor y la carpeta hero/
  assets/ fonts/ vendor/
design/          masters, plantilla de imagen social y versiones históricas
tools/           herramientas de desarrollo; no se publican
scripts/         comprobaciones y sellado de caché
```

### Las capas de CSS

Se cargan en orden y **ese orden importa**: `01-base` (variables, reinicio, tipografía), `02-layout` (cabecera, sección, pie), `03-components` (piezas reutilizables), `04-sections` (cada sección de la página) y `05-hero3d` (la capa WebGL). Cada selector se declara una sola vez por capa y por consulta de medios; si hace falta un ajuste, va donde ya vive ese selector en lugar de en una hoja nueva al final.

### El JavaScript

- `js/main.js`: scroll, animaciones de entrada y los saltos del menú.
- `js/ui.js`: acordeones, cinta de tecnologías y menú móvil.
- `js/cursor.js`: cursor y halo.
- `js/hero/hero3d.js`: carga, render, interacción y presentación del hero.
- `js/hero/intro.js`: precarga del vídeo, reproducción y espera del último fotograma.
- `js/hero/sculpture.js`: material y entorno, compartidos con el panel de ajuste.
- `js/hero/atmosphere.js`: aspecto y composición del humo y las partículas.
- `js/hero/atmosphere-motion.js`: inercia, emisión y fuerzas locales independientes de la escultura.

La entrada reproduce `assets/intro.mp4` en cada recarga, con la cabecera visible. El navegador reproduce el vídeo progresivamente mientras carga el GLB. El relevo espera la compilación del 3D y las fuentes, y mezcla el último fotograma completo con el render sin recortarlo sobre la malla. Primero se descubre el material dorado en 3D, con un pequeño giro; después pasa gradualmente a verde y aparece la atmósfera. Los reflejos del material dorado son una aproximación, porque la geometría no coincide exactamente con el vídeo. Con movimiento reducido se muestra directamente el modelo. El arranque llama a `load()` y `play()` sin depender de `canplay`. Si el navegador bloquea la reproducción, aparece «Entrar». El fondo CSS permanece en #111210 durante toda la entrada.

La atmósfera vive en la raíz de la escena, fuera de las transformaciones de la escultura. Cada partícula conserva posición y velocidad, deriva y se aparta suavemente de los bordes. El puntero desplaza el aire cercano y un clic breve añade un impulso; arrastrar y pulsar enlaces no dispara partículas. El giro de la pieza solo remueve su entorno inmediato. Las bocanadas nacen alrededor del metal, se desprenden, expanden y disipan; las ya emitidas no siguen al emisor. El cálculo usa pasos acotados para mantener la respuesta entre 30 y 120 Hz. Con movimiento reducido se pinta un solo fotograma sin interacción atmosférica.

El humo está desactivado en la versión actual (`cloudCount: 0`); se conserva su implementación para comparar el resultado, pero solo se crean y simulan las partículas.

La transformación a verde avanza como una onda sobre las coordenadas de la superficie, con una cresta luminosa breve. El render usa buffers con MSAA (4 muestras en escritorio, 2 en móvil, según soporte), resolución de hasta 2×, filtrado anisotrópico y un microacabado satinado filtrado para evitar parpadeo.

Pruebas de navegador (Chrome, Playwright y pngjs disponibles):

```sh
NODE_PATH=/ruta/a/node_modules node scripts/test-intro.cjs http://localhost:8000
NODE_PATH=/ruta/a/node_modules node scripts/test-hero-layout.cjs http://localhost:8000
NODE_PATH=/ruta/a/node_modules node scripts/test-hero-handoff.cjs http://localhost:8000
NODE_PATH=/ruta/a/node_modules node scripts/test-surface-handoff.cjs http://localhost:8000
NODE_PATH=/ruta/a/node_modules node scripts/test-intro-safari.cjs http://localhost:8000
NODE_PATH=/ruta/a/node_modules node scripts/test-atmosphere-browser.cjs http://localhost:8000
node scripts/test-atmosphere.cjs
```

## Herramientas

Sirve la raíz para acceder a ellas:

```sh
python3 -m http.server 8001
```

- http://localhost:8001/public/ — portfolio.
- http://localhost:8001/tools/tune.html — ajuste de material y luces.
- http://localhost:8001/tools/render-probe.html — diagnóstico numérico de GPU; `invalidAfter` debe ser cero. El resultado original depende de la GPU.

El shader limita la base del Fresnel antes de `pow` para evitar valores NaN que el bloom puede propagar como manchas negras. Conserva ese límite.

## Verificación

Requiere Python 3 y Node.js:

```sh
python3 scripts/stamp.py
python3 scripts/check.py
git diff --check
```

`stamp.py` sella cada CSS y JS con una huella de su contenido, para que el navegador no sirva una versión vieja; `check.py` valida la sintaxis del JavaScript propio, comprueba que los recursos locales existan y avisa si alguna huella se ha quedado atrás.

Revisión visual: giro del hero en Chrome y Safari, cursor, recarga desde una sección con ancla, acordeones y layout móvil. Los checks estáticos no detectan fallos de GPU.

## Publicación

Se publica `public/` tal cual, sin build. El proyecto de Cloudflare Pages está conectado directamente al repositorio de GitHub: cada empujón a `main` dispara un despliegue automático (directorio de salida: `public/`, sin comando de build). Las rutas relativas admiten subdirectorios.

Con el dominio definitivo, configura `og:url`, `og:image` y `twitter:image` con URL absolutas en `index.html`. La imagen social es `public/assets/og.jpg` y su plantilla está en `design/og-card.html`.

Conserva las licencias de terceros en `public/vendor/` y `public/fonts/`.
