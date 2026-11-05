import {loadRuntime} from '../tool/runtime.js';
import {makeCanvas, sampleTile} from '../tool/tile-pipeline.js';
import {approvedPhoto4xCandidate, photoExecutionChoices, savePhoto4xProfile, rememberPhoto4xFailure, PHOTO4X_RELEASE} from '../tool/photo4x-policy.js';
import {browserEnvironment, runProductWorker, makePngFixture} from './product-benchmark.js';

// Exercise the same admission/persistence protocol as main.js. Test release
// overrides are confined to the lab, which is excluded from production.
export async function automaticPhoto4x(file, {onProgress = () => {}, release, signal, faceResults, lossless = false,
  scale = 4, modelKind = 'photo', forceCpu = false} = {}) {
  let storage;
  try { storage = localStorage; } catch { /* In-memory policy still works. */ }
  const candidate = await approvedPhoto4xCandidate({environment: browserEnvironment(), modelKind, scale, forceCpu, storage,
    onDiagnostic: step => onProgress({type: 'status', operation: `preflight-${step}`})},
    () => navigator.gpu?.requestAdapter(), release);
  const choices = photoExecutionChoices([{backend: forceCpu ? 'wasm' : 'webgpu', threads: 1}], candidate);
  onProgress({type: 'status', operation: candidate ? 'candidate-selected' : 'standard-selected'});
  return runProductWorker({type: 'prepare', file, scale, modelKind, faceResults, benchmark: {lossless}}, {choices, signal,
    onRuntimeFailure: (attempt, error) => rememberPhoto4xFailure(storage, attempt.variant, error),
    onProgress: data => {
      if (data.type === 'photo4x-profile') savePhoto4xProfile(storage, data.profileKey, data.profile);
      onProgress(data);
    },
  });
}

// Runs inside an actual Safari tab. No WebDriver or Safari preference change is
// required; the loopback lab receives only JSON diagnostics, never image bytes.
export async function safariPhoto4xAcceptance(onProgress = () => {}) {
  const report = {schemaVersion: 1, createdAt: new Date().toISOString(), userAgent: navigator.userAgent,
    modelSha256: PHOTO4X_RELEASE.winner.sha256, cases: [], passed: false};
  try {
    if (!/Version\/(?:2[6-9]|[3-9]\d)\..*Safari\//.test(navigator.userAgent) || /Chrome|Chromium|Edg\//.test(navigator.userAgent)) throw Error('Actual desktop Safari 26+ required');
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter?.features.has('shader-f16')) throw Error('Safari does not expose shader-f16 on this device');
    report.gpu = {features: [...adapter.features], limits: {maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize}, vendor: adapter.info?.vendor};
    const release = {...PHOTO4X_RELEASE, browsers: {...PHOTO4X_RELEASE.browsers, safari: true}};
    const file = new File([await (await fetch('/photo4x/inputs/girls_blured.jpg')).blob()], 'input.jpg', {type: 'image/jpeg'});
    for (const name of ['png', 'jpeg', 'transparent', 'faces', 'cancel', 'download-fallback']) {
      onProgress(`Safari: ${name}`);
      const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 120_000);
      let faceResults;
      try {
        const input = ['transparent', 'cancel'].includes(name) ? await makePngFixture('gradient', name === 'cancel' ? 79 : 65, 47) : file;
        if (name === 'faces') faceResults = await runProductWorker({file}, {group: 'faces', backend: 'webgpu', signal: abort.signal});
        const out = await automaticPhoto4x(input, {release: name === 'download-fallback' ? {...release,
          winner: {...release.winner, revision: 'safari-test-download', url: '/assets/processor/missing.onnx'}} : release,
          faceResults, lossless: name !== 'jpeg', signal: abort.signal, onProgress: d => {
            onProgress(`Safari ${name}: ${d.operation}`);
            if (name === 'cancel' && d.operation === 'calibrate') abort.abort();
          }});
        const passed = name === 'download-fallback' ? !out.variant : name !== 'cancel' && out.variant?.id === release.winner.id &&
          out.blob.type === (name === 'jpeg' ? 'image/jpeg' : 'image/png') && (name !== 'faces' || out.faceCount > 0);
        report.cases.push({name, passed, model: out.variant?.id || 'srvgg', mime: out.blob.type,
          runtimeTimings: out.runtimeTimings, forecast: out.forecast, warmupMs: out.warmupMs,
          calibrationMs: out.calibrationMs, upscaleExportMs: out.upscaleExportMs, faceCount: out.faceCount});
        if (!passed) throw Error(`Safari ${name} did not run the requested model/path`);
      } catch (error) {
        if (name === 'cancel' && error.name === 'AbortError') report.cases.push({name, passed: true});
        // The public GFPGAN host sends no CORS header to a loopback origin (Chromium checks route it
        // locally). Record it as not run, never as passed, and continue with the remaining cases.
        else if (name === 'faces' && error.code === 'download') report.cases.push({name, skipped: 'face model is cross-origin from the loopback lab', code: error.code});
        else { report.cases.push({name, passed: false, code: error.code, error: error.message}); throw error; }
      } finally { clearTimeout(timeout); }
    }
    report.passed = report.cases.every(c => c.passed);
  } catch (error) { report.error = error.message; }
  return report;
}

// A full-frame reference for a bounded crop. Kept out of the product entrypoint.
export async function photo4xReference(file, variant, onProgress = () => {}) {
  const bitmap = await createImageBitmap(file);
  let runtime;
  const {canvas, context} = makeCanvas(variant.tileSize * 4, variant.tileSize * 4);
  try {
    runtime = await loadRuntime(false, onProgress, false, 4, 'photo', {backend: 'webgpu', variant});
    const pixels = await runtime.run(sampleTile(bitmap, 0, 0, variant.tileSize));
    context.putImageData(new ImageData(pixels, variant.tileSize * 4, variant.tileSize * 4), 0, 0);
    return {blob: await canvas.convertToBlob({type: 'image/png'}), timings: runtime.timings};
  } finally {
    bitmap.close(); await runtime?.release(); canvas.width = canvas.height = 1;
  }
}
