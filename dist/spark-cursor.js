(() => {
  const contact = document.querySelector('.contact');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        contact.classList.add('contact-entered');
        observer.disconnect();
      }
    }, {threshold: .15});
    observer.observe(contact);
  }

  // Cursor propio: anillo con retardo + punto en la posición exacta.
  // El anillo es quien comunica el estado (reposo / pulsable), porque al
  // ocultar el cursor del sistema hay que devolver esa señal de alguna forma.
  const fine = matchMedia('(pointer:fine)');
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const canvas = document.createElement('canvas');
  canvas.id = 'spark-cursor';
  canvas.setAttribute('aria-hidden','true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  document.body.append(canvas);

  const PAPER = '#f1f2e9', ACID = '#dcff54', DARK = '#111210';
  let x = 0, y = 0, ringX = 0, ringY = 0, ringR = 15;
  let frame = 0, last = 0, active = false, hover = false, onAcid = false;
  let particles = [];
  const enabled = () => fine.matches && !reduced.matches && !document.hidden;

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function stop() {
    active = false;
    cancelAnimationFrame(frame);
    frame = 0;
    particles = [];
    document.documentElement.classList.remove('spark-active');
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  function draw(now) {
    if (!active || !enabled()) { stop(); return; }
    const dt = Math.min((now - last) / 1000 || .016, .04); last = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    // Sobre el bloque de contacto el fondo es ácido: se invierte el color.
    const ink = onAcid ? DARK : PAPER;
    const accent = onAcid ? DARK : ACID;

    // El anillo persigue al puntero con retardo; el punto no.
    const ease = 1 - Math.pow(.0016, dt);
    ringX += (x - ringX) * ease;
    ringY += (y - ringY) * ease;
    ringR += ((hover ? 27 : 15) - ringR) * ease;

    ctx.strokeStyle = hover ? accent : ink;
    ctx.globalAlpha = hover ? .95 : .42;
    ctx.lineWidth = hover ? 1.6 : 1.1;
    ctx.beginPath();
    ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = hover ? accent : ink;
    ctx.globalAlpha = hover ? .3 : .95;
    ctx.beginPath();
    ctx.arc(x, y, hover ? 2 : 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = accent;
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy *= .96;
      ctx.globalAlpha = Math.max(0, p.life / .42) * .5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    frame = requestAnimationFrame(draw);
  }

  addEventListener('pointermove', event => {
    if (!enabled() || event.pointerType === 'touch') { stop(); return; }
    const moved = Math.hypot(event.clientX - x, event.clientY - y);
    // Las chispas solo salen con el gesto rápido, no al arrastrar despacio.
    if (active && moved > 12 && particles.length < 20) {
      particles.push({
        x, y, vx: (Math.random() - .5) * 60, vy: (Math.random() - .5) * 60,
        size: .8 + Math.random() * 1.2, life: .42
      });
    }
    x = event.clientX; y = event.clientY;
    const target = event.target instanceof Element ? event.target : null;
    hover = !!target?.closest('a,button,summary,[role="button"]');
    onAcid = !!target?.closest('.contact');
    if (!active) {
      active = true; last = performance.now();
      ringX = x; ringY = y;
      document.documentElement.classList.add('spark-active');
      frame = requestAnimationFrame(draw);
    }
  }, {passive: true});

  document.documentElement.addEventListener('pointerleave', stop);
  addEventListener('blur', stop);
  addEventListener('keydown', event => { if (event.key === 'Tab' || event.key === 'Escape') stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  fine.addEventListener('change', stop);
  reduced.addEventListener('change', stop);
  addEventListener('resize', resize);
  resize();
})();
