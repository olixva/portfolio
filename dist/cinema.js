(() => {
  const root = document.querySelector('.work-scenes');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const titles = ['Sistemas<br>multiagente','RAG y búsqueda<br>semántica','Backend<br>y cloud'];
  const descriptions = ['Diseño agentes que usan herramientas, comparten contexto y coordinan tareas.','Conecto modelos con información relevante para buscar y responder con contexto.','Construyo APIs y preparo el despliegue, la evaluación y la observabilidad.'];
  const tech = ['LangGraph / Google ADK / MCP','Embeddings / pgvector / FAISS','Python / FastAPI / GCP'];
  const buttons = [...root.querySelectorAll('[data-scene]')];
  const images = [...root.querySelectorAll('.scene-image')];
  const pause = root.querySelector('.scene-pause');
  const copy = root.querySelector('.scene-copy');
  let selected = 0, stopped = reduced.matches, visible = false, hovered = false, timer;
  function sync() {
    clearInterval(timer);
    root.classList.toggle('paused',stopped || reduced.matches || !visible);
    pause.textContent = reduced.matches ? 'Movimiento reducido activado' : stopped ? 'Activar animación' : 'Pausar animación';
    pause.disabled = reduced.matches;
    pause.setAttribute('aria-pressed',String(stopped || reduced.matches));
    if (!stopped && !reduced.matches && visible && !hovered && !document.hidden) timer=setInterval(()=>select((selected+1)%3),6500);
  }
  function select(index) {
    selected=index;root.dataset.active=String(index);
    images.forEach((image,i)=>image.classList.toggle('active',i===index));
    buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
    document.getElementById('scene-title').innerHTML=titles[index];
    document.getElementById('scene-description').textContent=descriptions[index];
    document.getElementById('scene-tech').textContent=tech[index];
    copy.classList.remove('changing');void copy.offsetWidth;copy.classList.add('changing');
  }
  buttons.forEach((button,i)=>button.addEventListener('click',()=>{select(i);stopped=true;sync();}));
  pause.addEventListener('click',()=>{if(reduced.matches)return;stopped=!stopped;sync();});
  root.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'){hovered=true;sync();}});
  root.addEventListener('pointerleave',()=>{hovered=false;sync();});
  root.addEventListener('focusin',()=>clearInterval(timer));
  root.addEventListener('focusout',()=>setTimeout(()=>{if(!root.contains(document.activeElement))sync();},0));
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();},{threshold:.15}).observe(root);
  else {visible=true;sync();}
  document.addEventListener('visibilitychange',sync);
  reduced.addEventListener('change',()=>{stopped=reduced.matches;sync();});
  const hero=document.querySelector('.hero');let frame;
  function scrollScene(){frame=null;if(reduced.matches)return;const rect=hero.getBoundingClientRect();if(rect.bottom<0)return;const t=Math.max(0,Math.min(1,-rect.top/rect.height));hero.style.setProperty('--hero-travel',t*70+'px');hero.style.setProperty('--hero-scale',String(1+t*.12));hero.style.setProperty('--copy-travel',-t*45+'px');hero.style.setProperty('--copy-opacity',String(1-t*.5));}
  addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(scrollScene);},{passive:true});
  scrollScene();sync();
})();
