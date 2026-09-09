// Hero: la escultura AO en acero, girando hacia el puntero, deformándose al
// acercarte e iluminada por el cursor "luz" — cursor-light.js publica la
// posición del ratón en window.aoPointer y aquí se convierte en una lámpara.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ACID, LOOK, buildEnvironment, applySteel, makeUniforms } from './sculpture.js';

const MODEL = 'assets/ao-sculpture.glb';

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
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile() ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer, LOOK);

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

  const stage = new THREE.Group();   // pose: intro → reposo
  const tilt = new THREE.Group();    // giro hacia el puntero
  stage.add(tilt);
  scene.add(stage);

  // EffectComposer crea su buffer sin multimuestreo, asi que el antialias del
  // renderizador no llega a aplicarse: hay que pedirlo en el destino.
  const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(buffer.x, buffer.y, {
    type: THREE.HalfFloatType,
    samples: 4
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), LOOK.bloomStrength, LOOK.bloomRadius, LOOK.bloomThreshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return { renderer, camera, composer, bloom, stage, tilt, lamp, uniforms };
}

// La escala se deduce del ancho visible, no de un numero fijo: en movil el
// lienzo es muy estrecho (relacion ~0.5) y con escala fija la pieza se sale.
const PIECE_WIDTH = 2.05;

function restPose(camera) {
  const distance = 3.6;
  const halfHeight = Math.tan((camera.fov * Math.PI / 180) / 2) * distance;
  const halfWidth = halfHeight * camera.aspect;
  const share = isMobile() ? 0.86 : 0.52;   // cuanto del ancho ocupa la pieza
  const scale = Math.min(0.95, (halfWidth * 2 * share) / PIECE_WIDTH);
  // En movil sube por detras del titular, para no cruzarse con el parrafo.
  const y = isMobile() ? halfHeight * 0.62 : 0;
  return { x: isMobile() ? 0 : halfWidth * 0.46, y, scale, z: distance };
}

// --- Arranque -----------------------------------------------------------

