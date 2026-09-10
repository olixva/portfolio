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
import { ACID, LOOK, buildEnvironment, applySteel, makeUniforms } from './sculpture.js?v=9ecd0025';

import { prepareIntro } from './intro.js?v=1af12126';

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
  // Fondo transparente para integrar la escena en el hero.
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile() ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer, { ...LOOK, envAccent: '#e9b96e', studio: true, envSun: 4.5, envAcid: 4, envFill: 3 });

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
  uniforms.uSiteEnvironment = { value: buildEnvironment(renderer, { ...LOOK, envAccent: ACID, studio: true, envSun: 4.5, envAcid: 4, envFill: 3 }) };

  const stage = new THREE.Group();   // pose: intro → reposo
  const tilt = new THREE.Group();    // giro hacia el puntero
  stage.add(tilt);
  scene.add(stage);

  // Buffers HDR estándar para el postprocesado.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), LOOK.bloomStrength, LOOK.bloomRadius, LOOK.bloomThreshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return { renderer, scene, camera, composer, bloom, stage, tilt, lamp, rim, uniforms };
}

// La escala se deduce del ancho visible, no de un numero fijo: en movil el
// lienzo es muy estrecho (relacion ~0.5) y con escala fija la pieza se sale.
const PIECE_WIDTH = 2.05;

