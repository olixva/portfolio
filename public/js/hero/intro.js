// Descarga completa antes de reproducir, mientras el GLB carga en paralelo.
// No espera canplay: Safari puede posponer ese evento hasta llamar a play().
export function prepareIntro(enabled) {
  if (!enabled) return null;
  clearTimeout(window.aoIntroWatchdog);
  const overlay = document.createElement('div');
  overlay.className = 'ao-intro';
  overlay.innerHTML = '<div class="ao-intro-backdrop"></div><video muted playsinline preload="auto" aria-hidden="true"></video><span class="ao-intro-loader" role="status" aria-label="Cargando"><i></i></span><button class="ao-intro-play" hidden>Entrar</button>';
  document.body.append(overlay);
  const video = overlay.querySelector('video');
  const loader = overlay.querySelector('.ao-intro-loader');
  const button = overlay.querySelector('button');
  const controller = new AbortController();
  let url, finished = false, disposed = false, resolveEnded, playbackTimer;
  const ended = new Promise(resolve => { resolveEnded = resolve; });
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    clearTimeout(playbackTimer);
    resolveEnded();
  };
  video.muted = video.defaultMuted = true;
  video.playsInline = true;
  const timer = setTimeout(() => { controller.abort(); finish(); }, 45000);
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
  const resume = () => { if (!document.hidden && url && video.paused && button.hidden) play(); };
  document.addEventListener('visibilitychange', resume);
  fetch('assets/intro.mp4?v=bf3a5343', { signal: controller.signal })
    .then(response => { if (!response.ok) throw new Error('Video no disponible'); return response.blob(); })
    .then(blob => {
      if (finished || disposed) return;
      clearTimeout(timer);
      url = URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
      video.src = url;
      video.load();
      play();
    }).catch(finish);
  return {
    overlay, video, ended,
    waiting() { if (finished && !disposed) loader.hidden = false; },
    hideLoader() { loader.hidden = button.hidden = true; },
    dispose() {
      disposed = true;
      finish();
      clearTimeout(playbackTimer);
      controller.abort();
      document.removeEventListener('visibilitychange', resume);
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (url) URL.revokeObjectURL(url);
      overlay.remove();
    }
  };
}
