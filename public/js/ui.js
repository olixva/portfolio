(() => {
  // Añade una envoltura animable solo a los desplegables de Otros hackathons.
  // Cada tarjeta conserva su propia altura: abrir una no modifica las demás.
  document.querySelectorAll('.other-hackathons details').forEach(details => {
    const inner = document.createElement('div');
    inner.className = 'details-inner';
    const content = document.createElement('div');
    content.className = 'details-content';
    while (details.children.length > 1) inner.append(details.children[1]);
    content.append(inner);
    details.append(content);

    details.querySelector('summary').addEventListener('click', event => {
      event.preventDefault();
      if (!details.open) {
        details.open = true;
        requestAnimationFrame(() => details.classList.add('is-expanded'));
        return;
      }
      details.classList.remove('is-expanded');
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        details.open = false;
        return;
      }
      const finishClose = event => {
        if (event.target !== content || event.propertyName !== 'grid-template-rows') return;
        content.removeEventListener('transitionend', finishClose);
        if (!details.classList.contains('is-expanded')) details.open = false;
      };
      content.addEventListener('transitionend', finishClose);
    });
  });

  const track=document.querySelector('.skills-track');
  const group=track.firstElementChild;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let animation;
  function measure(){
    const phase=animation&&animation.effect.getComputedTiming().progress||0;
    if(animation)animation.cancel();
    if(reduced.matches)return;
    const distance=group.getBoundingClientRect().width;
    if(!distance)return;
    const duration=distance/32*1000;
    animation=track.animate([{transform:'translate3d(0,0,0)'},{transform:'translate3d(-'+distance+'px,0,0)'}],{duration,iterations:Infinity,easing:'linear'});
    animation.currentTime=phase*duration;
    if(document.hidden)animation.pause();
  }
  document.fonts.ready.then(measure);
  if('ResizeObserver' in window)new ResizeObserver(measure).observe(group);
  else addEventListener('resize',measure);
  reduced.addEventListener('change',measure);
  document.addEventListener('visibilitychange',()=>{if(animation)document.hidden?animation.pause():animation.play();});
  document.querySelectorAll('.mobile-nav a').forEach(a=>a.addEventListener('click',()=>{a.closest('details').open=false;}));
  addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=document.querySelector('.mobile-nav');if(menu.open){menu.open=false;menu.querySelector('summary').focus();}}});
})();
