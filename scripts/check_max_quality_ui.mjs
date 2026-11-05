// The "Max quality" status and result badge on the real product page, real WebGPU.
// Needs the loopback lab server (scripts/serve_photo4x_lab.mjs) serving a fresh dist/.
import {mkdir, readFile, writeFile} from 'node:fs/promises';

const {chromium} = await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: false,
  ...(process.env.USCALE_CHROMIUM_PATH ? {executablePath: process.env.USCALE_CHROMIUM_PATH} : {})});
const directory = new URL('../.web-model-work/photo4x/results/max-quality-ui/', import.meta.url);
await mkdir(directory, {recursive: true});
const shot = name => new URL(`${name}.png`, directory).pathname;
const buffer = await readFile(new URL('../.web-model-work/photo4x/inputs/girls_blured.jpg', import.meta.url));
const report = {createdAt: new Date().toISOString(), browserVersion: browser.version(), cases: [], errors: []};

// Every status change (detail text, chip, gold class) and every finished model, in order.
const recorder = () => {
  localStorage.setItem('uscale-consent', JSON.stringify({v: 1, analytics: false}));
  window.__ui = {status: [], done: []};
  const Original = Worker;
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({data}) => {
        if (data.type === 'done') window.__ui.done.push(data.variant?.id || 'srvgg');
      });
    }
  };
  addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('status'), chip = document.getElementById('quality-chip');
    let last;
    const record = () => {
      const entry = {detail: document.getElementById('status-detail').textContent, chip: !chip.hidden,
        max: status.classList.contains('is-max'), busy: status.classList.contains('is-busy')};
      const key = JSON.stringify(entry);
      if (key !== last) { last = key; window.__ui.status.push(entry); }
    };
    new MutationObserver(record).observe(status, {subtree: true, childList: true, characterData: true, attributes: true});
    record();
  });
};

async function open(context, lang) {
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(`${lang}: ${e.message}`));
  await page.goto(`http://127.0.0.1:4189/${lang === 'en' ? '' : `${lang}/`}upscale/?mode=device`);
  return page;
}

async function run(page, {scale, model = 'photo'}) {
  await page.evaluate(() => { window.__ui.status.length = 0; });
  await page.locator('#photo-input').setInputFiles({name: 'input.jpg', mimeType: 'image/jpeg', buffer});
  await page.locator(`#model-${model}`).click();
  await page.locator(`#scale-${scale}x`).click();
  if (model === 'photo') await page.locator('#enhance-faces').uncheck();
  await page.locator('#process-photo').click();
}

const finished = page => page.locator('#results').waitFor({state: 'visible', timeout: 180_000});
const resultState = page => page.evaluate(() => {
  const tag = document.getElementById('result-tag'), note = document.getElementById('quality-note');
  const status = document.getElementById('status'), chip = document.getElementById('quality-chip');
  return {model: window.__ui.done.at(-1), tag: tag.textContent, tagMax: tag.classList.contains('is-max'), noteShown: !note.hidden,
    idleChip: !chip.hidden, idleMax: status.classList.contains('is-max'), history: window.__ui.status};
});
function check(name, passed, details) {
  report.cases.push({name, passed, ...details});
  if (!passed) throw Error(`${name} failed: ${JSON.stringify(details).slice(0, 2000)}`);
  console.log(`Passed ${name}`);
}

