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

const ACID = '#dcff54';
const MODEL = 'assets/ao-sculpture.glb';

const root = document.documentElement;
const hero = document.querySelector('.hero');
const gsap = window.gsap;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(pointer:fine)');
const isMobile = () => innerWidth <= 760;
const wantsIntro = root.classList.contains('ao3d-intro');

const releaseContent = () => root.classList.remove('ao3d-intro');

// --- Entorno de reflejos ------------------------------------------------
// El acero solo existe si hay algo que reflejar. Cúpula con horizonte marcado
// más tiras: sin ese corte brusco entre cielo y suelo, las superficies planas
// devuelven un gris uniforme y la pieza parece plástico.

function buildEnvironment(renderer) {
  const scene = new THREE.Scene();
  const sky = document.createElement('canvas');
  sky.width = 4; sky.height = 512;
  const c = sky.getContext('2d');
  const grad = c.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.00, '#ffffff');
  grad.addColorStop(0.34, '#e7ebe0');
  grad.addColorStop(0.58, '#7d8375');
  grad.addColorStop(0.62, '#23261c');
  grad.addColorStop(1.00, '#0a0b08');
  c.fillStyle = grad;
  c.fillRect(0, 0, 4, 512);
  const texture = new THREE.CanvasTexture(sky);
  texture.colorSpace = THREE.SRGBColorSpace;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(12, 32, 32),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide })
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
  strip('#ffffff', 8, 1.1, 8, [-4.6, 2.0, 2.4], [0, Math.PI / 2.6, 0.22]);
  strip(ACID, 7, 0.8, 7, [4.6, 0.2, 1.2], [0, -Math.PI / 2.6, -0.18]);
  strip('#ffffff', 6, 1.8, 9, [1.6, 1.4, 6.6], [0, Math.PI, 0.55]);
  strip('#ffffff', 2.5, 1.0, 8, [-2.4, -0.6, 6.2], [0, Math.PI, -0.5]);
  strip('#ffb06a', 2.6, 5, 1.4, [1.0, -3.6, 2.2], [-Math.PI / 2.6, 0, 0]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  dome.geometry.dispose();
  return env;
}

// --- Material -----------------------------------------------------------
// Se descarta el mapa de color base, que lleva horneado el dorado del render
// original: el acabado lo dan el entorno y las luces, así el acento es el de
// la web. Se le injerta el desplazamiento de vértices y un filo ácido.

