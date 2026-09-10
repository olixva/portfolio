const { webkit, chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const openGate = require('./open-gate.cjs');
const url = process.argv[2] || 'http://localhost:8000';
(async () => {
  for (const [name, engine, options] of [['WebKit iPhone', webkit, devices['iPhone 13']], ['Chrome', chromium, { viewport: { width: 1440, height: 900 } }]]) {
    const browser = await engine.launch({ headless: true, ...(name === 'Chrome' ? { channel: 'chrome' } : {}) });
    try {
      const page = await browser.newPage(options);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Safari puede aplazar la precarga. El arranque no debe depender de canplay.
      await page.addInitScript(() => {
        const original = HTMLVideoElement.prototype.addEventListener;
        HTMLVideoElement.prototype.addEventListener = function (type, ...args) {
          if (type === 'canplay') return;
          return original.call(this, type, ...args);
        };
        window.introColors = [];
        const sample = () => {
          const hero = document.querySelector('.hero');
          if (hero) window.introColors.push(getComputedStyle(hero).backgroundColor);
          if (window.introColors.length < 240) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await openGate(page);
      await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.05, null, { timeout: 6000 });
      await page.screenshot({ path: `/tmp/intro-${name.split(' ')[0]}-playing.png` });
      await page.waitForSelector('html.ao3d-revealing');
      await page.screenshot({ path: `/tmp/intro-${name.split(' ')[0]}-handoff.png` });
      await page.waitForSelector('.ao-intro', { state: 'detached' });
      assert.deepEqual(await page.evaluate(() => [...new Set(window.introColors)]), ['rgb(17, 18, 16)'], 'Background must remain constant throughout the entry');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/intro-${name.split(' ')[0]}.png` });
      console.log(`OK ${name}: playback without canplay, constant background, handoff without JS errors`);
      await page.close();
      const blocked = await browser.newPage(options);
      await blocked.addInitScript(() => {
        // Solo el video: la pista de sonido tiene su propio camino y no debe
        // comerse este rechazo.
        const original = HTMLMediaElement.prototype.play;
        let first = true;
        HTMLMediaElement.prototype.play = function () {
          if (first && this instanceof HTMLVideoElement) {
            first = false;
            return Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
          }
          return original.call(this);
        };
      });
      await blocked.goto(url, { waitUntil: 'domcontentloaded' });
      await openGate(blocked);
      await blocked.getByRole('button', { name: 'Reproducir', exact: true }).click();
      await blocked.waitForSelector('.ao-intro.is-playing');
      await blocked.waitForSelector('.ao-intro', { state: 'detached' });
      console.log(`OK ${name}: manual playback after autoplay rejection`);
      await blocked.close();
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
