const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const openGate = require('./open-gate.cjs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [width, height] of [[1440, 900], [1920, 1080], [2560, 1440], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(process.argv[2] || 'http://localhost:8000', { waitUntil: 'domcontentloaded' });
      await openGate(page);
      await page.waitForSelector('.ao-intro.is-playing');
      const first = await page.evaluate(() => ({
        heroBottom: document.querySelector('.hero').getBoundingClientRect().bottom,
        videoWidth: document.querySelector('video').getBoundingClientRect().width,
        canvas: document.querySelector('.ao3d-canvas').getBoundingClientRect().toJSON(),
        parent: document.querySelector('.ao3d-canvas').parentElement.className
      }));
      if (width > 760) {
        assert.ok(Math.abs(first.heroBottom - height) <= 1, `Hero must fill viewport at ${width}×${height}: ${first.heroBottom}`);
        assert.ok(first.videoWidth <= 1100, `Desktop video is oversized: ${first.videoWidth}`);
      }
      assert.equal(first.parent, 'hero', 'Keep the WebGL canvas in its final container during playback');
      await page.waitForSelector('html.ao3d-revealing');
      assert.equal(await page.locator('.ao3d-canvas').evaluate(el => getComputedStyle(el).opacity), '1', 'Replacement frame must be fully visible before fading the video');
      await page.waitForSelector('.ao-intro', { state: 'detached' });
      const last = await page.locator('.ao3d-canvas').evaluate(el => el.getBoundingClientRect().toJSON());
      assert.deepEqual(last, first.canvas, 'Handoff must not resize or move the canvas');
      await page.screenshot({ path: `/tmp/portfolio-fixed-${width}.png` });
      if (width === 1440) {
        await page.setViewportSize({ width: 2560, height: 1440 });
        await page.waitForFunction(() => Math.abs(document.querySelector('.hero').getBoundingClientRect().bottom - innerHeight) <= 1);
        assert.equal(await page.locator('.ao3d-canvas').evaluate(el => Math.round(el.getBoundingClientRect().width)), 2560);
      }
      console.log(`OK: stable canvas and proportions at ${width}×${height}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
