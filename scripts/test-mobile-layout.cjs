const { webkit, devices } = require('playwright');
const assert = require('node:assert/strict');
const openGate = require('./open-gate.cjs');
(async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    for (const [width, height] of [[375,667],[390,844],[360,640],[320,568],[430,932],[844,390]]) {
      const page = await browser.newPage({ ...devices['iPhone 13'], viewport: { width, height }, deviceScaleFactor: 1 });
      await page.goto(process.argv[2] || 'http://localhost:8000', { waitUntil: 'domcontentloaded' });
      await openGate(page);
      await page.waitForSelector('.ao-intro', { state: 'detached' });
      const box = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { hero: rect('.hero'), title: rect('.hero h1'), content: rect('.hero-content'), button: rect('.hero .pill'), width: document.documentElement.scrollWidth };
      });
      assert.ok(box.button.bottom <= box.hero.bottom - 12, `CTA clipped at ${width}×${height}: ${JSON.stringify(box)}`);
      assert.ok(box.width <= width, 'No horizontal overflow');
      if (width === 390) assert.ok(box.content.top < 390, 'Text should sit higher on a standard iPhone');
      await page.screenshot({ path: `/tmp/mobile-fixed-${width}-${height}.png` });
      await page.locator('.mobile-nav>summary').click();
      const contact = page.locator('.mobile-nav .nav-contact');
      await contact.scrollIntoViewIfNeeded();
      const reachable = await contact.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
      assert.ok(reachable, `Contact menu link unreachable at ${width}×${height}`);
      await contact.click();
      await page.waitForFunction(() => Math.abs(document.querySelector('.contact').getBoundingClientRect().top - document.querySelector('.header').getBoundingClientRect().bottom) < 4);
      console.log(`OK ${width}×${height}: complete CTA, higher text, contact navigation`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
