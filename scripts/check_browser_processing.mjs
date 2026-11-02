// Uses an installed Playwright package; does not change a user's browser profile.
// Set USCALE_PLAYWRIGHT_MODULE to the bundled runtime's playwright/index.mjs if
// Playwright is not in this checkout's module search path.
import {parseArgs} from 'node:util';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {checkProcessingRegressions} from './check_processing_regressions.mjs';
import {checkThreadCacheRegressions} from './check_thread_cache_regressions.mjs';
import {checkProcessingProgress} from './check_processing_progress.mjs';
import {checkIosFaces, IOS_CHROME_UA} from './check_ios_faces.mjs';

const {values} = parseArgs({options: {
  browser: {type: 'string', default: 'chromium'}, suite: {type: 'string', default: 'png'},
  url: {type: 'string', default: 'http://127.0.0.1:4187'}, output: {type: 'string'},
  model: {type: 'string'}, scale: {type: 'string'}, names: {type: 'string'}, threads: {type: 'string'},
  runs: {type: 'string', default: '5'}, pause: {type: 'string'}, 'local-face-model': {type: 'boolean', default: false},
  detect: {type: 'boolean', default: false},
}});
if (!['chromium', 'firefox', 'webkit'].includes(values.browser) || !['png', 'cpu', 'ui', 'progress', 'ios-faces', 'faces', 'recovery', 'face-png', 'drawing-ablation', 'regressions', 'thread-cache'].includes(values.suite)) {
  throw new Error('Use --browser chromium|firefox|webkit --suite png|cpu|ui|progress|ios-faces|faces|recovery|face-png|drawing-ablation|regressions|thread-cache');
}
const output = resolve(values.output || `.web-model-work/browser-reports/${values.suite}-${values.browser}.json`);
await mkdir(dirname(output), {recursive: true});
const playwright = await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
// The regression suite needs a usable test adapter as well as injected failures.
// This flag affects only its Chromium process, never the shipped product.
const browser = await playwright[values.browser].launch({headless: true,
  ...(values.browser === 'chromium' && values.suite === 'regressions'
    ? {args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])]} : {})});
const page = await browser.newPage(values.suite === 'ios-faces'
  ? {userAgent: IOS_CHROME_UA, viewport: {width: 393, height: 852}, isMobile: true, hasTouch: true}
  : {viewport: {width: 1280, height: 1000}});
