// Compare the actual decoded last frame with the first composited frame.
// NODE_PATH=/path/to/node_modules node scripts/test-hero-handoff.cjs [URL]
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const assert = require('node:assert/strict');
const openGate = require('./open-gate.cjs');
function sculptureBounds(png, bottom = png.height) {
  let left = png.width, right = 0;
  for (let y = 80; y < bottom; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    if (Math.max(...png.data.subarray(i, i + 3)) > 90) {
      left = Math.min(left, x); right = Math.max(right, x);
    }
  }
  return { width: right - left, center: (left + right) / 2 };
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [375, 667]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      // Pause only the handoff, keeping real video decoding, shaders and layout.
      await page.route('**/hero3d.js*', async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace('introTimeline = gsap.timeline(',
          'window.handoff = { ctx, intro }; introTimeline = window.handoff.timeline = gsap.timeline(')
          .replace('defaults: { ease:', 'paused: true, defaults: { ease:');
        await route.fulfill({ response, body });
      });
      await page.goto(process.argv[2] || 'http://localhost:8000', { waitUntil: 'domcontentloaded' });
      await openGate(page);
      await page.waitForFunction(() => !!window.handoff?.timeline);
      await page.evaluate(() => {
        document.querySelector('.ao3d-canvas').style.opacity = '0';
        window.handoff.intro.video.style.opacity = '1';
      });
      const original = PNG.sync.read(await page.screenshot());
      await page.evaluate(() => {
        document.querySelector('.ao3d-canvas').style.opacity = '1';
        window.handoff.timeline.seek(0.001, false);
        window.handoff.intro.video.style.opacity = '0';
        window.handoff.intro.overlay.querySelector('.ao-intro-backdrop').style.opacity = '0';
        window.handoff.ctx.composer.render();
      });
      const replacement = PNG.sync.read(await page.screenshot());
      require('node:fs').writeFileSync(`/tmp/handoff-original-${width}.png`, PNG.sync.write(original));
      require('node:fs').writeFileSync(`/tmp/handoff-replacement-${width}.png`, PNG.sync.write(replacement));
      let changed = 0, foreground = 0;
      for (let y = 80; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        if (Math.max(...original.data.subarray(i, i + 3)) > 50) {
          foreground++;
          // DOM video and WebGL rasterize subpixels differently. Match within
          // a one-pixel footprint, still catching missing reflections/patches.
          let difference = 255;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const j = i + (dy * width + dx) * 4;
            difference = Math.min(difference, Math.max(...[0, 1, 2].map(c => Math.abs(original.data[i + c] - replacement.data[j + c]))));
          }
          if (difference > 50) changed++;
        }
      }
      assert.ok(changed / foreground < 0.02, `${width}: handoff changes ${(100 * changed / foreground).toFixed(1)}% of the sculpture pixels`);
      for (const time of [0.3, 0.6, 1.06]) {
        await page.evaluate(t => window.handoff.timeline.seek(t, false) && undefined, time);
        const shot = PNG.sync.read(await page.screenshot({ path: `/tmp/handoff-${width}-${time}.png` }));
        if (width < 760 && time === 1.06) {
          const initial = sculptureBounds(original);
          const moving = sculptureBounds(shot, Math.min(330, height * 0.45));
          assert.ok(moving.width < initial.width * 0.88, 'Mobile sculpture must visibly shrink while rising');
          assert.ok(moving.width > initial.width * 0.65, 'Keep the sculpture present above the title');
          assert.ok(Math.abs(moving.center - width / 2) < width * 0.025, 'Keep the mobile trajectory centered');
        }
      }
      await page.evaluate(() => { window.handoff.timeline.progress(1, false); });
      await page.waitForSelector('.ao-intro', { state: 'detached' });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      console.log(`OK ${width}×${height}: last frame continuity and completed handoff`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
