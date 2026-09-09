(() => {
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
