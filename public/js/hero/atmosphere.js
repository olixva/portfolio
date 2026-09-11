// Partículas independientes: la escultura emite y desplaza fragmentos cercanos.
// El movimiento vive en atmosphere-motion; aquí solo se dibuja.
import * as THREE from 'three';
import { createAirMotion } from './atmosphere-motion.js?v=94dbc2c3';

const PARTICLE_VERTEX = `
  uniform float uTime, uIntensity, uPixelRatio, uRadius;
  uniform vec2 uFocus;
  attribute float aSize, aSeed, aAge;
  varying float vAlpha, vSeed, vSpark;
  void main() {
    vec4 mv = modelViewMatrix*vec4(position,1.0);
    gl_Position = projectionMatrix*mv;
    float spark = exp(-max(aAge,0.0)*2.5);
    gl_PointSize = (1.2+aSize*2.6)*(1.0+spark*0.65)*uPixelRatio*3.6/-mv.z;
    float nearMetal = 1.0-smoothstep(uRadius*0.4,uRadius*2.5,distance(position.xy,uFocus));
    float breath = 0.78+0.22*sin(uTime*0.45+aSeed);
    vAlpha = uIntensity*breath*mix(0.16,0.6,nearMetal)*(1.0+spark*1.2)*step(0.0,aAge);
    vSeed = aSeed;
    vSpark = spark;
  }`;
const PARTICLE_FRAGMENT = `
  uniform float uTime;
  varying float vAlpha, vSeed, vSpark;
  void main() {
    vec2 p = gl_PointCoord-0.5;
    float angle = vSeed + uTime*(0.06+fract(vSeed)*0.08);
    p = mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*p;
    float dust = 1.0-smoothstep(0.12,0.49,length(p));
    float shard = 1.0-smoothstep(0.25,0.43,abs(p.x)*0.7+abs(p.y)*1.5);
    float alpha = mix(dust,shard,step(0.78,fract(vSeed)))*vAlpha;
    if(alpha<0.003) discard;
    vec3 color = mix(vec3(0.56,0.6,0.49),vec3(0.8,0.87,0.57),fract(vSeed*0.37));
    color = mix(color, vec3(0.87,1.0,0.58), vSpark*0.7);
    gl_FragColor = vec4(color,alpha);
  }`;

export function createAtmosphere({ scene, mobile = false, reduceMotion = false }) {
  const intensity = { value: 0 };
  const motion = createAirMotion({ count: reduceMotion ? 28 : (mobile ? 88 : 187) });
  const pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false };
  const target = { x: 0, y: 0, active: false };
  let pointerInitialized = false;
  const time = { value: 0 };
  const group = new THREE.Group();
  group.name = 'hero-atmosphere';
  scene.add(group);
  const positions = new Float32Array(motion.bodies.length*3);
  const ages = new Float32Array(motion.bodies.length);
  const emission = { value: 0 };
  let emitter = null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAge',new THREE.BufferAttribute(ages,1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize',new THREE.Float32BufferAttribute(motion.bodies.map(body=>body.size**2),1));
  geometry.setAttribute('aSeed',new THREE.Float32BufferAttribute(motion.bodies.map(body=>body.seed),1));
  const material = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT,
    uniforms: { uTime: time, uIntensity: intensity, uPixelRatio: {value:1}, uFocus: {value:new THREE.Vector2()}, uRadius:{value:1} },
    transparent: true, depthWrite: false
  });
  const points = new THREE.Points(geometry,material);
  points.frustumCulled = false;
  group.add(points);

  return {
    intensity, emission,
    prepareEmission(model) {
      if (reduceMotion) return;
      const meshes = [];
      model.traverse(node => { if (node.isMesh && node.geometry.attributes.position) meshes.push(node); });
      if (!meshes.length) return;
      model.updateWorldMatrix(true, true);
      const anchors = motion.bodies.map((_, i) => {
        const mesh = meshes[i % meshes.length];
        const geometry = mesh.geometry;
        const attribute = geometry.attributes.position;
        const vertex = new THREE.Vector3().fromBufferAttribute(attribute, Math.floor(Math.random()*attribute.count));
        geometry.computeBoundingBox();
        const size = geometry.boundingBox.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.001,0.001,0.001));
        const p = vertex.clone().sub(geometry.boundingBox.min).divide(size);
        const wave = Math.hypot(p.x-0.5,(p.y-0.5)*0.85,(p.z-0.5)*0.2)
          + Math.sin(p.x*12+p.y*8)*0.018 + Math.sin(p.y*19-p.z*5)*0.012;
        return { mesh, vertex, world: new THREE.Vector3(), wave };
      });
      const origin = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      emitter = { model, anchors, origin, samples: anchors.map(() => ({x:0,y:0,z:0,wave:0})) };
      emission.value = 0;
      motion.prepareEmission();
    },
    setSize(camera,pixelRatio) {
      const h = Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.position.z;
      motion.setBounds(h*camera.aspect,h);
      material.uniforms.uPixelRatio.value = pixelRatio;
      target.active = false;
      pointerInitialized = false;
    },
    setPointer(x,y,active=true) {
      target.x=x; target.y=y; target.active=active;
      if (!active) pointerInitialized=false;
    },
    burst(x,y) { if(!reduceMotion) motion.burst(x,y,1.1); },
    update(delta,elapsed,spin={x:0,y:0},focus={x:0,y:0},radius=1) {
      radius = Math.max(0.08,radius);
      material.uniforms.uFocus.value.set(focus.x,focus.y);
      material.uniforms.uRadius.value=radius;
      time.value=reduceMotion?0:elapsed;
      if(target.active && delta>0 && !reduceMotion) {
        pointer.vx=pointerInitialized?(target.x-pointer.x)/delta:0;
        pointer.vy=pointerInitialized?(target.y-pointer.y)/delta:0;
        pointer.x=target.x; pointer.y=target.y;
        pointerInitialized=true;
      }
      pointer.active=target.active && !reduceMotion;
      if (emitter) {
        emitter.model.updateWorldMatrix(true,true);
        emitter.anchors.forEach((anchor,i) => {
          anchor.world.copy(anchor.vertex).applyMatrix4(anchor.mesh.matrixWorld);
          Object.assign(emitter.samples[i], { x:anchor.world.x, y:anchor.world.y, z:anchor.world.z, wave:anchor.wave });
        });
        motion.releaseEmission(emission.value,emitter.samples,emitter.origin);
        if (emission.value >= 1) emitter = null;
      }
      // La emisión empieza cuando se descubre el metal, no durante el vídeo.
      if(intensity.value>0) motion.step(reduceMotion?0:delta,focus,radius,typeof spin==='number'?{x:0,y:spin}:spin,pointer);
      for(let i=0;i<motion.bodies.length;i++) {
        const body=motion.bodies[i];
        positions[i*3]=body.x; positions[i*3+1]=body.y; positions[i*3+2]=body.z;
        ages[i]=body.pending?-1:body.age;
      }
      geometry.attributes.position.needsUpdate=true;
      geometry.attributes.aAge.needsUpdate=true;
    },
    dispose() {
      geometry.dispose(); material.dispose(); group.removeFromParent();
    }
  };
}
