import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PHOTO4X_RELEASE} from '../src/tool/photo4x-release.js';
import {ASSETS} from '../src/tool/assets.generated.js';

const playwright = await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await playwright.chromium.launch({headless: false,
  ...(process.env.USCALE_CHROMIUM_PATH ? {executablePath: process.env.USCALE_CHROMIUM_PATH} : {})});
const page = await browser.newPage();
const label = process.env.USCALE_PHOTO4X_OUTPUT || 'integration';
if (!/^[\w.-]+$/.test(label)) throw Error('Use a local output label');
const root = new URL(`../.web-model-work/photo4x/results/${label}/`, import.meta.url);
await mkdir(root, {recursive: true});
const report = {createdAt: new Date().toISOString(), browser: browser.version(), release: PHOTO4X_RELEASE,
  memory: {vram: null, reason: 'WebGPU does not expose reliable free/process VRAM'}, cases: [], errors: []};
const persist = () => writeFile(new URL('report.json', root), JSON.stringify(report, null, 2) + '\n');
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') console.log(`Browser: ${m.text().slice(0, 500)}`); });
const requests = [];
page.on('request', r => { if (/\.onnx(?:$|\?)/.test(r.url())) requests.push(r.url()); });
const origin = 'http://127.0.0.1:4189';
try {
  // Public pinned GFPGAN is served locally, never send a private photo outside.
  const faceSpec = JSON.parse(await readFile(new URL('../src/tool/face-model.json', import.meta.url), 'utf8'));
  const face = await readFile(new URL('../.web-model-work/photo4x/models/face_512.onnx', import.meta.url));
  if (createHash('sha256').update(face).digest('hex') !== faceSpec.sha256) throw Error('GFPGAN pin mismatch');
  await page.context().grantPermissions(['local-network-access']);
  await page.context().route(faceSpec.url, route => route.fulfill({status: 307, headers: {
    Location: `${origin}/photo4x/models/face_512.onnx`, 'Access-Control-Allow-Origin': '*'}}));
  await page.goto(`${origin}/lab/?benchmark=1`);
  await page.waitForFunction(() => window.uscaleProductLab?.automaticPhoto4x);
  report.environment = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    if (!a || a.isFallbackAdapter || !a.features.has('shader-f16')) throw Error('Real hardware FP16 adapter required');
    return {userAgent: navigator.userAgent, vendor: a.info.vendor, architecture: a.info.architecture,
      features: [...a.features], limits: {maxBufferSize: a.limits.maxBufferSize, maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize}};
  });
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('uscale-photo4x-')) localStorage.removeItem(k); });
  await page.exposeFunction('integrationSave', (name, data) => writeFile(new URL(name, root), Buffer.from(data, 'base64')));
  await page.exposeFunction('integrationProgress', text => console.log(text));
  const cases = process.env.USCALE_PHOTO4X_CASES?.split(',') || ['cold', 'next-day', 'large', 'transparent', 'transparent-cached', 'faces', 'faces-cached', 'cancel-calibration', 'download-fallback', 'hash-fallback', 'reference-fallback', 'scale2', 'drawing', 'cpu'];
  for (const name of cases) {
    if (name === 'next-day') {
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage).filter(k => k.startsWith('uscale-photo4x-profile-'))) {
          const value = JSON.parse(localStorage.getItem(key)); value.updatedAt -= 86_400_000;
          localStorage.setItem(key, JSON.stringify(value));
        }
      });
      await page.reload(); await page.waitForFunction(() => window.uscaleProductLab?.automaticPhoto4x);
    }
    requests.length = 0;
    console.log(`Integration: ${name}`);
    await page.bringToFront();
    const result = await page.evaluate(async ({name, release}) => {
      integrationProgress(`${name}: fetching input`);
      let file = new File([await (await fetch(`/photo4x/inputs/${name === 'large' ? 'camera12mp.jpg' : 'girls_blured.jpg'}`)).blob()], 'input.jpg', {type: 'image/jpeg'});
      integrationProgress(`${name}: input ready`);
      if (name.startsWith('transparent')) file = await uscaleProductLab.makePngFixture('gradient', 65, 47);
      if (['drawing', 'cpu', 'cancel-calibration'].includes(name)) file = await uscaleProductLab.makePngFixture('gradient', 79, 61);
      const events = [], abort = new AbortController();
      if (name === 'download-fallback') release = {...release, winner: {...release.winner, revision: 'test-download', url: '/assets/processor/does-not-exist.onnx'}};
      // Same bytes under another revision: no matching reference, so the warm-up check must fail closed.
      if (name === 'reference-fallback') release = {...release, winner: {...release.winner, revision: 'test-reference'}};
      if (name === 'hash-fallback') release = {...release, winner: {...release.winner, revision: 'test-hash', sha256: '0'.repeat(64)}};
      let faceResults;
      if (name.startsWith('faces')) {
        window.integrationFaces ||= await uscaleProductLab.runProductWorker({file}, {group: 'faces', backend: 'webgpu'});
        faceResults = window.integrationFaces;
      }
      const start = performance.now();
      const timeout = setTimeout(() => abort.abort(), name === 'large' ? 180_000 : 90_000);
      let lastOperation, reference;
      try {
        const out = await uscaleProductLab.automaticPhoto4x(file, {release, signal: abort.signal, faceResults,
          scale: name === 'scale2' ? 2 : 4, modelKind: name === 'drawing' ? 'drawing' : 'photo', forceCpu: name === 'cpu',
          lossless: name !== 'large', onProgress: d => {
            if (d.operation !== lastOperation) { lastOperation = d.operation; integrationProgress(`${name}: ${d.operation}`); }
            if (d.type === 'photo4x-reference') reference = {passed: d.passed, meanError: d.meanError, maxError: d.maxError};
            if (d.type === 'forecast') events.push({type: d.type, forecast: d.forecast, cached: d.cached, probes: d.probeTimes});
            if (d.type === 'status' && ['probe', 'calibrate'].includes(d.operation)) events.push({operation: d.operation, completed: d.completed});
            if (name === 'cancel-calibration' && d.operation === 'calibrate') abort.abort();
          },
        });
        if (['cold', 'next-day', 'transparent', 'faces', 'scale2'].includes(name)) {
          const bytes = new Uint8Array(await out.blob.arrayBuffer()); let s = '';
          for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
          await integrationSave(`${name}.png`, btoa(s));
        }
        return {ok: true, model: out.variant?.id || 'srvgg', wallMs: performance.now() - start, warmupMs: out.warmupMs,
          calibrationMs: out.calibrationMs, profileReused: out.profileReused, forecast: out.forecast,
          upscaleExportMs: out.upscaleExportMs, runtimeTimings: out.runtimeTimings, mime: out.blob.type,
          dimensions: [out.plan.outputWidth, out.plan.outputHeight], faceCount: out.faceCount,
          inputDimensions: [out.plan.width, out.plan.height], hasTransparency: out.hasTransparency, canEdit: out.canEdit, reference, events};
      } catch (error) { return {ok: false, errorName: error.name, code: error.code, reference, events}; }
      finally { clearTimeout(timeout); }
    }, {name, release: PHOTO4X_RELEASE});
    const candidateFetches = requests.filter(r => r.includes('photo4x-realplksr'));
    const standard = ['large', 'download-fallback', 'hash-fallback', 'reference-fallback', 'drawing', 'cpu'].includes(name);
    const cached = name.includes('cached') || name === 'next-day';
    const passed = name === 'cancel-calibration' ? !result.ok && result.errorName === 'AbortError' && !requests.some(r => r.includes('normal_4x'))
      : result.ok && result.model === (standard ? 'srvgg' : 'nomos-realplksr') &&
        // A cached profile skips calibration; the warm-up still runs as the reference-output check.
        (!cached || result.profileReused && result.calibrationMs === 0) &&
        (standard || result.reference?.passed === true) &&
        (!['drawing', 'cpu', 'large'].includes(name) || candidateFetches.length === 0) &&
        // Photo 2× runs the same 4× graph and halves each tile's output.
        (name !== 'scale2' || result.dimensions.every((side, i) => side === result.inputDimensions[i] * 2)) &&
        (!name.startsWith('faces') || result.faceCount > 0 && result.canEdit) &&
        (!name.startsWith('transparent') || result.hasTransparency && result.mime === 'image/png');
    report.cases.push({name, ...result, modelRequests: [...requests], passed});
    await persist();
    if (!passed) throw Error(`Integration failed: ${name}: ${JSON.stringify(result)}`);
  }
  report.passed = report.errors.length === 0;
} catch (error) { report.passed = false; report.error = error.message; process.exitCode = 1; }
finally { await persist(); await browser.close(); }
console.log(`Integration ${report.passed ? 'passed' : 'FAILED'}: ${root.pathname}report.json`);
