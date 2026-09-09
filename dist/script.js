document.getElementById('year').textContent = new Date().getFullYear();
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(pointer:fine)');
const progress = document.querySelector('.reading-progress');
const hero = document.querySelector('.hero');
const art = document.querySelector('.hero-visual img, .hero-visual .ao-mark');
const motionCases = [];
let scrollFrame = 0;
function updateProgress() {
  const total = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = 'scaleX(' + (total > 0 ? Math.min(1, scrollY / total) : 0) + ')';
  if (!reduce.matches) {
    const mobile = innerWidth <= 760;
    const heroRect = hero.getBoundingClientRect();
    if (art && heroRect.bottom > 0) art.style.setProperty('--scroll-art', Math.max(-35, Math.min(35, -heroRect.top * (mobile ? .035 : .07))) + 'px');
    for (const panel of motionCases) {
      const rect = panel.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      const position = Math.max(-1, Math.min(1, (rect.top + rect.height / 2 - innerHeight / 2) / innerHeight));
      const image = panel.querySelector('img');
      image.style.setProperty('--lift', position * (mobile ? 18 : 55) + 'px');
      image.style.setProperty('--turn', position * (mobile ? 5 : 12) + 'deg');
    }
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
document.querySelectorAll('.magnetic').forEach(button => {
  button.addEventListener('pointermove', event => {
    if (reduce.matches || !finePointer.matches || innerWidth <= 760) return;
    const rect = button.getBoundingClientRect();
    button.style.transform = 'translate(' + (event.clientX-rect.left-rect.width/2)*.12 + 'px,' + (event.clientY-rect.top-rect.height/2)*.16 + 'px)';
  });
  button.addEventListener('pointerleave', () => button.style.transform = '');
});
reduce.addEventListener('change', setupReveals);
