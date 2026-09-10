const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport });
      await page.route('**/hero3d.js*', async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace('    matchVideoPose();\n    handoff.enabled = true;\n    composer.render();', `
      matchVideoPose();
      handoff.enabled = true;
      const compiledBeforeJoin = renderer.info.programs.length;
      composer.render();
      window.surfaceJoin = { before: compiledBeforeJoin, after: renderer.info.programs.length };
      requestAnimationFrame(() => { window.surfaceJoin.videoOpacity = intro.video.style.opacity; });`);
        await route.fulfill({ response, body });
      });
      await page.goto(process.argv[2] || 'http://localhost:8000', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.surfaceJoin?.videoOpacity !== undefined);
      const join = await page.evaluate(() => window.surfaceJoin);
      assert.equal(join.after, join.before, 'Handoff must not compile a shader when the video ends');
      assert.notEqual(join.videoOpacity, '0', 'Keep the original video visible until the surface crossfade');
      await page.waitForSelector('.ao-intro', { state: 'detached' });
      console.log(`OK ${viewport.width}: precompiled handoff and gradual surface replacement`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
