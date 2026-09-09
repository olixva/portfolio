// Hero 3D: logotipo "AO" en cromo con anillos orbitales reales.
// Sustituye al mock CSS de orbit.css, que se conserva como fallback.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UNITS_PER_EM, GLYPHS } from './ao-glyphs.js';

const ACID = '#dcff54';
const WARM = '#ffb06a';
const TRACKING = -40;   // unidades de fuente entre la A y la O
const DEPTH = 0.17;     // profundidad de la extrusión, en alturas de em

const root = document.documentElement;
const hero = document.querySelector('.hero');
const gsap = window.gsap;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(pointer:fine)');
const isMobile = () => innerWidth <= 760;

// El script inline de index.html decide si toca intro; aquí solo lo leemos.
const wantsIntro = root.classList.contains('ao3d-intro');

function releaseContent() {
  root.classList.remove('ao3d-intro');
}

// --- Geometría de las letras -------------------------------------------------

function buildLogo(material) {
  const scale = 1 / UNITS_PER_EM;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${GLYPHS.A.d}"/><path d="${GLYPHS.O.d}"/></svg>`;
  const parsed = new SVGLoader().parse(svg);

  const group = new THREE.Group();
  let cursor = 0;
  ['A', 'O'].forEach((letter, index) => {
    const shapes = SVGLoader.createShapes(parsed.paths[index]);
    const geometry = new THREE.ExtrudeGeometry(shapes, {
      depth: DEPTH / scale,
      curveSegments: 14,
      bevelEnabled: true,
      bevelThickness: 0.022 / scale,
      bevelSize: 0.019 / scale,
      bevelOffset: 0,
      bevelSegments: 5
    });
    // Los paths vienen con el eje Y hacia abajo: una rotación de 180° sobre X
    // los endereza sin invertir el sentido de las caras.
    geometry.rotateX(Math.PI);
    geometry.translate(cursor, 0, 0);
    cursor += GLYPHS[letter].advance + TRACKING;
    group.add(new THREE.Mesh(geometry, material));
  });

  group.scale.setScalar(scale);

  // Centrar el conjunto en su propio origen.
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.children.forEach(mesh => {
    mesh.geometry.translate(-center.x / scale, -center.y / scale, -center.z / scale);
  });
  group.userData.size = box.getSize(new THREE.Vector3());
  return group;
}

// --- Entorno de reflejos (estudio de tiras) ----------------------------------
// El cromo solo existe si hay algo que reflejar. En vez de descargar un HDRI,
// montamos un cajón oscuro con tiras emisivas y lo pasamos por PMREM.

function buildEnvironment(renderer) {
  const scene = new THREE.Scene();

  // Cúpula con horizonte marcado: es lo que convierte el metal en cromo.
  // Sin ese corte brusco entre cielo y suelo, las caras planas de las letras
  // reflejan un blanco uniforme y parecen plástico.
  const sky = document.createElement('canvas');
  sky.width = 4; sky.height = 512;
  const skyCtx = sky.getContext('2d');
  const grad = skyCtx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.00, '#ffffff');
  grad.addColorStop(0.34, '#eef2e3');
  grad.addColorStop(0.60, '#8f9683');
  grad.addColorStop(0.635, '#14160f');
  grad.addColorStop(1.00, '#000000');
  skyCtx.fillStyle = grad;
  skyCtx.fillRect(0, 0, 4, 512);
  const skyTexture = new THREE.CanvasTexture(sky);
  skyTexture.colorSpace = THREE.SRGBColorSpace;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(12, 32, 32),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide })
  );
  scene.add(dome);

  const strip = (color, intensity, w, h, position, rotation) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) })
    );
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    scene.add(mesh);
  };

  strip('#ffffff', 7, 1.1, 8, [-4.6, 2.0, 2.4], [0, Math.PI / 2.6, 0.22]);  // tira principal
  strip('#ffffff', 3, 0.6, 7, [-2.0, 3.0, 4.5], [0, Math.PI / 5, 0.4]);     // realce estrecho
  strip(ACID, 6, 0.9, 7, [4.6, 0.2, 1.2], [0, -Math.PI / 2.6, -0.18]);      // borde ácido
  strip(WARM, 2.2, 4, 1.0, [1.5, -3.8, 2.2], [-Math.PI / 2.6, 0, 0]);       // rebote cálido
  strip('#ffffff', 5, 1.5, 9, [1.6, 1.2, 7.0], [0, Math.PI, 0.55]);         // realce frontal
  strip('#ffffff', 2, 0.8, 9, [-3.4, -0.5, 6.4], [0, Math.PI, -0.45]);      // realce frontal 2

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  dome.geometry.dispose();
  return texture;
}

// --- Escena ------------------------------------------------------------------

