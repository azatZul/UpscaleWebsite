import {mkdir, readFile, writeFile} from 'node:fs/promises';
const {chromium} = await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: false});
const page = await browser.newPage({viewport: {width: 1280, height: 1000}});
const directory = new URL('../.web-model-work/photo4x/results/integration-ui/', import.meta.url);
await mkdir(directory, {recursive: true});
const report = {createdAt: new Date().toISOString(), browserVersion: browser.version(), cases: [], errors: []};
page.on('pageerror', e => report.errors.push(e.message));
try {
  await page.addInitScript(() => {
    localStorage.setItem('uscale-consent', JSON.stringify({v: 1, analytics: false}));
    window.__photo4xUi = [];
    const Original = Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({data}) => {
          if (data.type === 'done') window.__photo4xUi.push({model: data.variant?.id || 'srvgg',
            warmupMs: data.warmupMs, calibrationMs: data.calibrationMs, profileReused: data.profileReused,
            mime: data.blob.type, forecast: data.forecast, output: [data.plan.outputWidth, data.plan.outputHeight]});
        });
      }
    };
  });
  const buffer = await readFile(new URL('../.web-model-work/photo4x/inputs/girls_blured.jpg', import.meta.url));
  for (const name of ['first-visit', 'return-visit']) {
    await page.goto('http://127.0.0.1:4189/upscale/?mode=device&analytics_debug=1');
    await page.locator('#photo-input').setInputFiles({name: 'input.jpg', mimeType: 'image/jpeg', buffer});
    await page.locator('#scale-4x').click();
    await page.locator('#enhance-faces').uncheck();
    await page.locator('#process-photo').click();
    await page.locator('#results').waitFor({state: 'visible', timeout: 120_000});
    const result = await page.evaluate(() => ({...window.__photo4xUi.at(-1),
      profiles: Object.keys(localStorage).filter(k => k.startsWith('uscale-photo4x-profile-v1-')).length}));
    const passed = result.model === 'nomos-realplksr' && result.profiles > 0 && result.mime === 'image/jpeg' &&
      result.output.join('x') === '1864x2800' && (name !== 'return-visit' || result.profileReused && result.warmupMs > 0 && result.calibrationMs === 0);
    report.cases.push({name, ...result, passed});
    if (!passed) throw Error(`Product UI failed: ${name}: ${JSON.stringify(result)}`);
  }
  await page.locator('#results').screenshot({path: new URL('result.png', directory).pathname});
  report.passed = report.errors.length === 0;
} catch (error) { report.passed = false; report.error = error.message; process.exitCode = 1; }
finally { await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(`Photo4x product UI: ${report.passed ? 'passed' : 'FAILED'} (${new URL('report.json', directory).pathname})`);
