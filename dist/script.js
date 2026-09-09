document.getElementById('year').textContent = new Date().getFullYear();
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(pointer:fine)');
const progress = document.querySelector('.reading-progress');
const hero = document.querySelector('.hero');
const art = document.querySelector('.hero-visual img, .hero-visual .ao-mark');
let scrollFrame = 0;
function updateProgress() {
  const total = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = 'scaleX(' + (total > 0 ? Math.min(1, scrollY / total) : 0) + ')';
  if (!reduce.matches) {
    const mobile = innerWidth <= 760;
    const heroRect = hero.getBoundingClientRect();
    if (art && heroRect.bottom > 0) art.style.setProperty('--scroll-art', Math.max(-35, Math.min(35, -heroRect.top * (mobile ? .035 : .07))) + 'px');

  }
}
addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { updateProgress(); scrollFrame = 0; });
}, { passive: true });
addEventListener('resize', updateProgress);
updateProgress();
let revealObserver;
function setupReveals() {
  if (revealObserver) revealObserver.disconnect();
  const elements = document.querySelectorAll('.reveal');
  document.documentElement.classList.remove('js-motion');
  if (reduce.matches || !('IntersectionObserver' in window)) {
    elements.forEach(element => element.classList.add('in-view'));
    return;
  }
  elements.forEach(element => element.classList.remove('in-view'));
  revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) entry.target.classList.add('in-view');
      else if (entry.boundingClientRect.top >= innerHeight || entry.boundingClientRect.bottom <= 0) {
        entry.target.classList.remove('in-view');
      }
    }
  }, { threshold: [0, .12] });
  document.documentElement.classList.add('js-motion');
  elements.forEach(element => revealObserver.observe(element));
}
setupReveals();
const contactSection = document.querySelector('.contact');
if (contactSection && 'IntersectionObserver' in window) {
  const contactObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      contactSection.classList.add('contact-entered');
      contactObserver.disconnect();
    }
  }, { threshold: .15 });
  contactObserver.observe(contactSection);
}

let pointerFrame = 0;
hero.addEventListener('pointermove', event => {
  if (reduce.matches || !finePointer.matches || innerWidth <= 760) return;
  cancelAnimationFrame(pointerFrame);
  pointerFrame = requestAnimationFrame(() => {
    const rect = hero.getBoundingClientRect();
    if (!art) return;
    art.style.setProperty('--mx', ((event.clientX - rect.left) / rect.width - .5) * 22 + 'px');
    art.style.setProperty('--my', ((event.clientY - rect.top) / rect.height - .5) * 16 + 'px');
  });
});
hero.addEventListener('pointerleave', () => {
  cancelAnimationFrame(pointerFrame);
  if (!art) return;
  art.style.setProperty('--mx','0px');art.style.setProperty('--my','0px');
});
reduce.addEventListener('change', setupReveals);

// Los saltos del menu. El scroll suave del navegador lo resuelve cada motor a
// su manera: en Blink cae bien tal cual, pero WebKit lo despacha de un tiron.
// Asi que aqui solo se anima en WebKit, y Chrome se queda como estaba.
// No hay nada que detectar por caracteristicas —ninguna API dice cuanto dura el
// scroll nativo—, asi que se pregunta por el motor: GestureEvent solo existe en
// WebKit, y de rebote cubre a los navegadores de iOS, que tambien lo son.
if ('GestureEvent' in window) {
  const root = document.documentElement;
  let glideFrame = 0;

  const endGlide = () => {
    cancelAnimationFrame(glideFrame);
    glideFrame = 0;
    root.style.scrollBehavior = '';
  };

  // El destino sale de scroll-padding-top y del scroll-margin-top del propio
  // destino, para no repetir en JS los margenes que ya estan en el CSS.
  function glideTo(element) {
    const padding = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const limit = root.scrollHeight - innerHeight;
    const from = scrollY;
    const to = Math.max(0, Math.min(limit, element.getBoundingClientRect().top + from - padding - margin));
    const span = Math.abs(to - from);
    if (span < 2) return;
    // Crece con la distancia, pero por la raiz: si fuera proporcional, bajar
    // hasta contacto duraria una eternidad. Sube este 11 para ir mas despacio.
    const duration = Math.min(1200, 360 + Math.sqrt(span) * 11);
    const start = performance.now();
    endGlide();
    // El scroll suave del CSS pelearia con cada paso: se apaga mientras dura.
    root.style.scrollBehavior = 'auto';
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      scrollTo(0, from + (to - from) * eased);
      if (t < 1) glideFrame = requestAnimationFrame(step);
      else endGlide();
    };
    glideFrame = requestAnimationFrame(step);
  }

  // Si el visitante toca la rueda o la pantalla, manda el: se corta el viaje.
  addEventListener('wheel', endGlide, { passive: true });
  addEventListener('touchstart', endGlide, { passive: true });

  document.addEventListener('click', event => {
    if (reduce.matches || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    // El enlace de salto se queda con el brinco seco: es una ayuda, no un paseo.
    const link = target?.closest('a[href^="#"]:not(.skip)');
    if (!link || link.hash.length < 2) return;
    const destination = document.getElementById(link.hash.slice(1));
    if (!destination) return;
    event.preventDefault();
    // El foco viaja ya, sin arrastrar la vista: quien navega con teclado sigue
    // donde debe aunque la animacion siga a medias.
    destination.setAttribute('tabindex', '-1');
    destination.focus({ preventScroll: true });
    history.pushState(null, '', link.hash);
    glideTo(destination);
  });
}
