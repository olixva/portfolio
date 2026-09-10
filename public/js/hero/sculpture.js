// Material y entorno de la escultura. Vive aparte de hero3d.js porque lo
// comparte con tune.html, el panel de ajuste: así lo que se afina ahí es
// exactamente lo que sale en la web.
import * as THREE from 'three';

export const ACID = '#dcff54';
export const GOLD = '#e2c397';

export const LOOK = {
  // Material. Cromo: el color casi neutro es solo un tinte sobre el reflejo,
  // quien manda es el entorno. El acabado satinado conserva los reflejos
  // anchos del vídeo sin marcar cada triángulo de la superficie.
  tint: '#f2f3f4',
  useBaseMap: false,     // conserva opcionalmente el color horneado del modelo
  roughness: 0.22,       // acabado satinado, sin mapa de rugosidad
  normalStrength: 0.035, // relieve fino compartido por la web y el panel
  metalness: 1,
  envIntensity: 1.25,
  rim: 0.085,            // filo ácido por fresnel
  // Escena. Exposición por debajo de 1: los negros del estudio tienen que
  // quedarse negros, si no el metal se va a gris uniforme.
  exposure: 0.96,
  keyLight: 0.22,
  rimLight: 0.3,
  ambient: 0.03,
  // Reacción al puntero. A cero, el ratón no hace nada cerca de la pieza.
  lamp: 1.55,          // lámpara del cursor: reflejo localizado, sin bañar la escena
  deform: 0,             // deformación de la superficie al acercarte
  follow: 1,             // 1 = la pieza gira siguiendo al puntero
  // Entorno
  envSun: 9.0,           // tiras blancas rasantes
  envAcid: 5.2,          // tiras de acento: el champán del dorado, el filo del verde
  envFill: 0.16,         // relleno frontal, muy justo
  // Bloom
  bloomStrength: 0.07,
  bloomRadius: 0.34,
  bloomThreshold: 1.05
};

// Los dos estados del metal comparten la geometría de luces y solo cambian el
// acento: así el barrido entre ellos se lee como la misma pieza bajo otra luz,
// no como dos materiales distintos pegados.
export const GOLD_ENV = look => ({ ...look, envAccent: GOLD });
// El ácido es mucho más luminoso que el oro: a la misma potencia se come los
// blancos y la pieza deja de leerse como cromo para parecer plástico verde.
// Baja el acento y sube las tiras frías para conservar los brillos de metal.
export const SITE_ENV = look => ({
  ...look, envAccent: ACID,
  envAcid: look.envAcid * 0.8, envSun: look.envSun * 1.06
});

// El acero solo existe si hay algo que reflejar. Estudio oscuro con tiras
// rasantes: la luz frontal ancha lo aplanaba a plata mate, y es el contraste
// entre negro y filo lo que hace que se lea como cromo.
export function buildEnvironment(renderer, look = LOOK) {
  const scene = new THREE.Scene();
  const accent = look.envAccent || GOLD;

  const sky = document.createElement('canvas');
  sky.width = 8; sky.height = 2048;
  const c = sky.getContext('2d');
  // Ni negro plano ni gris: una caída muy tenue da a las zonas sin softbox algo
  // de dirección, para que el metal no parezca recortado sobre nada.
  const grad = c.createLinearGradient(0, 0, 0, 2048);
  grad.addColorStop(0, '#111318');
  grad.addColorStop(0.5, '#060709');
  grad.addColorStop(1, '#020203');
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

  // Bordes de luz difusos: evitan que cada panel se refleje como un recorte
  // blanco sobre la triangulación del GLB. El centro conserva el brillo HDR.
  const softbox = document.createElement('canvas');
  softbox.width = softbox.height = 128;
  const pixels = softbox.getContext('2d');
  const data = pixels.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const edge = Math.pow(Math.sin(Math.PI * (x + 0.5) / 128), 0.8)
      * Math.pow(Math.sin(Math.PI * (y + 0.5) / 128), 0.5);
    const i = (y * 128 + x) * 4;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = Math.round(edge * 255);
    data.data[i + 3] = 255;
  }
  pixels.putImageData(data, 0, 0);
  const panelMap = new THREE.CanvasTexture(softbox);
  const box = (color, intensity, w, h2, position, rotation) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h2),
      new THREE.MeshBasicMaterial({ map: panelMap, color: new THREE.Color(color).multiplyScalar(intensity) })
    );
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    scene.add(mesh);
  };

  // Softboxes: son las bandas que se ven viajar por el metal al girar.
  // Ancha y alta a la izquierda: el barrido plateado de los lomos.
  box('#ffffff', look.envSun, 4.0, 9, [-4.0, 2.6, 2.6], [0, Math.PI / 2.8, 0.34]);
  // Estrecha y de canto a la derecha: el filo frío que separa la pieza del fondo.
  box('#ffffff', look.envSun * 0.7, 1.3, 8, [4.3, 3.0, 0.2], [0, -Math.PI / 2.3, -0.30]);
  // Acento bajo y ancho: el champán (o el ácido) que llena los vientres y las
  // caras internas. Es el que da el color, así que va grande y rasante.
  box(accent, look.envAcid, 2.8, 8, [3.6, -1.6, 2.8], [0, -Math.PI / 2.9, -0.20]);
  box(accent, look.envAcid * 0.6, 2.0, 7, [-3.2, -2.2, 3.2], [0, Math.PI / 3.0, 0.26]);
  // Cenital ancha: el gris claro de las caras superiores. Sin ella la pieza
  // se queda en negro con filos de color y pierde el cuerpo de cromo.
  box('#ffffff', look.envSun * 0.5, 5, 3.2, [-0.8, 4.2, 1.2], [Math.PI / 2.2, 0, 0]);
  // Relleno frontal muy justo: evita el negro puro sin aplanar el volumen.
  box('#ffffff', look.envFill, 1.6, 5, [0.6, 1.0, 6.4], [0, Math.PI, 0.35]);
  // Rebote de suelo, teñido del acento.
  box(accent, look.envFill * 1.1, 5, 1.6, [0.4, -3.2, 1.8], [-Math.PI / 2.4, 0, 0]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse(node => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    node.material.dispose();
  });
  texture.dispose();
  panelMap.dispose();
  return env;
}

