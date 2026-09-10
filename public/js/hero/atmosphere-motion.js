// Movimiento en coordenadas de escena. Ni las partículas ni las bocanadas
// heredan la transformación de la escultura; esta solo introduce fuerzas locales.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function createAirMotion({ count = 110, cloudCount = 9, random = Math.random } = {}) {
  let width = 2, height = 1, elapsed = 0, initialized = false;
  const bodies = Array.from({ length: count }, () => ({
    x: 0, y: 0, z: random() * 2 - 1.4, vx: 0, vy: 0,
    seed: random() * 100, size: random(), angle: random() * Math.PI * 2, age: 5, pending: false
  }));
  const clouds = Array.from({ length: cloudCount }, (_, i) => ({
    x: 0, y: 0, z: 0, depth: i % 4 === 0 ? 0.25 : -0.25 - random() * 0.5,
    vx: 0, vy: 0, seed: random() * 100, age: i / cloudCount,
    life: 9 + random() * 7, size: 1, wakeX: 0, wakeY: 0, flowX: 0, flowY: 0
  }));

  function spawn(cloud, focus, radius) {
    const angle = random() * Math.PI * 2;
    cloud.x = focus.x + Math.cos(angle) * radius * (0.3 + random() * 0.5);
    cloud.y = focus.y + Math.sin(angle) * radius * 0.4;
    cloud.z = cloud.depth * radius;
    cloud.vx = Math.cos(angle) * radius * 0.025;
    cloud.vy = radius * (0.025 + random() * 0.035);
    cloud.size = radius * (0.9 + random() * 0.7);
    cloud.wakeX = cloud.wakeY = cloud.flowX = cloud.flowY = 0;
  }

  function forces(body, dt, focus, radius, spin, pointer, smoke) {
    const seed = body.seed;
    let ax = Math.sin(elapsed * 0.31 + seed) * 0.014;
    let ay = Math.cos(elapsed * 0.23 + seed * 1.7) * 0.012;
    const dx = body.x - focus.x, dy = body.y - focus.y;
    const distance = Math.hypot(dx, dy * 1.25, body.z * 0.55);
    const influence = Math.max(0, 1 - distance / (radius * 1.65)) ** 2;
    if (smoke) {
      // La velocidad tangencial de una pieza que gira en 3D depende de la
      // profundidad: las bocanadas delanteras y traseras no orbitan juntas.
      const yaw = Math.tanh(spin.y * 0.4) * 2.2;
      const pitch = Math.tanh(spin.x * 0.4) * 2.2;
      const response = 1 - Math.exp(-dt / (0.28 + (seed % 1) * 0.2));
      const localDepth = clamp(body.z / radius, -0.8, 0.8);
      const targetX = yaw * localDepth * radius * influence * 0.65;
      const targetY = -pitch * localDepth * radius * influence * 0.65;
      body.wakeX += (targetX - body.wakeX) * response;
      body.wakeY += (targetY - body.wakeY) * response;
      ax += body.wakeX;
      ay += body.wakeY;
      const relax = Math.exp(-dt * 1.4);
      // Pequeña deformación interna que se relaja; nunca gira todo el plano.
      body.flowX = body.flowX * relax + body.wakeX / radius * dt;
      body.flowY = body.flowY * relax + body.wakeY / radius * dt;
    } else {
      const angular = clamp(spin.y, -5, 5);
      ax += (-dy * angular * 1.8 + spin.y * radius * 0.18) * influence;
      ay += (dx * angular * 1.1 - spin.x * radius * 0.3) * influence;
    }

    // Al agarrar el metal, es la pieza quien remueve el humo: no se suma
    // otro empuje del cursor sobre la misma bocanada.
    if (pointer?.active && !(smoke && pointer.dragging)) {
      const depth = (3.6 - body.z) / 3.6;
      const px = body.x - pointer.x * depth, py = body.y - pointer.y * depth;
      const reach = radius * 0.65 * depth;
      const d = Math.hypot(px, py);
      const falloff = Math.max(0, 1 - d / reach) ** 2;
      // Arrastre del aire + desviación alrededor del dedo/puntero.
      const pointerSpeed = Math.min(2, Math.hypot(pointer.vx, pointer.vy));
      ax += falloff * (clamp(pointer.vx, -2, 2) * 1.4 * depth + px / (d + 0.02) * (0.1 + pointerSpeed * 0.3));
      ay += falloff * (clamp(pointer.vy, -2, 2) * 1.4 * depth + py / (d + 0.02) * (0.1 + pointerSpeed * 0.3));
    }
    if (smoke) ay += body.size * 0.008;
    else {
      const depth = (3.6 - body.z) / 3.6;
      const bx = width * depth, by = height * depth;
      const margin = Math.min(bx, by) * 0.2;
      ax -= Math.sign(body.x) * Math.max(0, Math.abs(body.x) - bx + margin) * 0.8;
      ay -= Math.sign(body.y) * Math.max(0, Math.abs(body.y) - by + margin) * 0.8;
      // Contención de seguridad para impulsos y cambios de orientación.
      if (Math.abs(body.x) > bx) { body.x = clamp(body.x, -bx, bx); body.vx *= -0.35; }
      if (Math.abs(body.y) > by) { body.y = clamp(body.y, -by, by); body.vy *= -0.35; }
    }
    const friction = smoke ? 0.85 : 0.42;
    const damping = Math.exp(-friction * dt);
    body.vx = body.vx * damping + ax * (1 - damping) / friction;
    body.vy = body.vy * damping + ay * (1 - damping) / friction;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
  }

  return {
    bodies, clouds,
    prepareEmission() {
      for (const body of bodies) { body.pending = true; body.age = 0; body.vx = body.vy = 0; }
    },
    releaseEmission(progress, samples, origin) {
      const front = -0.06 + progress * 0.82;
      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i], source = samples[i];
        if (!body.pending || !source) continue;
        body.x = source.x; body.y = source.y; body.z = source.z;
        if (front < source.wave && progress < 1) continue;
        body.pending = false;
        const depth = (3.6 - body.z) / 3.6;
        const angle = Math.atan2(body.y - origin.y, body.x - origin.x) + (random() - 0.5) * 0.7;
        const reach = Math.hypot(width * depth, height * depth);
        const speed = reach * (0.38 + random() * 0.65);
        body.vx = Math.cos(angle) * speed;
        body.vy = Math.sin(angle) * speed;
      }
    },
    setBounds(w, h) {
      const sx = w / width, sy = h / height;
      width = w; height = h;
      for (const body of bodies) {
        if (!initialized) {
          const depth = (3.6 - body.z) / 3.6;
          body.x = (random() * 2 - 1) * width * depth;
          body.y = (random() * 2 - 1) * height * depth;
          body.vx = Math.cos(body.angle) * 0.025;
          body.vy = Math.sin(body.angle) * 0.018;
        } else { body.x *= sx; body.y *= sy; }
      }
      for (const cloud of clouds) { cloud.x *= sx; cloud.y *= sy; }
      initialized = true;
    },
    step(delta, focus, radius, spin = { x: 0, y: 0 }, pointer = null) {
      for (const cloud of clouds) {
        if (!cloud.born) { spawn(cloud, focus, radius); cloud.born = true; }
      }
      // Pasos acotados y rozamiento exponencial: misma respuesta a 30/60/120 Hz.
      let remaining = Math.min(Math.max(delta, 0), 0.05);
      while (remaining > 0.000001) {
        const dt = Math.min(remaining, 1 / 120);
        elapsed += dt; remaining -= dt;
        for (const body of bodies) {
          if (body.pending) continue;
          body.age += dt;
          forces(body, dt, focus, radius, spin, pointer, false);
        }
        for (const cloud of clouds) {
          cloud.age += dt / cloud.life;
          if (cloud.age >= 1) { cloud.age %= 1; spawn(cloud, focus, radius); }
          forces(cloud, dt, focus, radius, spin, pointer, true);
        }
      }
    },
    burst(x, y, radius) {
      for (const body of [...bodies, ...clouds]) {
        const depth = (3.6 - body.z) / 3.6;
        const dx = body.x - x * depth, dy = body.y - y * depth, d = Math.hypot(dx, dy);
        const falloff = Math.max(0, 1 - d / (radius * depth)) ** 2;
        const angle = body.angle ?? body.seed;
        body.vx += (d > 0.001 ? dx / d : Math.cos(angle)) * falloff * 0.85;
        body.vy += (d > 0.001 ? dy / d : Math.sin(angle)) * falloff * 0.85;
      }
    }
  };
}
