(() => {
  const strip = document.querySelector('.skills-strip');
  const button = document.querySelector('.strip-toggle');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;
  function update() {
    strip.classList.toggle('paused', paused || reduced.matches);
    button.disabled = reduced.matches;
    button.textContent = reduced.matches ? 'Sin movimiento' : paused ? 'Continuar' : 'Pausar';
    button.setAttribute('aria-pressed', String(paused || reduced.matches));
  }
  button.addEventListener('click', () => { paused = !paused; update(); });
  reduced.addEventListener('change', update);
  update();
})();
