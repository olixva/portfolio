// Hero: la escultura AO en acero, girando hacia el puntero, deformándose al
// acercarte e iluminada por el cursor "luz" — cursor-light.js publica la
// posición del ratón en window.aoPointer y aquí se convierte en una lámpara.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ACID, LOOK, GOLD_ENV, SITE_ENV, buildEnvironment, applySteel, applyTransition, makeUniforms } from './sculpture.js?v=bcadf0bc';

import { createAtmosphere } from './atmosphere.js?v=11c3a1bd';
import { prepareIntro } from './intro.js?v=2c56723e';

const MODEL = 'assets/ao-sculpture.glb?v=e9ab29ff';
// La subida dura lo mismo en móvil y escritorio. De aquí cuelga toda la
// secuencia posterior.
const INTRO_RISE = 1.1;

const root = document.documentElement;
const hero = document.querySelector('.hero');
const gsap = window.gsap;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(pointer:fine)');
const isMobile = () => innerWidth <= 760;
const wantsIntro = root.classList.contains('ao3d-intro');

const releaseContent = () => root.classList.remove('ao3d-intro');

// --- Escena -------------------------------------------------------------

function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  // Fondo transparente para integrar la escena en el hero.
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer, GOLD_ENV(LOOK));

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0, 3.6);

  scene.add(new THREE.AmbientLight(0xffffff, LOOK.ambient));
  const key = new THREE.DirectionalLight(0xffffff, LOOK.keyLight);
  key.position.set(-3, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(ACID, LOOK.rimLight);
  rim.position.set(4, -1.2, -2);
  scene.add(rim);

  // La lámpara del cursor: es lo que hace que mover el ratón mueva los
  // reflejos por el metal, en vez de limitarse a girar la pieza.
  const lamp = new THREE.PointLight(ACID, 0, 9, 2);
  lamp.position.set(0, 0, 1.4);
  scene.add(lamp);

  const uniforms = makeUniforms(LOOK);
  uniforms.uEnvironmentMix = { value: wantsIntro ? 0 : 1 };
  uniforms.uSiteEnvironment = { value: buildEnvironment(renderer, SITE_ENV(LOOK)) };

  const stage = new THREE.Group();   // pose: intro → reposo
  const tilt = new THREE.Group();    // giro hacia el puntero
  stage.add(tilt);
  scene.add(stage);

  // Buffers HDR estándar para el postprocesado.
  const composer = new EffectComposer(renderer);
  // El antialias del canvas no alcanza los buffers del composer.
  // MSAA suaviza la silueta y los filamentos sin difuminar los reflejos.
  const samples = Math.min(renderer.capabilities.maxSamples, isMobile() ? 2 : 4);
  composer.renderTarget1.samples = samples;
  composer.renderTarget2.samples = samples;
  composer.addPass(new RenderPass(scene, camera));
  // Conserva el alfa transparente fuera del modelo. El bloom añadía una capa
  // tenue sobre todo el lienzo y oscurecía un nivel RGB el fondo al aparecer.
  composer.addPass(new OutputPass());

  // Mezcla imágenes completas después de OutputPass, en el mismo espacio sRGB
  // que el vídeo del navegador. Proyectarlo sobre la malla recortaba sus
  // reflejos y volvía transparentes las zonas oscuras del metal.
  const handoff = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, frame: { value: null }, mixAmount: { value: 1 },
      fit: { value: new THREE.Vector2(1, 1) }, offset: { value: new THREE.Vector2() },
      background: { value: new THREE.Vector3(17 / 255, 18 / 255, 16 / 255) }
    },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse, frame;
      uniform float mixAmount;
      uniform vec2 fit, offset;
      uniform vec3 background;
      varying vec2 vUv;
      void main() {
        vec4 rendered = texture2D(tDiffuse, vUv);
        vec3 metal = rendered.rgb + background * (1.0 - rendered.a);
        vec2 uv = (vUv - 0.5) * fit + 0.5 + offset;
        vec3 video = background;
        if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))))
          video = max(background, texture2D(frame, uv).rgb);
        gl_FragColor = vec4(mix(metal, video, mixAmount), 1.0);
      }`
  });
  handoff.enabled = false;
  composer.addPass(handoff);

  const atmosphere = createAtmosphere({
    scene, mobile: isMobile(), reduceMotion: reduceMotion.matches
  });
  // Sin intro la pieza ya esta en su sitio, asi que las particulas entran con ella.
  atmosphere.intensity.value = wantsIntro ? 0 : 1;

  return { renderer, scene, camera, composer, stage, tilt, lamp, rim, uniforms, handoff, atmosphere };
}

// La escala se deduce del ancho visible, no de un numero fijo: en movil el
// lienzo es muy estrecho (relacion ~0.5) y con escala fija la pieza se sale.
const PIECE_WIDTH = 2.05;

function restPose(camera, height) {
  const distance = 3.6;
  const halfHeight = Math.tan((camera.fov * Math.PI / 180) / 2) * distance;
  const halfWidth = halfHeight * camera.aspect;
  const share = isMobile() ? 0.595 : 0.40;   // deja margen para los giros laterales
  const width = isMobile() ? innerWidth * share : Math.min(innerWidth * share, 720);
  const scale = Math.min(0.95, (halfWidth * 2 * width / innerWidth) / PIECE_WIDTH) * (isMobile() ? 1 : 1.2);
  // En móvil el lienzo cubre todo el recorrido, pero la pose final queda
  // centrada en la banda reservada encima del titular.
  const band = parseFloat(getComputedStyle(hero).paddingTop) - 12;
  const y = isMobile() ? halfHeight * (1 - band / height) : 0;
  return { x: isMobile() ? 0 : halfWidth * (Math.min(innerWidth * 0.88, 1400) / innerWidth) * 0.48, y, scale, z: distance };
}

// --- Arranque -----------------------------------------------------------

function start() {
  const intro = prepareIntro(wantsIntro && !!gsap);
  const canvas = document.createElement('canvas');
  canvas.className = 'ao3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  if (wantsIntro && gsap) canvas.style.opacity = '0';
  hero.insertBefore(canvas, hero.firstChild);

  let ctx;
  try {
    ctx = createScene(canvas);
  } catch (error) {
    intro?.dispose();
    canvas.remove();
    root.classList.remove('ao3d-pending');
    console.warn('Hero 3D no disponible, se usa el fallback CSS:', error);
    releaseContent();
    return;
  }

  let introFrame = null;
  // El reloj de la pista es el vídeo, no la carga: hasta que no pinta el primer
  // fotograma no hay nada con lo que sincronizar.
  const { renderer, scene, camera, composer, stage, tilt, lamp, rim, uniforms, handoff, atmosphere } = ctx;
  let framePose = null;
  let readyForHandoff = false;
  intro?.ended.then(() => { if (!readyForHandoff && introRunning) intro.waiting(); });
  let model = null;
  let introRunning = !!intro, introTimeline = null, transitioning = false, visible = true, frame = 0;
  let scrollTilt = 0, targetAmp = 0;
  const aim = { x: 0, y: 0 };
  const interaction = { value: intro ? 0 : 1 };
  let interactionTween = null;
  let settledAt = 0;
  const drag = { on: false, x: 0, y: 0, yaw: 0, pitch: 0, id: null };
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const local = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const ndc = new THREE.Vector2();

  function applyRest() {
    const pose = restPose(camera, rect.height);
    stage.position.set(pose.x, pose.y, 0);
    stage.scale.setScalar(pose.scale);
    camera.position.z = pose.z;
  }

  // La geometria del lienzo se cachea: leerla en cada fotograma fuerza un
  // recalculo de estilo y provoca tirones.
  let rect = canvas.getBoundingClientRect();
  let lastW = 0, lastH = 0, lastDpr = 0;

  function measure() { rect = canvas.getBoundingClientRect(); }

  function resize() {
    measure();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(devicePixelRatio, 2);
    if (width === lastW && height === lastH && dpr === lastDpr) return;
    lastW = width; lastH = height; lastDpr = dpr;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    atmosphere.setSize(camera, dpr);
    if (!introRunning) applyRest();
    else if (intro && !transitioning) matchVideoPose();
  }

  // Traduce el puntero a un punto del mundo sobre el plano de la pieza: es lo
  // que alimenta a la vez la lámpara y el centro de la deformación.
  function trackPointer() {
    const ao = window.aoPointer;
    if (!LOOK.lamp && !LOOK.deform && !LOOK.follow) return;
    if (!ao || !ao.active) {
      targetAmp = 0;
      lamp.intensity += (0 - lamp.intensity) * 0.08;
      return;
    }
    ndc.set(((ao.x - rect.left) / rect.width) * 2 - 1, -((ao.y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;

    lamp.position.set(hit.x, hit.y, 1.25);
    // La lampara sigue al puntero por todo el hero: la caida la da su propio
    // alcance, no un recorte por distancia, para que el reflejo tenga recorrido.
    lamp.intensity += (LOOK.lamp * interaction.value - lamp.intensity) * 0.12;
    const reach = hit.distanceTo(stage.position);
    targetAmp = Math.max(0, 1 - reach / 1.9) * LOOK.deform;

    if (model && LOOK.deform) {
      inverse.copy(model.matrixWorld).invert();
      uniforms.uTouch.value.lerp(local.copy(hit).applyMatrix4(inverse), 0.2);
    }
    aim.x = ndc.x;
    aim.y = ndc.y;
  }

  const spinRate = { x: 0, y: 0 };

  function tick() {
    frame = 0;
    spinRate.x = spinRate.y = 0;
    const delta = Math.min(clock.getDelta(), 0.05);
    const time = Math.max(0, clock.elapsedTime - settledAt);
    uniforms.uTime.value = clock.elapsedTime;
    if (!introRunning) trackPointer();
    uniforms.uAmp.value += (targetAmp - uniforms.uAmp.value) * Math.min(1, delta * 3.2);

    if (!introRunning) {
      // Escritorio: la pieza sigue al raton con puntero fino, tiene micro-
      // oscilaciones sutiles y al soltar el drag vuelve a la pose neutra.
      // Movil: la pieza gira sola con una oscilacion amplia y lenta, y el
      // dedo la desplaza; el offset de drag persiste al soltar. Con
      // movimiento reducido este bucle no corre, asi que no hace falta
      // guard adicional.
      const back = 1 - Math.pow(0.12, delta);
      let targetY, targetX;
      if (isMobile()) {
        // Mantiene una vuelta continua: la pieza no rebota entre dos extremos.
        const autoY = time * 0.18;
        targetY = autoY * interaction.value + drag.yaw;
        targetX = scrollTilt * interaction.value + drag.pitch;
      } else {
        if (!drag.on) {
          drag.yaw -= drag.yaw * back;
          drag.pitch -= drag.pitch * back;
        }
        const follow = drag.on ? 0 : (finePointer.matches && !isMobile() ? LOOK.follow : 0);
        const baseY = aim.x * 0.55 * follow + Math.sin(time * 0.3) * 0.1;
        const baseX = -aim.y * 0.3 * follow + Math.sin(time * 0.24) * 0.06 + scrollTilt;
        targetY = baseY * interaction.value + drag.yaw;
        targetX = baseX * interaction.value + drag.pitch;
      }
      const ease = Math.min(1, delta * (drag.on ? 14 : 2.4));
      const before = tilt.rotation.y;
      const beforeX = tilt.rotation.x;
      tilt.rotation.y += (targetY - tilt.rotation.y) * ease;
      tilt.rotation.x += (targetX - tilt.rotation.x) * ease;
      spinRate.y = (tilt.rotation.y - before) / Math.max(delta, 0.001);
      spinRate.x = (tilt.rotation.x - beforeX) / Math.max(delta, 0.001);
    }

    atmosphere.update(delta, clock.elapsedTime, spinRate, stage.position, stage.scale.x);
    composer.render();
    if (visible) frame = requestAnimationFrame(tick);
  }

  const play = () => { if (visible && !frame) { clock.getDelta(); frame = requestAnimationFrame(tick); } };
  const pause = () => { cancelAnimationFrame(frame); frame = 0; };

  function matchVideoPose() {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 3.6;
    const videoRect = intro.video.getBoundingClientRect();
    const videoScale = Math.min(videoRect.width / 1248, videoRect.height / 704);
    const centerX = videoRect.left + videoRect.width / 2 - rect.left - rect.width / 2;
    const centerY = videoRect.top + videoRect.height / 2 - rect.top - rect.height / 2;
    stage.scale.setScalar(2 * halfHeight * (1188 * videoScale / rect.height) / PIECE_WIDTH);
    stage.position.set((centerX - 6 * videoScale) / rect.height * 2 * halfHeight,
      (-centerY + 12 * videoScale) / rect.height * 2 * halfHeight, 0);
    tilt.rotation.set(0, 0, 0.035);
    camera.position.z = 3.6;
    framePose = {
      scale: stage.scale.x, x: stage.position.x, y: stage.position.y,
      width: 1248 * videoScale, height: 704 * videoScale, centerX, centerY
    };
    updateIntroFrame();
  }

  function updateIntroFrame() {
    if (!framePose) return;
    const ratio = stage.scale.x / framePose.scale;
    const pixelsPerUnit = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 3.6);
    const centerX = framePose.centerX * ratio + (stage.position.x - framePose.x * ratio) * pixelsPerUnit;
    const centerY = framePose.centerY * ratio - (stage.position.y - framePose.y * ratio) * pixelsPerUnit;
    const width = framePose.width * ratio, height = framePose.height * ratio;
    handoff.uniforms.fit.value.set(rect.width / width, rect.height / height);
    handoff.uniforms.offset.value.set(-centerX / width, centerY / height);
  }

  function finishIntro() {
    clearTimeout(modelTimeout);
    introTimeline?.kill();
    handoff.enabled = false;
    handoff.uniforms.frame.value = null;
    introFrame?.dispose();
    introFrame = null;
    canvas.style.opacity = model ? '1' : '0';
    if (!model) root.classList.remove('ao3d-pending');
    intro?.dispose();
    introRunning = false;
    atmosphere.emission.value = 1;
    settledAt = clock.elapsedTime;
    interactionTween?.kill();
    if (gsap) {
      interactionTween = gsap.to(interaction, { value: 1, duration: 0.65, ease: 'power2.inOut' });
      gsap.to(atmosphere.intensity, { value: 1, duration: 0.9, ease: 'power2.out', overwrite: true });
    } else {
      interaction.value = 1;
      atmosphere.intensity.value = 1;
    }
    tilt.rotation.z = 0;
    uniforms.uEnvironmentMix.value = 1;
    uniforms.uBaseMix.value = 0.18;
    uniforms.uRim.value = LOOK.rim;
    rim.intensity = LOOK.rimLight;
    applyRest();
    // Sin traslado del canvas ni realocación de buffers al terminar.
    composer.render();
    root.classList.remove('ao3d-revealing');
    releaseContent();
  }

  document.querySelector('.header')?.addEventListener('click', event => {
    if (introRunning && event.target.closest('a')) finishIntro();
  });
  document.querySelector('.skip')?.addEventListener('click', () => { if (introRunning) finishIntro(); });

  async function runIntro() {
    if (!intro) { applyRest(); releaseContent(); return; }
    // Se compilan materiales y postprocesado detrás del vídeo antes del relevo.
    handoff.uniforms.mixAmount.value = 1;
    uniforms.uBaseMix.value = 0.25;
    uniforms.uRim.value = 0;
    rim.intensity = 0;
    resize();
    matchVideoPose();
    await renderer.compileAsync(scene, camera);
    clearTimeout(modelTimeout);
    if (!introRunning) return;
    // Prepara también el último pase durante el vídeo: compilarlo en ended
    // consumía parte del primer fotograma del relevo.
    handoff.enabled = true;
    composer.render();
    handoff.enabled = false;
    readyForHandoff = true;
    await intro.ended;
    await document.fonts.ready;
    if (!introRunning) return;
    clearTimeout(modelTimeout);
    intro.hideLoader();
    // Congela el fotograma realmente presentado: VideoTexture puede conservar
    // el anterior si el último callback de decodificación llega tras ended.
    if (!intro.video.videoWidth || intro.video.readyState < 2) { finishIntro(); return; }
    const lastFrame = document.createElement('canvas');
    lastFrame.width = intro.video.videoWidth;
    lastFrame.height = intro.video.videoHeight;
    lastFrame.getContext('2d').drawImage(intro.video, 0, 0);
    introFrame = new THREE.CanvasTexture(lastFrame);
    introFrame.generateMipmaps = false;
    introFrame.minFilter = THREE.LinearFilter;
    handoff.uniforms.frame.value = introFrame;
    matchVideoPose();
    handoff.enabled = true;
    composer.render();
    canvas.style.opacity = '1';
    intro.video.style.opacity = '1';
    transitioning = true;
    root.classList.add('ao3d-revealing');
    const pose = restPose(camera, rect.height);
    // Una sola trayectoria controla el fotograma y la pieza. El metal conserva
    // su cuerpo mientras sube; el relevo sucede al desacelerar, ya junto al título.
    const duration = INTRO_RISE;
    // Transfiere el vídeo al compositor antes de mover la imagen. Después,
    // el fundido descubre el metal sin girarlo hasta terminar el relevo.
    const transfer = 0.16;
    const goldStart = transfer + duration + 0.28;
    const greenStart = goldStart + 0.7;
    introTimeline = gsap.timeline({ defaults: { ease: 'power2.inOut' }, onUpdate: updateIntroFrame, onComplete: finishIntro });
    introTimeline.to(intro.overlay, { opacity: 0, duration: transfer, ease: 'sine.inOut' }, 0);
    introTimeline
      .to(stage.position, { x: pose.x, y: pose.y, duration }, transfer)
      .to(stage.scale, { x: pose.scale, y: pose.scale, z: pose.scale, duration }, transfer)
      .to(tilt.rotation, { z: 0, duration: 0.65 }, goldStart)
      .to(handoff.uniforms.mixAmount, { value: 0, duration: 0.95, ease: 'sine.inOut' }, goldStart - 0.95)
      // Primero se descubre el metal dorado real. Un giro breve muestra volumen
      // antes de que cambie la iluminación; la atmósfera entra después.
      .to(tilt.rotation, { y: 0.045, x: -0.012, duration: 0.65 }, goldStart)
      .add(() => atmosphere.prepareEmission(model), greenStart)
      .to(tilt.rotation, { y: 0, x: 0, duration: 1.35 }, greenStart)
      .to(uniforms.uEnvironmentMix, { value: 1, duration: 1.35, ease: 'sine.inOut' }, greenStart)
      .to(atmosphere.emission, { value: 1, duration: 1.35, ease: 'sine.inOut' }, greenStart)
      .to(uniforms.uBaseMix, { value: 0.18, duration: 1.35 }, greenStart)
      .to(uniforms.uRim, { value: LOOK.rim, duration: 0.7 }, greenStart)
      .to(rim, { intensity: LOOK.rimLight, duration: 0.6 }, greenStart + 0.75)
      .to(atmosphere.intensity, { value: 1, duration: 0.22, ease: 'sine.out' }, greenStart)
      .add(releaseContent, isMobile() ? 0.28 : 0.35);
  }

  const draco = new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/');
  const modelTimeout = setTimeout(() => {
    finishIntro();
    if (!model) { canvas.style.opacity = '0'; root.classList.remove('ao3d-pending'); }
  }, 45000);
  new GLTFLoader().setDRACOLoader(draco).load(MODEL, gltf => {
    if (!intro) clearTimeout(modelTimeout);
    model = gltf.scene;
    model.traverse(node => { if (node.isMesh) {
      node.material.roughnessMap = null;
      for (const texture of [node.material.map, node.material.normalMap]) {
        if (texture) texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
      applySteel(node.material, uniforms, LOOK);
      node.geometry.computeBoundingBox();
      applyTransition(node.material, node.geometry.boundingBox);
    } });

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.scale.setScalar(2.05 / size.x);
    tilt.add(model);
    draco.dispose();

    resize();
    root.classList.add('ao3d-on');
    root.classList.remove('ao3d-pending');

    if (reduceMotion.matches) {
      tilt.rotation.set(-0.05, -0.3, 0);
      applyRest();
      atmosphere.intensity.value = 1;
      atmosphere.update(0, 0, 0);
      composer.render();
      releaseContent();
      addEventListener('resize', () => { resize(); atmosphere.update(0, 0, 0); composer.render(); });
      return;
    }

    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting && !document.hidden;
      visible ? play() : pause();
    }, { threshold: 0 });
    observer.observe(hero);
    document.addEventListener('visibilitychange', () => {
      visible = !document.hidden && hero.getBoundingClientRect().bottom > 0;
      visible ? play() : pause();
      if (document.hidden && transitioning) finishIntro();
    });
    addEventListener('resize', () => {
      if (transitioning && introRunning) finishIntro();
      resize();
    });

    function airPointer(event, active = true) {
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc.set(x, y), camera);
      if (raycaster.ray.intersectPlane(plane, hit)) atmosphere.setPointer(hit.x, hit.y, active);
    }
    let press = null;
    hero.addEventListener('pointerleave', () => atmosphere.setPointer(0, 0, false));
    // Arrastrar para girar la pieza a mano. Los oyentes van en el hero, no en
    // el lienzo: el lienzo esta debajo de .hero-content, asi que escuchando ahi
    // solo se podia agarrar por los bordes que el texto dejaba libres.
    hero.addEventListener('pointerdown', event => {
      if (event.button !== 0 || introRunning) return;
      // Lo pulsable manda: no se secuestra el clic de un enlace ni una seleccion.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('a,button,summary,input,textarea,[role="button"]')) return;
      event.preventDefault();   // si no, arrastrar sobre el titular lo selecciona
      drag.on = true; drag.id = event.pointerId;
      if (isMobile()) drag.yaw = tilt.rotation.y - (clock.elapsedTime - settledAt) * 0.18;
      press = { x: event.clientX, y: event.clientY, time: performance.now(), moved: false };
      airPointer(event);
      drag.x = event.clientX; drag.y = event.clientY;
      hero.setPointerCapture(event.pointerId);
      root.classList.add('ao3d-dragging');
    });
    hero.addEventListener('pointermove', event => {
      if (!introRunning && (event.pointerType !== 'touch' || drag.on)) airPointer(event);
      if (!drag.on || event.pointerId !== drag.id) return;
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 7) press.moved = true;
      const dragScale = isMobile() ? 0.009 : 0.007;
      drag.yaw += (event.clientX - drag.x) * dragScale;
      drag.pitch += (event.clientY - drag.y) * dragScale;
      drag.pitch = Math.max(isMobile() ? -1.05 : -0.9, Math.min(isMobile() ? 1.05 : 0.9, drag.pitch));
      drag.x = event.clientX; drag.y = event.clientY;
      play();
    });
    const endDrag = event => {
      if (!drag.on || (event && event.pointerId !== drag.id)) return;
      if (event?.type === 'pointerup' && press && !press.moved && performance.now() - press.time < 450) {
        airPointer(event);
        atmosphere.burst(hit.x, hit.y);
      }
      press = null;
      if (!event || event.pointerType === 'touch' || event.type === 'pointercancel') atmosphere.setPointer(0, 0, false);
      drag.on = false; drag.id = null;
      root.classList.remove('ao3d-dragging');
    };
    hero.addEventListener('pointerup', endDrag);
    hero.addEventListener('pointercancel', endDrag);
    addEventListener('blur', endDrag);
    addEventListener('scroll', () => {
      measure();
      if (rect.bottom > 0) scrollTilt = Math.max(-0.45, Math.min(0, rect.top * 0.001));
    }, { passive: true });

    play();
    if (introRunning) runIntro().catch(error => { console.warn('Entrada 3D:', error); finishIntro(); });
    else { canvas.style.opacity = '1'; releaseContent(); }
  }, undefined, error => {
    clearTimeout(modelTimeout);
    draco.dispose();
    console.warn('No se pudo cargar la escultura, se usa el fallback CSS:', error);
    intro?.dispose();
    canvas.remove();
    root.classList.remove('ao3d-on', 'ao3d-pending');
    releaseContent();
  });
}

if (hero && document.querySelector('.hero .ao-visual')) start();
else releaseContent();
