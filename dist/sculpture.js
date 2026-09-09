// Material y entorno de la escultura. Vive aparte de hero3d.js porque lo
// comparte con tune.html, el panel de ajuste: así lo que se afina ahí es
// exactamente lo que sale en la web.
import * as THREE from 'three';

export const ACID = '#dcff54';

export const LOOK = {
  // Material
  tint: '#cdd2d6',       // color del metal
  useBaseMap: false,     // el mapa de color trae horneado el dorado del render
  roughness: 0.5,       // multiplica el mapa de rugosidad del modelo
  metalness: 1,
  envIntensity: 0.6,
  rim: 0.16,             // filo ácido por fresnel
  // Escena
  exposure: 1.05,
  keyLight: 0.4,
  rimLight: 0.3,
  ambient: 0.07,
  // Reacción al puntero. A cero, el ratón no hace nada cerca de la pieza.
  lamp: 3,             // lámpara del cursor: es la luz principal de la escena
  deform: 0,             // deformación de la superficie al acercarte
  follow: 1,             // 1 = la pieza gira siguiendo al puntero
  // Entorno
  envSun: 2.4,             // tira principal
  envAcid: 1,          // tira ácida: acento en un canto, no tinte general
  envFill: 1,          // relleno frontal
  horizon: 0.6,          // altura del corte cielo/suelo
  ground: 0.14,          // claridad del suelo (0 = negro)
  // Bloom
  bloomStrength: 0.12,
  bloomRadius: 0.45,
  bloomThreshold: 1.05
};

// El acero solo existe si hay algo que reflejar. Cúpula con horizonte marcado
// más softboxes: sin ese corte brusco entre cielo y suelo, las superficies
// planas devuelven un gris uniforme y la pieza parece plástico.
export function buildEnvironment(renderer, look = LOOK) {
  const scene = new THREE.Scene();

  const sky = document.createElement('canvas');
  sky.width = 8; sky.height = 2048;
  const c = sky.getContext('2d');
  const grad = c.createLinearGradient(0, 0, 0, 2048);
  const g = Math.max(0, Math.min(1, look.ground));
  const floor = new THREE.Color(0x0a0b08).lerp(new THREE.Color(0x9aa08c), g);
  const h = Math.max(0.2, Math.min(0.9, look.horizon));
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(h * 0.55, '#e7ebe0');
  grad.addColorStop(h - 0.035, '#7d8375');
  grad.addColorStop(h + 0.012, '#' + floor.getHexString());
  grad.addColorStop(1, '#050604');
  c.fillStyle = grad;
  c.fillRect(0, 0, 8, 2048);
  const texture = new THREE.CanvasTexture(sky);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(12, 32, 32),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide })
  );
  scene.add(dome);

  const box = (color, intensity, w, h2, position, rotation) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) })
    );
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    scene.add(mesh);
  };

  // Softboxes: son las bandas que se ven viajar por el metal al girar.
  box('#ffffff', look.envSun, 1.3, 8, [-4.6, 2.0, 2.2], [0, Math.PI / 2.6, 0.22]);
  box('#ffffff', look.envSun * 0.45, 0.5, 7, [-3.0, 3.2, 4.4], [0, Math.PI / 4, 0.5]);
  box(ACID, look.envAcid, 0.8, 7, [4.6, 0.2, 1.2], [0, -Math.PI / 2.6, -0.18]);
  box('#ffffff', look.envFill, 1.6, 9, [1.6, 1.4, 6.6], [0, Math.PI, 0.55]);
  box('#ffffff', look.envFill * 0.4, 0.9, 8, [-2.4, -0.6, 6.2], [0, Math.PI, -0.5]);
  box('#c9cec4', 1.4, 5, 1.4, [1.0, -3.6, 2.2], [-Math.PI / 2.6, 0, 0]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  dome.geometry.dispose();
  return env;
}

// Injerta en el material del modelo: desaturación del mapa de color (el
// original trae el dorado horneado), desplazamiento de vértices y filo ácido.
export function applySteel(material, uniforms, look = LOOK) {
  if (!material.userData.baseMap) material.userData.baseMap = material.map;
  material.map = look.useBaseMap ? material.userData.baseMap : null;
  material.color = new THREE.Color(look.tint);
  material.metalness = look.metalness;
  material.roughness = look.roughness;
  material.envMapIntensity = look.envIntensity;

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
      + shader.fragmentShader
        .replace('#include <dithering_fragment>', `
          #include <dithering_fragment>
          float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.2);
          gl_FragColor.rgb += uRimColor * fresnel * uRim;
        `);
  };
  material.needsUpdate = true;
}

export function makeUniforms(look = LOOK) {
  return {
    uTouch: { value: new THREE.Vector3(0, 0, 99) },
    uAmp: { value: 0 },
    uTime: { value: 0 },
    uRadius: { value: 0.55 },
    uRimColor: { value: new THREE.Color(ACID) },
    uRim: { value: look.rim }
  };
}