function restPose(camera) {
  const distance = 3.6;
  const halfHeight = Math.tan((camera.fov * Math.PI / 180) / 2) * distance;
  const halfWidth = halfHeight * camera.aspect;
  const share = isMobile() ? 0.78 : 0.40;   // deja margen para los giros laterales
  const width = isMobile() ? innerWidth * share : Math.min(innerWidth * share, 720);
  const scale = Math.min(0.95, (halfWidth * 2 * width / innerWidth) / PIECE_WIDTH);
  // En movil el lienzo es ya una banda propia arriba: la pieza va centrada en
  // ella. En escritorio se recuesta a la derecha del titular.
  return { x: isMobile() ? 0 : halfWidth * (Math.min(innerWidth * 0.88, 1400) / innerWidth) * 0.48, y: 0, scale, z: distance };
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
  const { renderer, scene, camera, composer, bloom, stage, tilt, lamp, rim, uniforms } = ctx;
  uniforms.uIntroProjection = { value: 0 };
  uniforms.uIntroFrame = { value: null };
  uniforms.uIntroResolution = { value: new THREE.Vector2(1, 1) };
  uniforms.uIntroFit = { value: new THREE.Vector2(1, 1) };
  uniforms.uIntroOffset = { value: new THREE.Vector2() };
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
    renderer.getDrawingBufferSize(uniforms.uIntroResolution.value);
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

  function tick() {
    frame = 0;
    const delta = Math.min(clock.getDelta(), 0.05);
    const time = Math.max(0, clock.elapsedTime - settledAt);
    uniforms.uTime.value = clock.elapsedTime;
    if (!introRunning) trackPointer();
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
      const targetY = (aim.x * 0.55 * follow + Math.sin(time * 0.3) * 0.1) * interaction.value + drag.yaw;
      const targetX = (-aim.y * 0.3 * follow + Math.sin(time * 0.24) * 0.06 + scrollTilt) * interaction.value + drag.pitch;
      const ease = Math.min(1, delta * (drag.on ? 14 : 2.4));
      tilt.rotation.y += (targetY - tilt.rotation.y) * ease;
      tilt.rotation.x += (targetX - tilt.rotation.x) * ease;
    }

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
    // Vídeo y modelo se alinean en píxeles dentro del mismo lienzo del hero.
    uniforms.uIntroFit.value.set(rect.width / (1248 * videoScale), rect.height / (704 * videoScale));
    uniforms.uIntroOffset.value.set(-centerX / (1248 * videoScale), centerY / (704 * videoScale));
    stage.scale.setScalar(2 * halfHeight * (1188 * videoScale / rect.height) / PIECE_WIDTH);
    stage.position.set((centerX - 6 * videoScale) / rect.height * 2 * halfHeight,
      (-centerY + 12 * videoScale) / rect.height * 2 * halfHeight, 0);
    tilt.rotation.set(0, 0, 0.035);
    camera.position.z = 3.6;
  }

  function finishIntro() {
    clearTimeout(modelTimeout);
    introTimeline?.kill();
    uniforms.uIntroProjection.value = 0;
    uniforms.uIntroFrame.value = null;
    introFrame?.dispose();
    introFrame = null;
    canvas.style.opacity = model ? '1' : '0';
    if (!model) root.classList.remove('ao3d-pending');
    intro?.dispose();
    introRunning = false;
    settledAt = clock.elapsedTime;
    interactionTween?.kill();
    if (gsap) interactionTween = gsap.to(interaction, { value: 1, duration: 0.65, ease: 'power2.inOut' });
    else interaction.value = 1;
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
    introFrame = new THREE.VideoTexture(intro.video);
    uniforms.uIntroFrame.value = introFrame;
    uniforms.uIntroProjection.value = 1;
    uniforms.uBaseMix.value = 0.25;
    uniforms.uRim.value = 0;
    rim.intensity = 0;
    resize();
    matchVideoPose();
    await renderer.compileAsync(scene, camera);
    clearTimeout(modelTimeout);
    if (!introRunning) return;
    composer.render();
    readyForHandoff = true;
    await intro.ended;
    await document.fonts.ready;
    if (!introRunning) return;
    clearTimeout(modelTimeout);
    intro.hideLoader();
    canvas.style.opacity = '1';
    composer.render();
    transitioning = true;
    root.classList.add('ao3d-revealing');
    const pose = restPose(camera);
    introTimeline = gsap.timeline({ defaults: { ease: 'power2.inOut' }, onComplete: finishIntro })
      .to(intro.video, { opacity: 0, duration: 0.18, ease: 'power1.inOut' }, 0)
      .set(intro.overlay.querySelector('.ao-intro-backdrop'), { opacity: 0 }, 0)
      .to(tilt.rotation, { z: 0, duration: 0.9 }, 0.08)
      .to(stage.position, { x: pose.x, y: pose.y, duration: 0.9 }, 0.08)
      .to(stage.scale, { x: pose.scale, y: pose.scale, z: pose.scale, duration: 0.9 }, 0.08)
      .to(uniforms.uEnvironmentMix, { value: 1, duration: 0.8 }, 0.12)
      .to(uniforms.uIntroProjection, { value: 0, duration: 0.08 }, 0)
      .to(uniforms.uBaseMix, { value: 0.18, duration: 0.8 }, 0.12)
      .to(uniforms.uRim, { value: LOOK.rim, duration: 0.7 }, 0.2)
      .to(rim, { intensity: LOOK.rimLight, duration: 0.7 }, 0.2)
      .add(releaseContent, 0.4);
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
      node.material.normalScale.setScalar(0.15);
      node.material.roughnessMap = null;
      applySteel(node.material, uniforms, { ...LOOK, tint: '#eeeeee', roughness: 0.22, envIntensity: 1.1 });
      const steelShader = node.material.onBeforeCompile;
      node.material.onBeforeCompile = shader => {
        steelShader(shader);
        const environmentChunk = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
          /textureCubeUV\( envMap, ([^;]+) \)/g,
          'mix(textureCubeUV(envMap, $1), textureCubeUV(uSiteEnvironment, $1), uEnvironmentMix)'
        );
        shader.fragmentShader = 'uniform sampler2D uSiteEnvironment;\nuniform float uEnvironmentMix;\n' + shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', environmentChunk);
        shader.fragmentShader = 'uniform sampler2D uIntroFrame;\nuniform float uIntroProjection;\nuniform vec2 uIntroResolution;\nuniform vec2 uIntroFit;\nuniform vec2 uIntroOffset;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', `
          // Conserva los reflejos del último fotograma sobre la superficie real
          // durante el relevo; luego cede a la iluminación interactiva.
          if (uIntroProjection > 0.0) {
            vec2 videoUv = (gl_FragCoord.xy / uIntroResolution - 0.5) * uIntroFit + 0.5 + uIntroOffset;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, pow(texture2D(uIntroFrame, videoUv).rgb, vec3(2.2)), uIntroProjection);
          }
          #include <dithering_fragment>
        `);
      };
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
      if (document.hidden && transitioning) finishIntro();
    });
    addEventListener('resize', () => {
      if (transitioning && introRunning) finishIntro();
      resize();
    });

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
      drag.x = event.clientX; drag.y = event.clientY;
      hero.setPointerCapture(event.pointerId);
      root.classList.add('ao3d-dragging');
    });
    hero.addEventListener('pointermove', event => {
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
