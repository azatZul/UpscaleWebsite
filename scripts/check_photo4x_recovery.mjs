import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const playwright = await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await playwright.chromium.launch({headless: false});
const work = resolve('.web-model-work/photo4x');
const manifest = JSON.parse(await readFile(`${work}/manifest.json`, 'utf8'));
const variant = {...manifest.models.find(m => m.id === 'nomos-esrgan' && m.tileSize === 256 && m.precision === 'fp32'), overlap: 32};
const winner = {...manifest.models.find(m => m.id === 'nomos-realplksr' && m.tileSize === 256 && m.precision === 'fp16'), overlap: 32};
const page = await browser.newPage();
const requests = [];
page.on('request', r => { if (r.url().endsWith('.onnx')) requests.push(r.url()); });
const report = {createdAt: new Date().toISOString(), checks: []};
try {
  await page.goto('http://127.0.0.1:4189/lab/?benchmark=1');
  await page.waitForFunction(() => window.uscaleProductLab);
  for (const mode of ['download', 'hash', 'requirements', 'budget', 'missing-evidence', 'mobile', 'cpu', 'drawing', 'scale2', 'transparent', 'cancel', 'accepted', 'accepted-transparent']) {
    requests.length = 0;
    const result = await page.evaluate(async ({mode, variant, winner}) => {
      const blob = await (await fetch('/photo4x/inputs/girls_blured.jpg')).blob();
      let file = new File([blob], 'input.jpg', {type: 'image/jpeg'});
      if (mode.includes('transparent')) file = await uscaleProductLab.makePngFixture('gradient', 65, 47);
      const accepted = mode.startsWith('accepted') || mode === 'scale2';
      const candidate = {...(accepted || mode === 'cancel' ? winner : variant),
        ...(accepted ? {configuration: 'test', costEvidence: {buckets: [{configuration: 'test', evidence: 'injected acceptance test',
          mime: 'image/png', maxOutputPixels: 10_000_000, assemblyMs: 3000, exportMs: 1000}]}} : {}),
        ...(mode === 'download' ? {url: '/photo4x/models/does-not-exist.onnx'} : {}),
        ...(mode === 'hash' ? {sha256: '0'.repeat(64)} : {}),
        ...(mode === 'requirements' ? {requires: {features: ['unsupported-test-feature']}} : {}),
        ...(mode === 'budget' ? {configuration: 'test', costEvidence: {buckets: [{configuration: 'test', evidence: 'injected test',
          mime: 'image/png', maxOutputPixels: 10_000_000, assemblyMs: 300_001, exportMs: 0}]}} : {})};
      const fallback = {backend: 'webgpu', threads: 1};
      const choices = [{backend: mode === 'cpu' ? 'wasm' : 'webgpu', threads: 1, variant: candidate, modelFallback: true}, fallback];
      const transitions = [];
      const abort = new AbortController();
      const request = {type: 'prepare', file, scale: mode === 'scale2' ? 2 : 4, modelKind: mode === 'drawing' ? 'drawing' : 'photo', benchmark: {lossless: true}};
      if (mode === 'mobile') {
        // All choices are candidate-only: mobile rejection must precede fetch.
        choices.splice(1);
        request.environment = {userAgent: 'iPhone', webgpu: true};
      }
      if (['cpu', 'drawing'].includes(mode)) choices.splice(1);
      try {
        const output = await uscaleProductLab.runProductWorker(request, {choices,
          signal: abort.signal, onProgress: data => {
            if (data.type === 'forecast') transitions.push(data.forecast.reason);
            if (mode === 'cancel' && data.operation === 'probe') abort.abort();
          }});
        return {ok: true, variant: output.variant?.id, mime: output.blob.type, size: [output.plan.outputWidth, output.plan.outputHeight],
          inputSize: [output.plan.width, output.plan.height],
          forecast: transitions, hasTransparency: output.hasTransparency};
      } catch (error) { return {ok: false, code: error.code, name: error.name}; }
    }, {mode, variant, winner});
    const modelRequests = [...requests];
    const candidateFetches = modelRequests.filter(u => u.includes('/photo4x/models/'));
    const rejectBeforeFetch = ['mobile', 'cpu', 'drawing'].includes(mode);
    const passed = rejectBeforeFetch ? !result.ok && candidateFetches.length === 0
      : mode === 'cancel' ? !result.ok && result.name === 'AbortError' && modelRequests.length === candidateFetches.length
      : mode.startsWith('accepted') || mode === 'scale2' ? result.ok && result.variant === winner.id && result.forecast.includes('within-budget') &&
        modelRequests.length === candidateFetches.length && (mode !== 'accepted-transparent' || result.mime === 'image/png' && result.hasTransparency) &&
        (mode !== 'scale2' || result.size.every((side, index) => side === result.inputSize[index] * 2))
      : result.ok && !result.variant && (mode !== 'transparent' || result.mime === 'image/png' && result.hasTransparency);
    report.checks.push({mode, result, modelRequests, passed});
    if (!passed) throw Error(`Failed ${mode}`);
  }
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.message; process.exitCode = 1; }
finally { await writeFile(`${work}/recovery.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(`Photo4x recovery: ${report.passed ? 'passed' : 'FAILED'}`);
