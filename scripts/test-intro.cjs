// NODE_PATH=/ruta/a/node_modules node scripts/test-intro.cjs [URL]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const openGate = require('./open-gate.cjs');
const url = process.argv[2] || 'http://localhost:8000';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  async function page(options = {}) {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...options });
    p.on('pageerror', error => errors.push(error.message));
    p.on('console', message => { if (message.type() === 'error' && /WebGL|shader/i.test(message.text())) errors.push(message.text()); });
    return p;
  }
  async function finished(p) {
    await p.waitForFunction(() => !document.querySelector('.ao-intro') && !document.documentElement.classList.contains('ao3d-intro'));
    assert.equal(await p.locator('.hero-content').evaluate(el => getComputedStyle(el).pointerEvents), 'auto');
  }
  try {
    const desktop = await page();
    await desktop.goto(url, { waitUntil: 'domcontentloaded' });
    await openGate(desktop);
    await desktop.waitForSelector('.ao-intro.is-playing');
    assert.equal(await desktop.evaluate(() => document.elementFromPoint(80, 35).closest('.header') !== null), true);
    assert.equal(await desktop.locator('video').evaluate(v => v.muted && v.playsInline), true);
    assert.equal(await desktop.locator('.hero-content').evaluate(el => getComputedStyle(el).opacity), '0');
    await finished(desktop);
    await desktop.reload({ waitUntil: 'domcontentloaded' });
    // Al recargar vuelve a haber puerta: la entrada se repite entera.
    assert.equal(await openGate(desktop), true, 'La puerta debe reaparecer al recargar');
    await desktop.waitForSelector('.ao-intro.is-playing');
    await finished(desktop);
    console.log('OK: vídeo primero, entrada y repetición al recargar');
    await desktop.close();

    const mobile = await page({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
    await mobile.goto(url, { waitUntil: 'domcontentloaded' });
    await openGate(mobile);
    await mobile.waitForSelector('.ao-intro.is-playing');
    await finished(mobile);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobile.screenshot({ path: '/tmp/portfolio-mobile.png' });
    console.log('OK: entrada móvil sin desbordamiento');
    await mobile.close();

    const slow = await page();
    await slow.route('**/ao-sculpture.glb*', async route => { await new Promise(r => setTimeout(r, 7000)); await route.continue(); });
    await slow.route('**/intro.mp4*', async route => { await new Promise(r => setTimeout(r, 600)); await route.continue(); });
    await slow.goto(url, { waitUntil: 'domcontentloaded' });
    await openGate(slow);
    await slow.waitForSelector('.ao-intro-loader');
    await slow.waitForFunction(() => document.querySelector('video')?.ended);
    assert.equal(await slow.locator('.hero-content').evaluate(el => getComputedStyle(el).opacity), '0');
    await finished(slow);
    console.log('OK: carga lenta conserva el último fotograma hasta tener el 3D');
    await slow.close();

    const independent = await page();
    await independent.addInitScript(() => {
      const original = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => original(fn, ms === 45000 ? 6000 : ms, ...args);
      window.introEnded = false;
      document.addEventListener('ended', event => { if (event.target.tagName === 'VIDEO') window.introEnded = true; }, true);
    });
    await independent.route('**/intro.mp4*', async route => { await new Promise(r => setTimeout(r, 4000)); await route.continue(); });
    await independent.goto(url, { waitUntil: 'domcontentloaded' });
    await openGate(independent);
    await independent.waitForSelector('.ao-intro.is-playing');
    await finished(independent);
    assert.equal(await independent.evaluate(() => window.introEnded), true);
    console.log('OK: la espera del modelo no corta un vídeo que tarda en descargar');
    await independent.close();

    const blocked = await page();
    await blocked.addInitScript(() => {
      const original = HTMLMediaElement.prototype.play;
      let first = true;
      HTMLMediaElement.prototype.play = function () {
        if (first) { first = false; return Promise.reject(new DOMException('Blocked', 'NotAllowedError')); }
        return original.call(this);
      };
    });
    await blocked.goto(url, { waitUntil: 'domcontentloaded' });
    await openGate(blocked);
    await blocked.getByRole('button', { name: 'Reproducir', exact: true }).click();
    await blocked.waitForSelector('.ao-intro.is-playing');
    await finished(blocked);
    console.log('OK: reproducción manual si autoplay está bloqueado');
    await blocked.close();

    for (const asset of ['intro.mp4', 'ao-sculpture.glb']) {
      const failed = await page();
      await failed.route('**/' + asset + '*', route => route.abort());
      await failed.goto(url, { waitUntil: 'domcontentloaded' });
      await openGate(failed);
      await finished(failed);
      console.log('OK: fallo de ' + asset + ' libera el contenido');
      await failed.close();
    }
    const reduced = await page({ reducedMotion: 'reduce' });
    await reduced.goto(url);
    await openGate(reduced);
    await reduced.waitForSelector('html.ao3d-on');
    assert.equal(await reduced.locator('video').count(), 0);
    await finished(reduced);
    await reduced.close();
    console.log('OK: preferencia de movimiento reducido');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
