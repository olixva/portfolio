// Arranca como módulo hermano de hero3d.js (cargado desde index.html antes
// que el grafo de Three): el navegador pide intro.mp4 en cuanto termina de
// evaluar este módulo y el GLB se pide en paralelo desde hero3d. El <video>
// consume el recurso por HTTP directamente: el propio navegador gestiona los
// Range requests, el buffering progresivo y la decodificación; no esperamos a
// descargar el MP4 completo antes de llamar a play().
//
// Con prefers-reduced-motion la IIFE de index.html no añade la clase
// ao3d-intro, así que el bootstrap de este módulo no hace nada y nunca se
// pide el vídeo.
const INTRO_URL = 'assets/intro.mp4?v=bf3a5343';

let state = null;

function build() {
  if (state) return state;
  clearTimeout(window.aoIntroWatchdog);
  const overlay = document.createElement('div');
  overlay.className = 'ao-intro';
  overlay.innerHTML = '<div class="ao-intro-backdrop"></div><video muted playsinline preload="auto" aria-hidden="true"></video><span class="ao-intro-loader" role="status" aria-label="Cargando"><i></i></span><button class="ao-intro-play" hidden>Entrar</button>';
  document.body.append(overlay);
  const video = overlay.querySelector('video');
  const loader = overlay.querySelector('.ao-intro-loader');
  const button = overlay.querySelector('button');
  let finished = false, disposed = false, resolveEnded, playbackTimer;
  const ended = new Promise(resolve => { resolveEnded = resolve; });
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(playbackTimer);
    resolveEnded();
  };
  video.muted = video.defaultMuted = true;
  video.playsInline = true;
  const offerPlayback = () => {
    if (finished || disposed) return;
    loader.hidden = true;
    button.hidden = false;
  };
  video.addEventListener('ended', finish, { once: true });
  video.addEventListener('error', finish, { once: true });
  video.addEventListener('playing', () => {
    if (disposed) return;
    clearTimeout(playbackTimer);
    button.hidden = loader.hidden = true;
    overlay.classList.add('is-playing');
  });
  async function play() {
    if (finished || disposed) return;
    // Visible antes de play(), sin esperar su promesa ni un evento de precarga.
    overlay.classList.add('is-ready');
    clearTimeout(playbackTimer);
    playbackTimer = setTimeout(offerPlayback, 8000);
    try {
      await video.play();
    } catch (error) {
      clearTimeout(playbackTimer);
      if (disposed) return;
      if (error.name === 'NotAllowedError' || error.name === 'AbortError') offerPlayback();
      else finish();
    }
  }
  button.addEventListener('click', play);
  const resume = () => { if (!document.hidden && video.paused && button.hidden) play(); };
  document.addEventListener('visibilitychange', resume);
  // Asignación directa al <video>: el navegador pide el MP4, hace Range
  // requests y empieza a reproducir en cuanto tiene buffer suficiente. Sin
  // fetch, sin blob, sin createObjectURL, sin esperar a los ~1.2 MB enteros.
  video.src = INTRO_URL;
  video.load();
  play();
  state = {
    overlay, video, ended,
    waiting() { if (finished && !disposed) loader.hidden = false; },
    hideLoader() { loader.hidden = button.hidden = true; },
    dispose() {
      disposed = true;
      finish();
      clearTimeout(playbackTimer);
      document.removeEventListener('visibilitychange', resume);
      video.pause();
      video.removeAttribute('src');
      video.load();
      overlay.remove();
    }
  };
  return state;
}

// Arranque temprano: este módulo se evalúa antes que hero3d, así que la
// petición del MP4 sale en paralelo con la cadena de Three. Si el usuario ha
// pedido movimiento reducido, la IIFE de index.html no añade ao3d-intro y
// aquí tampoco se hace nada.
if (document.documentElement.classList.contains('ao3d-intro') && !!window.gsap) {
  build();
}

// API que consume hero3d.js: el bootstrap ya habrá construido el estado en la
// mayoría de los casos, pero prepareIntro sigue siendo idempotente por si
// hero3d.js se carga sin este script como hermano (o re-entra en algún
// fallback) y necesita garantías.
export function prepareIntro(enabled) {
  if (!enabled) return null;
  return build();
}

export function getIntro() { return state; }
