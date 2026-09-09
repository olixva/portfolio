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
  const fine = matchMedia('(pointer:fine)');
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const canvas = document.createElement('canvas');
  canvas.id = 'spark-cursor';
  canvas.setAttribute('aria-hidden','true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  document.body.append(canvas);
  let x = 0, y = 0, frame = 0, last = 0, active = false, hover = false;
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
    ctx.clearRect(0,0,innerWidth,innerHeight);
  }
  function glint(px,py,size,alpha) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(px-size,py);ctx.lineTo(px+size,py);
    ctx.moveTo(px,py-size);ctx.lineTo(px,py+size);
    ctx.stroke();
  }
  function draw(now) {
    if (!active || !enabled()) {stop();return;}
    const dt = Math.min((now-last)/1000 || .016,.04); last=now;
    ctx.clearRect(0,0,innerWidth,innerHeight);
    ctx.strokeStyle = '#f1ffcf';ctx.lineWidth=1.2;
    glint(x,y,hover?5:3,1);
    for(let i=0;i<4;i++) {
      const phase=now*.0015+i*Math.PI/2;
      const radius=(hover?14:9)+Math.sin(now*.002+i)*3;
      glint(x+Math.cos(phase)*radius,y+Math.sin(phase)*radius,1.2+Math.sin(phase)*.5,.45);
    }
    particles = particles.filter(p=>p.life>0);
    for(const p of particles) {
      p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
      glint(p.x,p.y,p.size,Math.max(0,p.life/.38)*.65);
    }
    frame=requestAnimationFrame(draw);
  }
  addEventListener('pointermove', event => {
    if (!enabled() || event.pointerType === 'touch') {stop();return;}
    if(active && Math.hypot(event.clientX-x,event.clientY-y)>2 && particles.length<28) {
      particles.push({x,y,vx:(Math.random()-.5)*22,vy:(Math.random()-.5)*22,size:1+Math.random(),life:.38});
    }
    x=event.clientX;y=event.clientY;
    hover=!!event.target.closest('a,button,summary,input,textarea,select');
    if(!active) {
      active=true;last=performance.now();
      document.documentElement.classList.add('spark-active');
      frame=requestAnimationFrame(draw);
    }
  },{passive:true});
  document.documentElement.addEventListener('pointerleave',stop);
  addEventListener('blur',stop);
  addEventListener('keydown',event=>{if(event.key==='Tab'||event.key==='Escape')stop();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  fine.addEventListener('change',stop);reduced.addEventListener('change',stop);
  addEventListener('resize',resize);resize();
})();