// Injerta en el material del modelo: mezcla del mapa de color horneado, desplazamiento de vértices y filo ácido.
export function applySteel(material, uniforms, look = LOOK) {
  if (!material.userData.baseMap) material.userData.baseMap = material.map;
  material.map = look.useBaseMap || uniforms.uBaseMix ? material.userData.baseMap : null;
  material.color = new THREE.Color(look.tint);
  material.metalness = look.metalness;
  material.roughness = look.roughness;
  material.normalScale.setScalar(look.normalStrength);
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

    shader.fragmentShader = 'uniform float uBaseMix;\nuniform vec3 uRimColor;\nuniform float uRim;\n'
      + shader.fragmentShader
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
            diffuseColor *= mix(vec4(1.0), sampledDiffuseColor, uBaseMix);
          #endif
        `)
        .replace('#include <dithering_fragment>', `
          #include <dithering_fragment>
          // La normalización en GPU puede producir dot > 1 por redondeo.
          // pow(base negativa, 3.2) genera NaN y el bloom lo propaga.
          float rimBase = clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0);
          float fresnel = pow(rimBase, 3.2);
          gl_FragColor.rgb += uRimColor * fresnel * uRim;
        `);
  };

  material.needsUpdate = true;
}

// Segunda capa sobre applySteel: el barrido que cambia el metal de un entorno
// al otro. Los uniforms que lee, uEnvironmentMix y uSiteEnvironment, ya entran
// por applySteel. Vive aquí, y no en hero3d.js, para que el panel de ajuste
// vea exactamente el mismo shader que la web.
export function applyTransition(material, bounds) {
  const steelShader = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    steelShader(shader);
    shader.uniforms.uSteelMin = { value: bounds.min.clone() };
    shader.uniforms.uSteelSize = { value: bounds.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.001, 0.001, 0.001)) };
    shader.vertexShader = 'uniform vec3 uSteelMin, uSteelSize;\nvarying vec3 vSteelSurface;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vSteelSurface = (position - uSteelMin) / uSteelSize;
    `);
    const transformation = `
      uniform sampler2D uSiteEnvironment;
      uniform float uEnvironmentMix;
      varying vec3 vSteelSurface;
      float steelWave() {
        vec3 p = vSteelSurface;
        // La presión nace en el interior y alcanza primero los relieves
        // centrales, después los extremos de la pieza.
        return length((p - vec3(0.5))*vec3(1.0,0.85,0.2))
          + sin(p.x*12.0+p.y*8.0)*0.018 + sin(p.y*19.0-p.z*5.0)*0.012;
      }
      float steelFront() { return mix(-0.06,0.76,uEnvironmentMix); }
      float steelGreen() { return 1.0-smoothstep(steelFront()-0.065,steelFront()+0.065,steelWave()); }
    `;
    const environmentChunk = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
      /textureCubeUV\( envMap, ([^;]+) \)/g,
      'mix(textureCubeUV(envMap, $1), textureCubeUV(uSiteEnvironment, $1), steelGreen())'
    );
    shader.fragmentShader = transformation + shader.fragmentShader
      .replace('#include <envmap_physical_pars_fragment>', environmentChunk)
      .replace('uRimColor * fresnel * uRim', 'uRimColor * fresnel * uRim * steelGreen()')
      .replace('#include <opaque_fragment>', `
        float waveDistance = (steelWave()-steelFront())/0.045;
        float crest = exp(-waveDistance*waveDistance);
        float activeWave = smoothstep(0.0,0.12,uEnvironmentMix)*(1.0-smoothstep(0.88,1.0,uEnvironmentMix));
        float grazing = pow(1.0-clamp(abs(dot(normalize(normal),normalize(vViewPosition))),0.0,1.0),2.0);
        float core = exp(-steelWave()*steelWave()*45.0)*sin(uEnvironmentMix*3.14159)*activeWave;
        outgoingLight += vec3(0.78,1.0,0.32)*(crest*(0.16+grazing*0.48)+core*0.09)*activeWave;
        #include <opaque_fragment>
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        // Microacabado satinado, filtrado por la huella del píxel.
        float grainPhase = vSteelSurface.y*1050.0+sin(vSteelSurface.x*27.0)*2.0;
        float grainFilter = 1.0-smoothstep(0.4,2.5,fwidth(grainPhase));
        roughnessFactor = clamp(roughnessFactor+sin(grainPhase)*0.007*grainFilter,0.08,1.0);
      `);
  };
}

export function makeUniforms(look = LOOK) {
  return {
    uBaseMix: { value: look.useBaseMap ? 1 : 0 },
    uTouch: { value: new THREE.Vector3(0, 0, 99) },
    uAmp: { value: 0 },
    uTime: { value: 0 },
    uRadius: { value: 0.55 },
    uRimColor: { value: new THREE.Color(ACID) },
    uRim: { value: look.rim }
  };
}
