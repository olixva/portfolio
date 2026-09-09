// El vídeo se descarga entero antes de reproducirse: no hay pausas de red a mitad.
// El GLB se prepara en paralelo y puede prolongar el último fotograma.
export function prepareIntro(enabled) {
  if (!enabled) return null;
  clearTimeout(window.aoIntroWatchdog);
  const overlay = document.createElement('div');
  overlay.className = 'ao-intro';
  overlay.innerHTML = '<div class="ao-intro-backdrop"></div><video muted playsinline preload="auto" aria-hidden="true"></video><span class="ao-intro-loader" role="status" aria-label="Cargando"> <i></i></span><button class="ao-intro-play" hidden>Entrar</button>';
  document.body.append(overlay);
  const video = overlay.querySelector('video');
  const loader = overlay.querySelector('.ao-intro-loader');
  const button = overlay.querySelector('button');
  const controller = new AbortController();
  let url, finished = false, resolveEnded;
  const ended = new Promise(resolve => { resolveEnded = resolve; });
  const finish = () => { if (!finished) { finished = true; resolveEnded(); } };
  video.muted = true;
  video.addEventListener('ended', finish, { once: true });
  video.addEventListener('error', finish, { once: true });
  const timer = setTimeout(() => { controller.abort(); finish(); }, 45000);
  async function play() {
    try {
      await video.play();
      button.hidden = true;
      loader.hidden = true;
      overlay.classList.add('is-playing');
    } catch {
      loader.hidden = true;
      button.hidden = false;
    }
  }
  button.addEventListener('click', play);
  fetch('assets/intro.mp4', { signal: controller.signal })
    .then(response => { if (!response.ok) throw new Error('Video no disponible'); return response.blob(); })
    .then(blob => {
      if (finished) return;
      url = URL.createObjectURL(blob);
      video.src = url;
      video.addEventListener('canplay', () => { clearTimeout(timer); play(); }, { once: true });
    }).catch(finish);
  return {
    overlay, video, ended,
    waiting() { if (finished) loader.hidden = false; },
    hideLoader() { loader.hidden = true; button.hidden = true; },
    dispose() {
      finish();
      clearTimeout(timer);
      controller.abort();
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (url) URL.revokeObjectURL(url);
      overlay.remove();
    }
  };
}
