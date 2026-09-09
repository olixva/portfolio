// Cursor "luz": un foco que hace de puntero y un punto ácido en la posición
// exacta. Sustituye al cursor del sistema, así que el estado de "pulsable" lo
// tiene que contar el propio cursor: sobre un enlace el foco se abre y el punto
// se envuelve en un disco.
(() => {
  const fine = matchMedia('(pointer:fine)');
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const canvas = document.createElement('canvas');
  canvas.id = 'spark-cursor';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  document.body.append(canvas);

  const ACID = '220,255,84', DARK = '17,18,16';
  let x = 0, y = 0, lx = 0, ly = 0, glow = 0;
  let frame = 0, last = 0, active = false, hover = false, onAcid = false, onLight = false;

  // El hero lee esto para iluminar el asset desde la misma posición.
  const pointer = window.aoPointer = {x: 0, y: 0, hover: false, active: false};

  const enabled = () => fine.matches && !reduced.matches && !document.hidden;

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function stop() {
    active = false;
    pointer.active = false;
    cancelAnimationFrame(frame);
    frame = 0;
    document.documentElement.classList.remove('spark-active');
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  function draw(now) {
    if (!active || !enabled()) { stop(); return; }
    const dt = Math.min((now - last) / 1000 || .016, .04); last = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    // El foco persigue al puntero con un retardo mínimo; el punto, no.
    const ease = 1 - Math.pow(.00002, dt);
    lx += (x - lx) * ease;
    ly += (y - ly) * ease;
    glow += ((hover ? 1 : 0) - glow) * (1 - Math.pow(.004, dt));

    // El halo cubre mucha superficie y se guía por la sección; el punto y el
    // disco se guían por lo que pisan, para no perderse sobre el botón ácido.
    const tint = onAcid ? DARK : ACID;
    const inkTint = onLight ? DARK : ACID;
    const radius = 124 + glow * 46;
    const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius);
    halo.addColorStop(0, 'rgba(' + tint + ',' + (.11 + glow * .07).toFixed(3) + ')');
    halo.addColorStop(1, 'rgba(' + tint + ',0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(lx, ly, radius, 0, Math.PI * 2);
    ctx.fill();

    // Disco de estado: solo existe sobre lo pulsable.
    if (glow > .01) {
      ctx.globalAlpha = glow * .2;
      ctx.fillStyle = 'rgb(' + inkTint + ')';
      ctx.beginPath();
      ctx.arc(x, y, 10 + glow * 12, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgb(' + inkTint + ')';
    ctx.beginPath();
    ctx.arc(x, y, 4 + glow * 2, 0, Math.PI * 2);
    ctx.fill();

    frame = requestAnimationFrame(draw);
  }

  addEventListener('pointermove', event => {
    if (!enabled() || event.pointerType === 'touch') { stop(); return; }
    x = event.clientX; y = event.clientY;
    const target = event.target instanceof Element ? event.target : null;
    hover = !!target?.closest('a,button,summary,[role="button"]');
    onAcid = !!target?.closest('.contact');
    onLight = onAcid || !!target?.closest('.pill,.case-badge,.skip');
    pointer.x = x; pointer.y = y; pointer.hover = hover;
    if (!active) {
      active = true; pointer.active = true; last = performance.now();
      lx = x; ly = y;
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