function patchMaterial(material, uniforms) {
  material.map = null;
  material.color = new THREE.Color(0xc4c9cd);
  material.metalness = 1;
  material.roughness = 0.4;
  material.envMapIntensity = 2.15;

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'uniform vec3 uTouch;\nuniform float uAmp;\nuniform float uTime;\nuniform float uRadius;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float touchDist = distance(transformed, uTouch);
        float falloff = exp(-(touchDist * touchDist) / (uRadius * uRadius));
        float ripple = sin(touchDist * 13.0 - uTime * 5.5);
        transformed += objectNormal * (uAmp * falloff * ripple * 0.075);
        transformed += objectNormal * sin(uTime * 0.8 + transformed.x * 2.6) * 0.004;
      `);

    shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRim;\n'
      + shader.fragmentShader.replace('#include <dithering_fragment>', `
        #include <dithering_fragment>
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.2);
        gl_FragColor.rgb += uRimColor * fresnel * uRim;
      `);
  };
  material.needsUpdate = true;
}

// --- Escena -------------------------------------------------------------

function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile() ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0, 3.6);

  scene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-3, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(ACID, 1.8);
  rim.position.set(4, -1.2, -2);
  scene.add(rim);

  // La lámpara del cursor: es lo que hace que mover el ratón mueva los
  // reflejos por el metal, en vez de limitarse a girar la pieza.
  const lamp = new THREE.PointLight(ACID, 0, 6, 2);
  lamp.position.set(0, 0, 1.4);
  scene.add(lamp);

  const uniforms = {
    uTouch: { value: new THREE.Vector3(0, 0, 99) },
    uAmp: { value: 0 },
    uTime: { value: 0 },
    uRadius: { value: 0.55 },
    uRimColor: { value: new THREE.Color(ACID) },
    uRim: { value: 0.22 }
  };

  const stage = new THREE.Group();   // pose: intro → reposo
  const tilt = new THREE.Group();    // giro hacia el puntero
  stage.add(tilt);
  scene.add(stage);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.45, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return { renderer, camera, composer, bloom, stage, tilt, lamp, uniforms };
}

function restPose(camera) {
  const distance = 3.6;
  if (isMobile()) return { x: 0, y: 0, scale: 0.86, z: distance };
  const halfHeight = Math.tan((camera.fov * Math.PI / 180) / 2) * distance;
  const halfWidth = halfHeight * camera.aspect;
  const fit = Math.max(0.6, Math.min(1, camera.aspect / 1.7));
  return { x: halfWidth * 0.46, y: 0, scale: 0.9 * fit, z: distance };
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
    console.warn('Hero 3D no disponible, se usa el fallback CSS:', error);
    releaseContent();
    return;
  }

  const { renderer, camera, composer, bloom, stage, tilt, lamp, uniforms } = ctx;
  let model = null;
  let introRunning = false, visible = true, frame = 0;
  let scrollTilt = 0, targetAmp = 0;
  const aim = { x: 0, y: 0 };
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const ndc = new THREE.Vector2();

  function applyRest() {
    const pose = restPose(camera);
    stage.position.set(pose.x, pose.y, 0);
    stage.scale.setScalar(pose.scale);
    camera.position.z = pose.z;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile() ? 1.5 : 2));
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.enabled = !isMobile();
    if (!introRunning) applyRest();
  }

  // Traduce el puntero a un punto del mundo sobre el plano de la pieza: es lo
  // que alimenta a la vez la lámpara y el centro de la deformación.
  function trackPointer() {
    const ao = window.aoPointer;
    if (!ao || !ao.active) {
      targetAmp = 0;
      lamp.intensity += (0 - lamp.intensity) * 0.08;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    ndc.set(((ao.x - rect.left) / rect.width) * 2 - 1, -((ao.y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;

    lamp.position.set(hit.x, hit.y, 1.4);
    const reach = hit.distanceTo(stage.position);
    const near = Math.max(0, 1 - reach / 1.9);
    lamp.intensity += (near * 6 - lamp.intensity) * 0.09;
    targetAmp = near;

    if (model) uniforms.uTouch.value.lerp(model.worldToLocal(hit.clone()), 0.2);
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
      const follow = finePointer.matches && !isMobile() ? 1 : 0;
      const targetY = aim.x * 0.55 * follow + Math.sin(time * 0.3) * 0.1;
      const targetX = -aim.y * 0.3 * follow + Math.sin(time * 0.24) * 0.06 + scrollTilt;
      tilt.rotation.y += (targetY - tilt.rotation.y) * Math.min(1, delta * 2.4);
      tilt.rotation.x += (targetX - tilt.rotation.x) * Math.min(1, delta * 2.4);
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
    stage.scale.setScalar(mobile ? 1.0 : 1.3);
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
    model.traverse(node => { if (node.isMesh) patchMaterial(node.material, uniforms); });

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.scale.setScalar(2.05 / size.x);
    tilt.add(model);
    draco.dispose();

    resize();
    root.classList.add('ao3d-on');

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
    });
    addEventListener('resize', resize);
    addEventListener('scroll', () => {
      const rect = hero.getBoundingClientRect();
      if (rect.bottom > 0) scrollTilt = Math.max(-0.45, Math.min(0, rect.top * 0.001));
    }, { passive: true });

    play();
    runIntro();
  }, undefined, error => {
    console.warn('No se pudo cargar la escultura, se usa el fallback CSS:', error);
    canvas.remove();
    root.classList.remove('ao3d-on');
    releaseContent();
  });
}

if (hero && document.querySelector('.hero .ao-visual')) start();
else releaseContent();
