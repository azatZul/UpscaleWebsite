import {parseArgs} from 'node:util';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {cpus, totalmem, platform, arch} from 'node:os';
import {ASSETS} from '../src/tool/assets.generated.js';

const {values} = parseArgs({options: {
  url: {type: 'string', default: 'http://127.0.0.1:4189'}, input: {type: 'string', default: 'girls_blured.jpg'},
  models: {type: 'string', default: 'current,nomos-esrgan,nomos-realplksr'},
  overlaps: {type: 'string', default: '16,32'}, size: {type: 'string', default: '256'},
  precision: {type: 'string', default: 'fp32'}, runs: {type: 'string', default: '5'}, scale: {type: 'string', default: '4'},
  large: {type: 'boolean', default: false}, profile: {type: 'boolean', default: false},
  reference: {type: 'boolean', default: false}, faces: {type: 'boolean', default: false},
  'diagnose-fallback': {type: 'boolean', default: false},
  headed: {type: 'boolean', default: false}, output: {type: 'string', default: 'screening'},
  report: {type: 'string', default: 'report.json'},
}});
if (![values.input, values.output, values.report].every(value => /^[\w.-]+$/.test(value))) throw Error('Use a local input basename and output label');
const scale = Number(values.scale);
if (![2, 4].includes(scale)) throw Error('Use --scale 2 or 4');
const work = resolve('.web-model-work/photo4x');
const folder = resolve(work, 'results', values.output);
await mkdir(folder, {recursive: true});
const manifest = JSON.parse(await readFile(`${work}/manifest.json`, 'utf8'));
const inputBytes = await readFile(`${work}/inputs/${values.input}`);
const playwright = await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
let localFaceModel;
if (values.faces) {
  localFaceModel = JSON.parse(await readFile(resolve('src/tool/face-model.json'), 'utf8'));
  const local = await readFile(`${work}/models/face_512.onnx`);
  if (createHash('sha256').update(local).digest('hex') !== localFaceModel.sha256) throw Error('Local face model differs from the product pin');
}
// USCALE_CHROMIUM_PATH pins an already installed Chromium when the Playwright module expects another build.
const browser = await playwright.chromium.launch({headless: !values.headed,
  ...(process.env.USCALE_CHROMIUM_PATH ? {executablePath: process.env.USCALE_CHROMIUM_PATH} : {})});
const report = {schemaVersion: 1, createdAt: new Date().toISOString(), settings: values, playwright: playwright.chromium.name(),
  host: {os: platform(), arch: arch(), cpu: cpus()[0]?.model, totalMemoryBytes: totalmem()},
  runtime: ASSETS.runtime, currentModel: {url: ASSETS.models.photo[scale].gpu,
    sha256: createHash('sha256').update(await readFile(resolve(`static/models/normal_${scale}x_web.onnx`))).digest('hex')},
  browserVersion: browser.version(), input: {file: values.input, sha256: createHash('sha256').update(inputBytes).digest('hex'), bytes: inputBytes.length},
  memory: {vram: null, reason: 'WebGPU does not expose reliable process VRAM usage'}, runs: [], errors: []};