const errors = [], warnings = [];
page.on('pageerror', error => {
  // WebKit reports deferred ResizeObserver notifications as page errors,
  // without a thrown JS exception. Preserve this known warning separately.
  (values.browser === 'webkit' && error.message === 'ResizeObserver loop completed with undelivered notifications.'
    ? warnings : errors).push(error.message);
});
let localFaceModel = false;
let modelServer;
if (values['local-face-model']) {
  // Chromium checks redirects from the public model URL to loopback. This
  // permission belongs only to the isolated test context streaming local weights.
  if (values.browser === 'chromium') await page.context().grantPermissions(['local-network-access']);
  const pinned = JSON.parse(await readFile(new URL('../src/tool/face-model.json', import.meta.url)));
  const path = new URL('../static/models/face_512.onnx', import.meta.url);
  if (createHash('sha256').update(await readFile(path)).digest('hex') !== pinned.sha256) throw new Error('Local GFPGAN differs from the pinned production model');
  // Streaming avoids sending an 85 MB response as a >100 MB base64 DevTools
  // message, which closes Chromium's debugging connection before inference.
  modelServer = createServer((request, response) => {
    if (request.url !== '/face.onnx') { response.writeHead(404).end(); return; }
    response.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Length': pinned.bytes,
      'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin'});
    createReadStream(path).pipe(response);
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  await page.context().route(pinned.url, route => values.browser === 'webkit'
    // Playwright WebKit cannot fulfill an intercepted request with a redirect.
    // Its protocol accepts the pinned payload directly; Chromium uses the
    // streaming redirect to stay below its DevTools message-size limit.
    ? route.fulfill({path: fileURLToPath(path), contentType: 'application/octet-stream', headers: {
      'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin'}})
    : route.fulfill({status: 307, headers: {
      Location: `http://127.0.0.1:${modelServer.address().port}/face.onnx`,
      'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin'}}));
  localFaceModel = true;
}
let report;
try {
  let lastStep;
  await page.exposeFunction('reportStep', step => { if (step !== lastStep) { console.log(step); lastStep = step; } });
  await page.exposeFunction('savePngArtifact', async (name, bytes) => {
    if (!/^[a-z0-9_-]+$/.test(name)) throw new Error('Invalid artifact name');
    const folder = output.replace(/\.json$/, '-images');
    await mkdir(folder, {recursive: true});
    await writeFile(`${folder}/${name}.png`, Buffer.from(bytes));
  });
  await page.goto(`${values.url}/lab/?benchmark=1`);
  await page.waitForFunction(() => window.uscaleProductLab);
  const basic = await page.evaluate(async () => ({opaque: await uscaleProductLab.verifyOpaqueInputParity(),
    faceAlpha: await uscaleProductLab.verifyFaceAlpha()}));
  if (values.suite === 'ios-faces') {
    report = await checkIosFaces(page, values.url);
  } else if (values.suite === 'progress') {
    report = await checkProcessingProgress(page, values.url);
  } else if (values.suite === 'regressions') {
    report = await checkProcessingRegressions(page, values.url);
  } else if (values.suite === 'thread-cache') {
    report = await checkThreadCacheRegressions(page, values.url);
  } else if (values.suite === 'png') {
    report = await page.evaluate(async args => await uscaleProductLab.runPngAcceptance({
      models: args.model ? [args.model] : ['photo', 'drawing'], scales: args.scale ? [Number(args.scale)] : [2, 4],
      ...(args.names ? {names: args.names.split(',')} : {}), onProgress: reportStep,
      onArtifact: async (name, blob) => savePngArtifact(name, [...new Uint8Array(await blob.arrayBuffer())]),
    }), values);
  } else if (values.suite === 'recovery') {
    report = {kind: 'worker-recovery', ...await page.evaluate(() => uscaleProductLab.verifyWorkerRecovery())};
  } else if (values.suite === 'drawing-ablation') {
    report = await page.evaluate(() => uscaleProductLab.compareDrawingScales({onProgress: reportStep,
      onArtifact: async (name, blob) => savePngArtifact(name, [...new Uint8Array(await blob.arrayBuffer())]),
    }));
  } else if (values.suite === 'face-png') {
    report = {kind: 'transparent-face-pipeline', ...await page.evaluate(() => uscaleProductLab.verifyTransparentFaces({
      onProgress: data => reportStep(`${data.operation} ${data.completed ?? ''}`),
      onArtifact: async (name, blob) => savePngArtifact(name, [...new Uint8Array(await blob.arrayBuffer())]),
    }))};
  } else if (values.suite === 'cpu' || values.suite === 'faces') {
    report = await page.evaluate(async args => {
      const faces = args.suite === 'faces' || args.model === 'faces';
      let file;
      if (faces) {
        const blob = await (await fetch('/benchmarks/ios/face/asset_face_preview_original.input.png')).blob();
        file = new File([blob], 'portrait.png', {type: 'image/png'});
      }
      const options = {file, group: faces ? 'faces' : 'photo',
        modelKind: args.model || 'photo', scale: Number(args.scale || 2),
        ...(faces && !args.detect ? {faces: [{index: 0, transform: {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0}}]} : {}),
        ...(args.threads ? {candidates: args.threads.split(',').map(Number)} : {}),
        runs: Number(args.runs), ...(args.pause ? {pauseMs: Number(args.pause)} : {}), onProgress: reportStep};
      if (args.model !== 'all') return await uscaleProductLab.runCpuComparison(options);
      const reports = [];
      for (const modelKind of ['photo', 'drawing']) for (const scale of [2, 4]) {
        await reportStep(`${modelKind} ${scale}x`);
        reports.push(await uscaleProductLab.runCpuComparison({...options, modelKind, scale}));
      }
      return {kind: 'product-cpu-model-matrix', reports,
        failures: reports.flatMap(r => r.failures), summary: reports.flatMap(r => r.summary.map(s => ({modelKind: r.modelKind, scale: r.scale, ...s})))};
    }, values);
    report.passed = !report.failures.length && report.summary.every(row => row.stable);
  } else {
    const input = await page.evaluate(async () => {
      const file = await uscaleProductLab.makePngFixture('gradient');
      const canvas = new OffscreenCanvas(80, 60), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f020b4'; ctx.fillRect(0, 0, 80, 60);
      const opaque = await canvas.convertToBlob({type: 'image/png'});
      return {transparent: [...new Uint8Array(await file.arrayBuffer())], opaque: [...new Uint8Array(await opaque.arrayBuffer())]};
    });
    // Exercise the CPU UI deterministically, rather than a software WebGPU adapter.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', {value: undefined});
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({data}) => {
            if (data.type === 'done') window.__lastExecution = {backend: data.backend,
              requestedThreads: data.requestedThreads, effectiveThreads: data.effectiveThreads};
          });
        }
      };
    });
    await page.goto(`${values.url}/upscale/?mode=device&analytics_debug=1`);
    await page.locator('#photo-input').setInputFiles({name: 'gradient.png', mimeType: 'image/png', buffer: Buffer.from(input.transparent)});
    await page.locator('#model-drawing').click();
    await page.locator('#process-photo').click();
    await page.locator('#results').waitFor({state: 'visible', timeout: 180_000});
    const png = await page.evaluate(async () => {
      const link = document.getElementById('download-result'), blob = await (await fetch(link.href)).blob();
      return {filename: link.download, mime: blob.type, summary: document.getElementById('result-summary').textContent,
        execution: window.__lastExecution,
        checkerboard: getComputedStyle(document.getElementById('before-image')).backgroundImage.includes('gradient') &&
          getComputedStyle(document.getElementById('result-image')).backgroundImage.includes('gradient')};
    });
    await page.locator('#result-viewer').screenshot({path: output.replace(/\.json$/, '-ui.png')});
    await page.locator('#another-photo').click();
    await page.locator('#photo-input').setInputFiles({name: 'opaque.png', mimeType: 'image/png', buffer: Buffer.from(input.opaque)});
    await page.locator('#process-photo').click();
    await page.locator('#results').waitFor({state: 'visible', timeout: 180_000});
    const jpeg = await page.evaluate(async () => {
      const link = document.getElementById('download-result');
      return {filename: link.download, mime: (await (await fetch(link.href)).blob()).type,
        summary: document.getElementById('result-summary').textContent};
    });
    // Removing the selected file and cancelling a new run must stop its worker.
    await page.locator('#another-photo').click();
    await page.locator('#photo-input').setInputFiles({name: 'gradient.png', mimeType: 'image/png', buffer: Buffer.from(input.transparent)});
    await page.locator('#process-photo').click();
    await page.locator('#cancel').click();
    const cancelled = await page.locator('#process-photo').isEnabled();
    report = {kind: 'product-ui', png, jpeg, cancelled, passed: jpeg.filename.endsWith('.jpg') && jpeg.mime === 'image/jpeg' && jpeg.summary.includes('JPEG') && png.filename.endsWith('.png') && png.mime === 'image/png' && png.summary.includes('PNG') && png.checkerboard && cancelled};
  }
  report = {...report, basic, browser: values.browser, browserVersion: browser.version(),
    localPinnedFaceModel: localFaceModel, errors, warnings, passed: report.passed && basic.opaque.passed && basic.faceAlpha.passed && !errors.length};
  console.log(JSON.stringify({passed: report.passed, cases: report.cases?.length, summary: report.summary, winner: report.winner, errors, warnings}));
} catch (error) {
  report = {passed: false, browser: values.browser, suite: values.suite, errors, error: error.stack};
  console.error(error.message);
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (modelServer) await new Promise(resolve => modelServer.close(resolve));
}
if (!report.passed) process.exitCode = 1;
