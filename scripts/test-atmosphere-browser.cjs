const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && /shader|WebGL/i.test(message.text())) errors.push(message.text()); });
      await page.route('**/hero3d.js*', async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace('introTimeline = gsap.timeline(',
          'window.heroTest = { ctx, intro, goldStart, greenStart }; introTimeline = window.heroTest.timeline = gsap.timeline(')
          .replace("defaults: { ease: 'power2.inOut' }, onUpdate: updateIntroFrame", "paused: true, defaults: { ease: 'power2.inOut' }, onUpdate: updateIntroFrame");
        await route.fulfill({ response, body });
      });
      await page.goto(process.argv[2] || 'http://localhost:8000', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.heroTest?.timeline);
      const gold = await page.evaluate(() => {
        const { ctx, timeline, goldStart } = window.heroTest;
        timeline.seek(goldStart + 0.25, false);
        ctx.composer.render();
        return { frame: ctx.handoff.uniforms.mixAmount.value, green: ctx.uniforms.uEnvironmentMix.value, air: ctx.atmosphere.intensity.value };
      });
      assert.deepEqual(gold, { frame: 0, green: 0, air: 0 }, 'A real golden 3D phase must precede green and atmosphere');
      await page.screenshot({ path: `/tmp/atmosphere-gold-${viewport.width}.png` });
      for (const progress of [0.3, 0.5, 0.7]) {
        await page.evaluate(progress => {
          const { ctx, timeline, greenStart } = window.heroTest;
          timeline.seek(greenStart + progress * 1.35, false);
          ctx.composer.render();
        }, progress);
        await page.screenshot({ path: `/tmp/metal-wave-${viewport.width}-${progress}.png` });
      }
      await page.evaluate(() => { window.heroTest.timeline.progress(1, false); });
      await page.waitForSelector('.ao-intro', { state: 'detached' });
      await page.evaluate(() => {
        const { ctx } = window.heroTest;
        const burst = ctx.atmosphere.burst;
        window.heroTest.bursts = 0;
        ctx.atmosphere.burst = (...args) => { window.heroTest.bursts++; burst(...args); };
      });
      await page.mouse.click(viewport.width * 0.7, 170);
      assert.equal(await page.evaluate(() => window.heroTest.bursts), 1, 'A short click releases nearby particles');
      await page.mouse.move(viewport.width * 0.7, 170);
      await page.mouse.down();
      await page.mouse.move(viewport.width * 0.7 - 80, 200, { steps: 12 });
      await page.mouse.up();
      assert.equal(await page.evaluate(() => window.heroTest.bursts), 1, 'Dragging the sculpture must not trigger a burst');
      await page.getByRole('link', { name: 'Descubre mi trabajo' }).click();
      assert.equal(await page.evaluate(() => window.heroTest.bursts), 1, 'Links keep their normal behavior');
      await page.evaluate(() => scrollTo(0, 0));
      const independent = await page.evaluate(() => {
        const { ctx } = window.heroTest;
        const air = ctx.scene.getObjectByName('hero-atmosphere');
        return air.parent === ctx.scene && air.rotation.x === 0 && air.rotation.y === 0;
      });
      assert.ok(independent, 'Atmosphere must live outside the sculpture transform');
      await page.screenshot({ path: `/tmp/atmosphere-final-${viewport.width}.png` });
      await page.close();
      console.log(`OK ${viewport.width}: golden 3D, independent atmosphere, click/drag/link interactions`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