try {
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, colorScheme: 'dark'});
  await context.addInitScript(recorder);
  const page = await open(context, 'ru');
  const probeText = await page.evaluate(() => JSON.parse(document.getElementById('tool-strings').textContent).max_quality_checking_detail);

  // Photo 4×: checking text, then the gold status, then the gold result badge.
  await run(page, {scale: 4});
  await page.locator('#quality-chip').waitFor({state: 'visible', timeout: 120_000});
  await page.waitForTimeout(1500);
  await page.locator('#status').screenshot({path: shot('status-4x-dark')});
  await finished(page);
  let state = await resultState(page);
  check('success-4x', state.model === 'nomos-realplksr' && state.tagMax && state.noteShown && !state.idleChip && !state.idleMax &&
    state.history.some(s => s.detail.includes(probeText) && !s.chip) && state.history.some(s => s.chip && s.max && s.busy), state);
  await page.waitForTimeout(2500);
  await page.locator('#results').screenshot({path: shot('result-4x-dark')});

  // A new run on the same page starts without gold until its own forecast allows it.
  await run(page, {scale: 2});
  await finished(page);
  state = await resultState(page);
  const firstGold = state.history.findIndex(s => s.chip);
  check('success-2x-new-run', state.model === 'nomos-realplksr' && state.tagMax && state.tag.includes('2×') &&
    firstGold > 0 && !state.history.slice(0, firstGold).some(s => s.max), state);

  // Light theme and reduced motion on the same result.
  await page.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
  await page.locator('#results').screenshot({path: shot('result-2x-light')});
  const animations = await page.evaluate(() => getComputedStyle(document.querySelector('#result-tag')).animationName);
  check('reduced-motion', animations === 'none', {animations});
  await page.emulateMedia({colorScheme: 'dark', reducedMotion: 'no-preference'});

  // Drawing never uses the heavier model: no chip at any stage, a plain result.
  await run(page, {scale: 4, model: 'drawing'});
  await finished(page);
  state = await resultState(page);
  check('drawing', state.model === 'srvgg' && !state.tagMax && !state.noteShown && !state.history.some(s => s.chip || s.max), state);
  await page.close();

  // Late fallback: gold is showing, then the real five-minute budget timer fires.
  const fallback = await browser.newContext({viewport: {width: 1280, height: 1000}, colorScheme: 'dark'});
  await fallback.addInitScript(recorder);
  await fallback.clock.install();
  const late = await open(fallback, 'ru');
  await run(late, {scale: 4});
  await late.locator('#quality-chip').waitFor({state: 'visible', timeout: 120_000});
  await late.clock.fastForward('05:01');
  await late.locator('#quality-chip').waitFor({state: 'hidden', timeout: 30_000});
  const during = await late.evaluate(() => ({busy: document.getElementById('status').classList.contains('is-busy'),
    max: document.getElementById('status').classList.contains('is-max')}));
  await finished(late);
  state = await resultState(late);
  check('late-fallback', during.busy && !during.max && state.model === 'srvgg' && !state.tagMax && !state.noteShown &&
    state.history.some(s => s.chip) && state.history.at(-1).chip === false, {...state, during});
  await fallback.close();

  // Phone width: both image tags fit side by side in the longest locales.
  const phone = await browser.newContext({viewport: {width: 375, height: 812}, colorScheme: 'dark'});
  await phone.addInitScript(recorder);
  for (const lang of ['ru', 'de']) {
    const small = await open(phone, lang);
    await run(small, {scale: 4});
    await small.locator('#quality-chip').waitFor({state: 'visible', timeout: 120_000});
    await small.waitForTimeout(800);
    await small.locator('#status').screenshot({path: shot(`status-4x-${lang}-375`)});
    await finished(small);
    await small.waitForTimeout(2500);
    const tags = await small.evaluate(() => {
      const [l, r] = ['.result-comparison .cmp-tag.l', '#result-tag'].map(s => document.querySelector(s).getBoundingClientRect());
      const tag = document.getElementById('result-tag');
      return {gap: r.left - l.right, truncated: tag.scrollWidth > tag.clientWidth, text: tag.textContent};
    });
    await small.locator('#results').screenshot({path: shot(`result-4x-${lang}-375`)});
    check(`phone-${lang}`, tags.gap >= 8 && !tags.truncated, tags);
    await small.close();
  }
  await phone.close();
  report.passed = report.errors.length === 0;
} catch (error) { report.passed = false; report.error = error.message; process.exitCode = 1; }
finally { await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(`Max quality UI: ${report.passed ? 'passed' : 'FAILED'} (${new URL('report.json', directory).pathname})`);