function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile() ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 0, 5.4);

  const chrome = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 1, roughness: 0.055, envMapIntensity: 1.6
  });

  const logo = buildLogo(chrome);
  const stage = new THREE.Group();       // se mueve entre la pose de intro y la de reposo
  const tilt = new THREE.Group();        // rotación por puntero / scroll / idle
  tilt.add(logo);
  stage.add(tilt);
  scene.add(stage);

  // Anillos orbitales. Al ser geometría real, la oclusión delante/detrás es
  // correcta sin recortes.
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: ACID, emissive: ACID, emissiveIntensity: 0.85,
    metalness: 0.7, roughness: 0.22
  });
  const ringRadius = 1.05;
  const rings = new THREE.Group();
  const mainRing = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius, 0.011, 16, 260), ringMaterial
  );
  rings.add(mainRing);

  const thinRing = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius * 0.78, 0.004, 12, 200),
    new THREE.MeshStandardMaterial({
      color: 0xdfe2d4, emissive: 0x8d9481, emissiveIntensity: 0.5,
      metalness: 1, roughness: 0.3, transparent: true, opacity: 0.55
    })
  );
  thinRing.rotation.set(0.7, 0.5, 0);
  rings.add(thinRing);

  // Satélite con estela, responsable de que se lea como órbita.
  const orbiter = new THREE.Group();
  const satellite = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, 20, 20),
    new THREE.MeshStandardMaterial({ color: ACID, emissive: ACID, emissiveIntensity: 3 })
  );
  satellite.position.x = ringRadius;
  const satelliteLight = new THREE.PointLight(ACID, 2, 3.5, 2);
  satellite.add(satelliteLight);
  orbiter.add(satellite);

  const trailArc = 1.1;
  const trail = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius, 0.022, 8, 90, trailArc),
    new THREE.MeshBasicMaterial({
      color: ACID, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  trail.rotation.z = -trailArc;
  orbiter.add(trail);
  rings.add(orbiter);

  rings.rotation.set(1.16, 0, -0.3);
  const ringPivot = new THREE.Group();   // precesión lenta del plano orbital
  ringPivot.add(rings);
  stage.add(ringPivot);

  // Resplandor difuso detrás del logo, para separar el cromo del fondo carbón.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 256;
  const ctx = glowCanvas.getContext('2d');
  // Caída gaussiana: con paradas lineales el resplandor se ve como un disco
  // con borde en vez de como luz difusa.
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    gradient.addColorStop(t, `rgba(206,232,128,${(0.15 * Math.exp(-7 * t * t)).toFixed(4)})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(glowCanvas),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
  }));
  glow.scale.setScalar(3.3);
  glow.position.z = -0.6;
  stage.add(glow);

  // Luces directas: el entorno da los reflejos, estas dan el modelado.
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-3, 3.5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(ACID, 1.6);
  rim.position.set(4, -1.5, -2);
  scene.add(rim);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.38, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return {
    renderer, scene, camera, composer, bloom,
    stage, tilt, logo, rings, ringPivot, orbiter, satellite, thinRing, glow
  };
}

// --- Poses -------------------------------------------------------------------
// La pose de reposo depende del ancho: en escritorio el logo vive en la mitad
// derecha del hero; en móvil, centrado en la banda superior.

function restPose(camera) {
  const distance = 5.4;
  if (isMobile()) return { x: 0, y: 0, scale: 0.82, z: distance };
  const halfHeight = Math.tan((camera.fov * Math.PI / 180) / 2) * distance;
  const halfWidth = halfHeight * camera.aspect;
  // En lienzos estrechos (portátiles pequeños, ventanas a media pantalla) el
  // logo se encoge para no pisar el titular.
  const fit = Math.max(0.62, Math.min(1, camera.aspect / 1.6));
  return { x: halfWidth * 0.42, y: 0, scale: 0.9 * fit, z: distance };
}

// --- Arranque ----------------------------------------------------------------

function start() {
  const canvas = document.createElement('canvas');
  canvas.className = 'ao3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  // Con intro, el lienzo entra en negro para que no se vea la pose de reposo.
  if (wantsIntro && gsap) canvas.style.opacity = '0';
  hero.insertBefore(canvas, hero.firstChild);

  let ctx;
  try {
    ctx = createScene(canvas);
  } catch (error) {
    canvas.remove();
    console.warn('Hero 3D no disponible, se usa el fallback CSS:', error);
    releaseContent();
    return;
  }

  const { renderer, camera, composer, bloom, stage, tilt, rings, ringPivot, orbiter } = ctx;
  const useBloom = !isMobile();
  bloom.enabled = useBloom;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile() ? 1.5 : 2));
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.enabled = !isMobile();
    if (!introRunning) applyRest();
    render();
  }

  function applyRest() {
    const pose = restPose(camera);
    stage.position.set(pose.x, pose.y, 0);
    stage.scale.setScalar(pose.scale);
    camera.position.z = pose.z;
  }

  // Estado de animación continua.
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let scrollTilt = 0;
  let introRunning = false;
  let frame = 0;
  let visible = true;
  let orbitAngle = 0;
  const clock = new THREE.Clock();

  function render() {
    composer.render();
  }

  function tick() {
    frame = 0;
    const delta = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;

    orbitAngle += delta * 0.85;
    orbiter.rotation.z = orbitAngle;
    ringPivot.rotation.y = Math.sin(time * 0.16) * 0.55;
    rings.rotation.z = -0.3 + Math.sin(time * 0.11) * 0.12;
    ctx.thinRing.rotation.y += delta * 0.22;

    pointer.x += (pointer.tx - pointer.x) * Math.min(1, delta * 4);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, delta * 4);

    if (!introRunning) {
      tilt.rotation.y = Math.sin(time * 0.35) * 0.16 + pointer.x * 0.5;
      tilt.rotation.x = Math.sin(time * 0.27) * 0.07 + pointer.y * 0.3 + scrollTilt;
    }

    render();
    if (visible) frame = requestAnimationFrame(tick);
  }

  function play() {
    if (!visible || frame) return;
    clock.getDelta();
    frame = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  resize();
  root.classList.add('ao3d-on');

  // Movimiento reducido: una sola pose, un solo fotograma, sin bucle.
  if (reduceMotion.matches) {
    tilt.rotation.set(-0.05, -0.34, 0);
    orbiter.rotation.z = 0.9;
    ringPivot.rotation.y = 0.35;
    applyRest();
    render();
    releaseContent();
    addEventListener('resize', () => { resize(); render(); });
    return;
  }

  // Bucle solo mientras el hero esté a la vista y la pestaña activa.
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting && !document.hidden;
    visible ? play() : pause();
  }, { threshold: 0 });
  observer.observe(hero);
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden && hero.getBoundingClientRect().bottom > 0;
    visible ? play() : pause();
  });
  addEventListener('resize', resize);

  // Paralaje de puntero y de scroll.
  hero.addEventListener('pointermove', event => {
    if (!finePointer.matches || isMobile()) return;
    const rect = hero.getBoundingClientRect();
    pointer.tx = (event.clientX - rect.left) / rect.width - 0.5;
    pointer.ty = (event.clientY - rect.top) / rect.height - 0.5;
  });
  hero.addEventListener('pointerleave', () => { pointer.tx = 0; pointer.ty = 0; });
  addEventListener('scroll', () => {
    const rect = hero.getBoundingClientRect();
    if (rect.bottom > 0) scrollTilt = Math.max(-0.4, Math.min(0, rect.top * 0.0009));
  }, { passive: true });

  play();

  if (!wantsIntro || !gsap) {
    applyRest();
    releaseContent();
    return;
  }

  // --- Coreografía de entrada ------------------------------------------------
  introRunning = true;
  const pose = restPose(camera);
  const mobile = isMobile();

  stage.position.set(0, 0, 0);
  stage.scale.setScalar(mobile ? 1.05 : 1.35);
  tilt.rotation.set(0.35, -1.25, 0);
  rings.scale.setScalar(0.12);
  camera.position.z = mobile ? 5.0 : 4.1;
  ctx.glow.material.opacity = 0;

  const timeline = gsap.timeline({
    defaults: { ease: 'power3.inOut' },
    onComplete: () => { introRunning = false; }
  });

  timeline
    .to(canvas, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0)
    .to(ctx.glow.material, { opacity: 1, duration: 1.2, ease: 'power2.out' }, 0.1)
    .to(tilt.rotation, { y: 0, x: 0, duration: 2.0, ease: 'power3.out' }, 0)
    .to(rings.scale, { x: 1, y: 1, z: 1, duration: 1.5, ease: 'power4.out' }, 0.15)
    .fromTo(orbiter.rotation, { z: -2.4 }, {
      z: 1.6, duration: 1.6, ease: 'power2.out',
      onUpdate: () => { orbitAngle = orbiter.rotation.z; }
    }, 0.15)
    .to(camera.position, { z: pose.z, duration: 1.5 }, mobile ? 0.9 : 1.15)
    .to(stage.position, { x: pose.x, y: pose.y, duration: 1.3 }, mobile ? 0.9 : 1.15)
    .to(stage.scale, { x: pose.scale, y: pose.scale, z: pose.scale, duration: 1.3 }, mobile ? 0.9 : 1.15)
    .add(releaseContent, mobile ? 1.1 : 1.35);
}

// GSAP se carga como script clásico; el módulo puede llegar antes.
if (hero && document.querySelector('.hero .ao-visual')) {
  start();
} else {
  releaseContent();
}