const page = await browser.newPage();
let consoleLog = [];
page.on('console', message => { if (values.profile || message.type() === 'error') consoleLog.push(message.text()); });
page.on('pageerror', error => report.errors.push(error.message));
const persist = async () => writeFile(`${folder}/${values.report}`, `${JSON.stringify(report, null, 2)}\n`);
try {
  if (localFaceModel) {
    // Stream the exact pinned GFPGAN; avoid a huge DevTools fulfill payload.
    await page.context().grantPermissions(['local-network-access']);
    await page.context().route(localFaceModel.url, route => route.fulfill({status: 307, headers: {
      Location: `${values.url}/photo4x/models/face_512.onnx`, 'Access-Control-Allow-Origin': '*'}}));
  }
  await page.goto(`${values.url}/lab/?benchmark=1`);
  await page.waitForFunction(() => window.uscaleProductLab);
  report.environment = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return {userAgent: navigator.userAgent, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory,
      crossOriginIsolated, webgpu: Boolean(adapter), isFallbackAdapter: adapter?.isFallbackAdapter,
      features: adapter ? [...adapter.features] : [], gpu: adapter ? {vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device} : null,
      limits: adapter ? {maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize} : null};
  });
  if (!report.environment.webgpu || report.environment.isFallbackAdapter) throw Error('A real hardware WebGPU adapter is required; no flags or software substitution');
  await page.exposeFunction('photo4xProgress', value => console.log(value));
  await page.exposeFunction('photo4xSave', async (name, encoded, append = false) => {
    if (!/^[\w.-]+$/.test(name)) throw Error('Invalid artifact name');
    await writeFile(`${folder}/${name}`, Buffer.from(encoded, 'base64'), {flag: append ? 'a' : 'w'});
  });
  for (const id of values.models.split(',')) {
    for (const overlap of (id === 'current' ? [16] : values.overlaps.split(',').map(Number))) {
      const spec = id === 'current' ? undefined : manifest.models.find(m => m.id === id && m.tileSize === Number(values.size) && m.precision === values.precision && (m.scale ?? 4) === scale);
      if (id !== 'current' && !spec) throw Error(`Prepare ${id} ${values.size} ${values.precision} ${scale}x first`);
      const variant = spec ? {...spec, overlap,
        ...(values['diagnose-fallback'] && values.profile ? {requires: {...spec.requires, gpuOnly: false}} : {})} : undefined;
      const label = `${id}-${spec?.tileSize || 256}-${spec?.precision || 'fp32'}-o${overlap}${values.faces ? '-faces' : ''}`;
      for (let run = 0; run < Number(values.runs); run++) {
        consoleLog = [];
        console.log(`Starting ${label} run ${run + 1}`);
        try {
          const result = await page.evaluate(async ({variant, settings, label, run, scale}) => {
            const response = await fetch(`/photo4x/inputs/${settings.input}`);
            const file = new File([await response.blob()], settings.input, {type: response.headers.get('Content-Type')});
            let previousProgress, lastProgress, forecastEvidence;
            const onProgress = data => {
              lastProgress = {operation: data.operation, completed: data.completed, total: data.total};
              if (data.type === 'forecast') forecastEvidence = {forecast: data.forecast, probeTimes: data.probeTimes,
                runtimeTimings: data.runtimeTimings, warmupMs: data.warmupMs};
              const phase = `${data.operation}:${data.completed ?? ''}`;
              if (phase !== previousProgress && (['initialize', 'download', 'probe'].includes(data.operation) || data.completed % 25 === 0)) {
                previousProgress = phase; photo4xProgress(`${label} ${phase}`);
              }
            };
            let faceResults, facePreparation;
            // Detect once per browser session; both upscalers use the exact same patches.
            if (settings.faces) {
              window.photo4xFaces ||= await uscaleProductLab.runProductWorker({file}, {group: 'faces', backend: 'webgpu', onProgress});
              faceResults = window.photo4xFaces;
              facePreparation = {fullMs: faceResults.fullMs, totalMs: faceResults.totalMs, operations: faceResults.operations,
                faces: faceResults.faces.map(({box, transform, suitable, patch}) => ({box, transform, suitable, enhanced: Boolean(patch)})),
                detectedCount: faceResults.detectedCount, reusedAcrossModels: true};
            }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 600_000);
            const started = performance.now();
            let output;
            try {
              output = settings.reference ? await uscaleProductLab.photo4xReference(file, variant, onProgress)
                : await uscaleProductLab.runProductWorker({type: 'prepare', file, scale, modelKind: 'photo', faceResults,
                    benchmark: {lossless: !settings.large, budgetMs: settings.large ? 300_000 : undefined}}, {backend: 'webgpu', variant, profile: settings.profile, onProgress, signal: controller.signal});
            } catch (error) { return {workerError: {code: error.code, message: error.message, engine: error.engine_message},
              wallMs: performance.now() - started, lastProgress, forecastEvidence, facePreparation}; }
            finally { clearTimeout(timeout); }
            const wallMs = performance.now() - started;
            if (run === 0) {
              // Bounded CDP messages also handle very large JPEG outputs.
              for (let offset = 0; offset < output.blob.size; offset += 524288) {
                const bytes = new Uint8Array(await output.blob.slice(offset, offset + 524288).arrayBuffer());
                let binary = '';
                for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
                await photo4xSave(`${label}.${settings.large ? 'jpg' : 'png'}`, btoa(binary), offset > 0);
              }
            }
            const {blob, baseBlob, faces, variant: unused, ...metrics} = output;
            return {...metrics, facePreparation, wallMs, blobBytes: blob.size, blobType: blob.type, jsHeap: performance.memory ? {
              usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize,
              caveat: 'Browser estimate; excludes native/GPU allocations'} : null};
          }, {variant, settings: values, label, run, scale});
          if (result.workerError) throw Object.assign(new Error(result.workerError.message), {code: result.workerError.code, engine: result.workerError.engine,
            evidence: {wallMs: result.wallMs, lastProgress: result.lastProgress, forecastEvidence: result.forecastEvidence}});
          report.runs.push({id, label, run, variant, ...result});
          if (values.profile) await writeFile(`${folder}/${label}-profile.log`, consoleLog.join('\n'));
          console.log(`Done ${label}: ${(result.wallMs / 1000).toFixed(2)}s; tiles ${result.plan?.tileCount}`);
          await persist();
          if (values.large && result.upscaleExportMs > 300_000) break;
        } catch (error) {
          report.runs.push({id, label, run, failed: true, code: error.code, budgetExceeded: error.code === 'budget',
            evidence: error.evidence, error: error.message, engine: error.engine, log: consoleLog.slice(-30)});
          await persist();
          console.log(`Failed ${label}: ${error.message}`);
          if (!values.large || !['budget', 'The operation was aborted.'].includes(error.code || error.message)) process.exitCode = 1;
          break;
        }
      }
    }
  }
} catch (error) { report.errors.push(error.message); process.exitCode = 1; }
finally { await persist(); await browser.close(); }
console.log(`Report: ${folder}/${values.report}`);