function start() {
  const canvas = document.createElement('canvas');
  canvas.className = 'ao3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  if (wantsIntro && gsap) canvas.style.opacity = '0';
  hero.insertBefore(canvas, hero.firstChild);

  let ctx;
  try {
    ctx = createScene(canvas);
  } catch (error) {
    canvas.remove();
    root.classList.remove('ao3d-pending');
    console.warn('Hero 3D no disponible, se usa el fallback CSS:', error);
    releaseContent();
    return;
  }

  const { renderer, camera, composer, bloom, stage, tilt, lamp, uniforms } = ctx;
  let model = null;
  let introRunning = false, visible = true, frame = 0;
  let scrollTilt = 0, targetAmp = 0;
  const aim = { x: 0, y: 0 };
  const drag = { on: false, x: 0, y: 0, yaw: 0, pitch: 0, id: null };
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const local = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const ndc = new THREE.Vector2();

  function applyRest() {
    const pose = restPose(camera);
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
    const dpr = Math.min(devicePixelRatio, isMobile() ? 1.5 : 2);
    if (width === lastW && height === lastH && dpr === lastDpr) return;
    lastW = width; lastH = height; lastDpr = dpr;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.enabled = !isMobile();
    if (!introRunning) applyRest();
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

    lamp.position.set(hit.x, hit.y, 1.4);
    // La lampara sigue al puntero por todo el hero: la caida la da su propio
    // alcance, no un recorte por distancia, para que el reflejo tenga recorrido.
    lamp.intensity += (LOOK.lamp - lamp.intensity) * 0.12;
    const reach = hit.distanceTo(stage.position);
    targetAmp = Math.max(0, 1 - reach / 1.9) * LOOK.deform;

    if (model && LOOK.deform) {
      inverse.copy(model.matrixWorld).invert();
      uniforms.uTouch.value.lerp(local.copy(hit).applyMatrix4(inverse), 0.2);
    }
    aim.x = ndc.x;
    aim.y = ndc.y;
  }

  function tick() {
    frame = 0;
    const delta = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    uniforms.uTime.value = time;
    trackPointer();
    uniforms.uAmp.value += (targetAmp - uniforms.uAmp.value) * Math.min(1, delta * 3.2);

    if (!introRunning) {
      // Al soltar, el giro manual vuelve a cero y la pieza retoma su deriva.
      if (!drag.on) {
        const back = 1 - Math.pow(0.12, delta);
        drag.yaw -= drag.yaw * back;
        drag.pitch -= drag.pitch * back;
      }
      // Mientras se arrastra, el seguimiento del puntero no compite.
      const follow = drag.on ? 0 : (finePointer.matches && !isMobile() ? LOOK.follow : 0);
      const targetY = aim.x * 0.55 * follow + Math.sin(time * 0.3) * 0.1 + drag.yaw;
      const targetX = -aim.y * 0.3 * follow + Math.sin(time * 0.24) * 0.06 + scrollTilt + drag.pitch;
      const ease = Math.min(1, delta * (drag.on ? 14 : 2.4));
      tilt.rotation.y += (targetY - tilt.rotation.y) * ease;
      tilt.rotation.x += (targetX - tilt.rotation.x) * ease;
    }

    composer.render();
    if (visible) frame = requestAnimationFrame(tick);
  }

  const play = () => { if (visible && !frame) { clock.getDelta(); frame = requestAnimationFrame(tick); } };
  const pause = () => { cancelAnimationFrame(frame); frame = 0; };

  function runIntro() {
    if (!wantsIntro || !gsap) { applyRest(); releaseContent(); return; }
    introRunning = true;
    const pose = restPose(camera);
    const mobile = isMobile();

    stage.position.set(0, 0, 0);
    stage.scale.setScalar(pose.scale * 1.4);
    tilt.rotation.set(0.5, -1.5, 0.2);
    camera.position.z = mobile ? 3.4 : 2.9;

    gsap.timeline({ defaults: { ease: 'power3.inOut' }, onComplete: () => { introRunning = false; } })
      .to(canvas, { opacity: 1, duration: 0.6, ease: 'power2.out' }, 0)
      .to(tilt.rotation, { y: 0, x: 0, z: 0, duration: 2.1, ease: 'power3.out' }, 0)
      .fromTo(uniforms.uRim, { value: 1.1 }, { value: 0.22, duration: 1.8, ease: 'power2.out' }, 0)
      .to(camera.position, { z: pose.z, duration: 1.5 }, mobile ? 0.9 : 1.15)
      .to(stage.position, { x: pose.x, y: pose.y, duration: 1.3 }, mobile ? 0.9 : 1.15)
      .to(stage.scale, { x: pose.scale, y: pose.scale, z: pose.scale, duration: 1.3 }, mobile ? 0.9 : 1.15)
      .add(releaseContent, mobile ? 1.1 : 1.35);
  }

  const draco = new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/');
  new GLTFLoader().setDRACOLoader(draco).load(MODEL, gltf => {
    model = gltf.scene;
    model.traverse(node => { if (node.isMesh) applySteel(node.material, uniforms, LOOK); });

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
      composer.render();
      releaseContent();
      addEventListener('resize', () => { resize(); composer.render(); });
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
      // GSAP avanza con requestAnimationFrame, que el navegador congela en
      // segundo plano: si la pestana se oculta durante la entrada, el titular
      // se quedaria esperando. Nadie esta mirando la animacion, asi que se
      // suelta el contenido y se planta la pieza en su sitio.
      if (document.hidden && introRunning) {
        gsap?.globalTimeline.getChildren().forEach(t => t.progress(1));
        introRunning = false;
        applyRest();
        releaseContent();
      }
    });
    addEventListener('resize', resize);

    // Arrastrar sobre el lienzo para girar la pieza a mano.
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || introRunning) return;
      drag.on = true; drag.id = event.pointerId;
      drag.x = event.clientX; drag.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      root.classList.add('ao3d-dragging');
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag.on || event.pointerId !== drag.id) return;
      drag.yaw += (event.clientX - drag.x) * 0.007;
      drag.pitch += (event.clientY - drag.y) * 0.007;
      drag.pitch = Math.max(-0.9, Math.min(0.9, drag.pitch));
      drag.x = event.clientX; drag.y = event.clientY;
      play();
    });
    const endDrag = event => {
      if (!drag.on || (event && event.pointerId !== drag.id)) return;
      drag.on = false; drag.id = null;
      root.classList.remove('ao3d-dragging');
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    addEventListener('blur', endDrag);
    addEventListener('scroll', () => {
      measure();
      if (rect.bottom > 0) scrollTilt = Math.max(-0.45, Math.min(0, rect.top * 0.001));
    }, { passive: true });

    play();
    runIntro();
  }, undefined, error => {
    console.warn('No se pudo cargar la escultura, se usa el fallback CSS:', error);
    canvas.remove();
    root.classList.remove('ao3d-on', 'ao3d-pending');
    releaseContent();
  });
}

if (hero && document.querySelector('.hero .ao-visual')) start();
else releaseContent();
