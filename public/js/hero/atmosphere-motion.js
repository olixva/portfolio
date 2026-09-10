// Movimiento independiente de partículas. La escultura solo aplica fuerzas
// locales; las partículas viven en la raíz de la escena.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function createAirMotion({ count = 110, random = Math.random } = {}) {
  let width = 2, height = 1, elapsed = 0, initialized = false;
  const bodies = Array.from({ length: count }, () => ({
    x: 0, y: 0, z: random() * 2 - 1.4, vx: 0, vy: 0,
    seed: random() * 100, size: random(), angle: random() * Math.PI * 2,
    age: 5, pending: false
  }));

  function forces(body, dt, focus, radius, spin, pointer) {
    const seed = body.seed;
    let ax = Math.sin(elapsed * 0.31 + seed) * 0.014;
    let ay = Math.cos(elapsed * 0.23 + seed * 1.7) * 0.012;
    const dx = body.x - focus.x, dy = body.y - focus.y;
    const distance = Math.hypot(dx, dy * 1.25, body.z * 0.55);
    const influence = Math.max(0, 1 - distance / (radius * 1.65)) ** 2;
    const angular = clamp(spin.y, -5, 5);
    ax += (-dy * angular * 1.8 + spin.y * radius * 0.18) * influence;
    ay += (dx * angular * 1.1 - spin.x * radius * 0.3) * influence;

    if (pointer?.active) {
      const depth = (3.6 - body.z) / 3.6;
      const px = body.x - pointer.x * depth, py = body.y - pointer.y * depth;
      const reach = radius * 0.65 * depth;
      const d = Math.hypot(px, py);
      const falloff = Math.max(0, 1 - d / reach) ** 2;
      const pointerSpeed = Math.min(2, Math.hypot(pointer.vx, pointer.vy));
      ax += falloff * (clamp(pointer.vx, -2, 2) * 1.4 * depth + px / (d + 0.02) * (0.1 + pointerSpeed * 0.3));
      ay += falloff * (clamp(pointer.vy, -2, 2) * 1.4 * depth + py / (d + 0.02) * (0.1 + pointerSpeed * 0.3));
    }

    const depth = (3.6 - body.z) / 3.6;
    const bx = width * depth, by = height * depth;
    const margin = Math.min(bx, by) * 0.2;
    ax -= Math.sign(body.x) * Math.max(0, Math.abs(body.x) - bx + margin) * 0.8;
    ay -= Math.sign(body.y) * Math.max(0, Math.abs(body.y) - by + margin) * 0.8;
    if (Math.abs(body.x) > bx) { body.x = clamp(body.x, -bx, bx); body.vx *= -0.35; }
    if (Math.abs(body.y) > by) { body.y = clamp(body.y, -by, by); body.vy *= -0.35; }

    const friction = 0.42;
    const damping = Math.exp(-friction * dt);
    body.vx = body.vx * damping + ax * (1 - damping) / friction;
    body.vy = body.vy * damping + ay * (1 - damping) / friction;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
  }

  return {
    bodies,
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
      initialized = true;
    },
    step(delta, focus, radius, spin = { x: 0, y: 0 }, pointer = null) {
      let remaining = Math.min(Math.max(delta, 0), 0.05);
      while (remaining > 0.000001) {
        const dt = Math.min(remaining, 1 / 120);
        elapsed += dt; remaining -= dt;
        for (const body of bodies) {
          if (body.pending) continue;
          body.age += dt;
          forces(body, dt, focus, radius, spin, pointer);
        }
      }
    },
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
    burst(x, y, radius) {
      for (const body of bodies) {
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
