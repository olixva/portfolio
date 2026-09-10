const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const { createAirMotion } = await import(pathToFileURL(path.resolve(__dirname, '../public/js/hero/atmosphere-motion.js')));
  function air() {
    let seed = 12345;
    const motion = createAirMotion({ count: 12, random: () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) });
    motion.setBounds(4, 2);
    return motion;
  }
  const focus = { x: 0, y: 0 };
  const emission = air();
  const sources = emission.bodies.map((_, i) => ({ x: i * 0.04, y: 0.1, z: 0, wave: 0.08 + i * 0.045 }));
  emission.prepareEmission();
  emission.releaseEmission(0, sources, focus);
  assert.ok(emission.bodies.every(body => body.pending), 'No particle is scattered before the wave starts');
  assert.equal(emission.bodies[4].x, sources[4].x, 'Particles start on the metal surface');
  emission.releaseEmission(0.4, sources, focus);
  assert.ok(!emission.bodies[0].pending && emission.bodies.at(-1).pending, 'The outward wave releases inner points before outer points');
  assert.ok(Math.hypot(emission.bodies[0].vx, emission.bodies[0].vy) > 0.5, 'The initial release has an outward impulse');
  const launchedX = emission.bodies[0].x;
  const launchedVx = emission.bodies[0].vx;
  emission.releaseEmission(0.4, sources, focus);
  assert.equal(emission.bodies[0].vx, launchedVx, 'The wave must not relaunch an already released particle');
  for (let i = 0; i < 30; i++) emission.step(1 / 60, focus, 1);
  assert.notEqual(emission.bodies[0].x, launchedX, 'Released particles travel independently of their source');
  assert.equal(emission.bodies.at(-1).x, sources.at(-1).x, 'Unreached points wait on the surface');
  emission.releaseEmission(1, sources, focus);
  assert.ok(emission.bodies.every(body => !body.pending), 'Completing or skipping the wave releases all particles');
  const calm = air(), spinning = air();
  for (const system of [calm, spinning]) {
    Object.assign(system.bodies[0], { x: 0.4, y: 0.2, z: 0 });
    Object.assign(system.bodies[1], { x: 3, y: 0.2, z: 0 });
  }
  calm.step(1 / 60, focus, 1);
  spinning.step(1 / 60, focus, 1, { x: 0, y: 3 });
  assert.notEqual(calm.bodies[0].vx, spinning.bodies[0].vx, 'A nearby particle responds to the sculpture');
  assert.deepEqual(calm.bodies[1], spinning.bodies[1], 'Distant particles do not inherit sculpture rotation');
  const before = spinning.bodies[1].vx;
  spinning.burst(0.4, 0.2, 0.8);
  assert.equal(spinning.bodies[1].vx, before, 'A click impulse stays local');
  assert.ok(Math.hypot(spinning.bodies[0].vx, spinning.bodies[0].vy) > 0.5, 'A click throws nearby fragments');
  const cursor = air();
  cursor.bodies[0].x = 0.1;
  cursor.bodies[0].y = 0.1;
  const beforeCursor = { ...cursor.bodies[0] };
  cursor.step(1 / 60, focus, 1, { x: 0, y: 0 }, { x: 0.1, y: 0.1, vx: 1, vy: 0, active: true });
  assert.notDeepEqual(cursor.bodies[0], beforeCursor, 'A nearby particle reacts to pointer movement');

  const fps30 = air(), fps120 = air();
  for (let i = 0; i < 30; i++) fps30.step(1 / 30, focus, 1, { x: 0.3, y: 1 });
  for (let i = 0; i < 120; i++) fps120.step(1 / 120, focus, 1, { x: 0.3, y: 1 });
  for (let i = 0; i < fps30.bodies.length; i++) {
    assert.ok(Math.hypot(fps30.bodies[i].x - fps120.bodies[i].x, fps30.bodies[i].y - fps120.bodies[i].y) < 0.001, 'Motion is independent of frame rate');
  }
  const snapshot = JSON.stringify(fps30.bodies);
  fps30.step(0, focus, 1);
  assert.equal(JSON.stringify(fps30.bodies), snapshot, 'Reduced motion does not advance particles');
  fps30.setBounds(0.4, 0.8);
  for (let i = 0; i < 3600; i++) fps30.step(1 / 60, focus, 0.3);
  for (const body of fps30.bodies) {
    const depth = (3.6 - body.z) / 3.6;
    assert.ok(Number.isFinite(body.x) && Math.abs(body.x) <= 0.4 * depth + 0.02);
    assert.ok(Number.isFinite(body.y) && Math.abs(body.y) <= 0.8 * depth + 0.02);
  }
  console.log('OK: independent particles, local forces, emission, resizing and 30/120 Hz');
})().catch(error => { console.error(error); process.exitCode = 1; });
