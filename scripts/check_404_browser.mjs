const {chromium} = await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({headless: true, ...(process.env.USCALE_TEST_CHANNEL ? {channel: process.env.USCALE_TEST_CHANNEL} : {})});
const origin = process.env.USCALE_TEST_ORIGIN || 'http://localhost:8787';
const results = [];
const scenarios = [
  {name: 'dark', colorScheme: 'dark'},
  {name: 'mobile-reduced', colorScheme: 'light', reducedMotion: 'reduce', viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true},
  {name: 'no-js', javaScriptEnabled: false, colorScheme: 'light'},
  {name: 'no-sharp-context', canvasFailure: 'error-sharp'},
  {name: 'no-pixels-context', canvasFailure: 'error-pixels'},
  {name: 'no-sample-context', canvasFailure: 'sample'},
  {name: 'blocked-readback', canvasFailure: 'readback'},
];

try {
  for (const {name, canvasFailure, ...config} of scenarios) {
    const context = await browser.newContext(config);
    try {
      if (canvasFailure) await context.addInitScript(failure => {
        if (failure === 'readback') {
          CanvasRenderingContext2D.prototype.getImageData = function () {
            throw new DOMException('Canvas readback unavailable', 'SecurityError');
          };
        } else {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (...args) {
            if (failure === 'sample' ? !this.className : this.classList.contains(failure)) return null;
            return getContext.apply(this, args);
          };
        }
      }, canvasFailure);
      const page = await context.newPage();
      const external = [], errors = [], bad = [];
      page.on('request', r => { if (new URL(r.url()).origin !== origin) external.push(r.url()); });
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => {
        if (r.request().resourceType() !== 'document' && r.status() !== 200) bad.push([r.status(), r.url()]);
      });
      const response = await page.goto(origin + '/ru/upscale/foo');
      assert.equal(response.status(), 404);
      assert.equal(response.headers()['cross-origin-embedder-policy'], 'require-corp');
      const slider = page.locator('#clarity');
      const comparison = page.locator('.error-comparison');
      const waitForSplit = target => page.waitForFunction(value => {
        const split = document.querySelector('.error-comparison').style.getPropertyValue('--split');
        return Math.abs(parseFloat(split) - value) < .05;
      }, target);
      if (name === 'no-js' || canvasFailure) {
        assert.equal(await slider.isDisabled(), true);
        assert.equal(await page.locator('.error-fallback').isVisible(), true);
        assert.equal(await comparison.evaluate(el => el.classList.contains('is-live')), false);
        assert.equal(await page.locator('.error-stores a').count(), 3);
      } else if (name === 'mobile-reduced') {
        assert.equal(await slider.inputValue(), '50');
        await page.waitForTimeout(2200);
        assert.equal(await slider.inputValue(), '50');
        const bounds = await comparison.boundingBox();
        const target = 80 / bounds.width * 100;
        await comparison.tap({position: {x: 80, y: 40}});
        await page.waitForFunction(() => document.querySelector('#clarity').value !== '50');
        assert.equal(await slider.inputValue(), String(Math.round(target)));
        await waitForSplit(target);
      } else {
        await slider.focus();
        await slider.press('End');
        await waitForSplit(100);
        assert.equal(await slider.inputValue(), '100');
        await slider.press('Home');
        await waitForSplit(0);
        assert.equal(await slider.inputValue(), '0');
        for (let value = 1; value <= 21; value++) {
          await slider.press('ArrowRight');
          await page.evaluate(() => new Promise(requestAnimationFrame));
          assert.equal(await slider.inputValue(), String(value), 'Animation must preserve native keyboard steps');
        }
        await waitForSplit(21);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(bad, []);
      results.push({name, status: response.status(), external, errors, bad, passed: true});
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile('docs/seo-release/404-browser-qa.json', JSON.stringify(results, null, 2) + '\n');
console.log(results);
