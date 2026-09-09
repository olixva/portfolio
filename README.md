# Portfolio — Antonio Oliva Cárceles

Web personal estática construida con HTML, CSS y JavaScript sin dependencias ni proceso de compilación.

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
- `dist/assets/`: imágenes de la web y retrato.

## Preferencias de diseño actuales

- Fondo oscuro carbón, texto marfil y acentos verde lima.
- Navegación y footer con el logotipo `ao/`.
- Animaciones respetan `prefers-reduced-motion`.
- La web es responsive y no requiere backend.
