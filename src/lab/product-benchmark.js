import {ASSETS} from '../tool/assets.generated.js';
import {createAttemptController, operationTimeout} from '../tool/attempt-controller.js';
import {cpuIdentity, executionChoices, rememberThreadFailure, threadCandidates, selectThreadWinner, median} from '../tool/cpu-policy.js';
import {alphaAt, fillTransparentRgb, PNG, readTransparency, sampleRgbTile} from '../tool/transparency.js';
import {sampleTile} from '../tool/tile-pipeline.js';
import {measure, passes, THRESHOLDS} from './benchmark.js';

export const PRODUCT_WORKERS = {
  photo: () => new Worker(new URL('../tool/processor.worker.js', import.meta.url), {type: 'module'}),
  faces: () => new Worker(new URL('../tool/face.worker.js', import.meta.url)),
  composite: () => new Worker(new URL('../tool/face-edit.worker.js', import.meta.url), {type: 'module'}),
};

export function browserEnvironment() {
  return {userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory,
    crossOriginIsolated: globalThis.crossOriginIsolated, sharedMemory: typeof SharedArrayBuffer === 'function',
    webgpu: Boolean(navigator.gpu)};
}

export function runProductWorker(request, {group = 'photo', backend = 'wasm', threads = 1, onProgress = () => {},
  onRuntimeFailure = () => {}, signal, variant, profile = false, choices} = {}) {
  return new Promise((resolve, reject) => {
    const operations = [], started = performance.now();
    let last;
    const controller = createAttemptController({makeWorker: PRODUCT_WORKERS[group], onRuntimeFailure, onMessage(data) {
      if (data.operation) {
        const key = `${data.operation}:${data.unit}`;
        if (last?.key !== key) {
          if (last) operations.push({...last, elapsedMs: performance.now() - last.start});
          last = {key, operation: data.operation, model: data.model, pixels: data.pixels, start: performance.now()};
        }
      }
      onProgress(data);
      if (['done', 'faces', 'enhanced', 'applied'].includes(data.type)) {
        if (last) operations.push({...last, elapsedMs: performance.now() - last.start});
        cleanup();
        resolve({...data, operations: operations.map(({start, key, ...item}) => item), fullMs: performance.now() - started});
      }
    }, onFailure(error) { cleanup(); reject(Object.assign(new Error(error.key), {
      code: error.code, key: error.key, fallbackScale: error.fallbackScale, engine_message: error.engine_message, operations})); }});
    const hidden = () => controller.setHidden(document.hidden);
    const abort = () => { controller.cancel(); cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const cleanup = () => { document.removeEventListener('visibilitychange', hidden); signal?.removeEventListener('abort', abort); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, {once: true});
    document.addEventListener('visibilitychange', hidden); hidden();
    controller.start({environment: browserEnvironment(), benchmark: true, ...request}, choices || [{backend, threads, variant, profile}]);
  });
}

// This regression requires a genuinely verified device and asset revision. A
// CPU1-only environment must fail the precondition, not produce a green report.
export async function verifyFaceThreadCache() {
  const environment = browserEnvironment(), identity = cpuIdentity(environment);
  const choicesFor = group => executionChoices(environment, group, {forceCpu: true, storage: localStorage, assets: ASSETS});
  const policy = Object.fromEntries(['upscale', 'faces'].map(group => [group, choicesFor(group)]));
  if (identity.os !== 'macos' || identity.engine !== 'chromium' ||
      !Object.values(policy).every(choices => choices[0].threads > 1)) {
    throw new Error(`Multithreading precondition failed (device/asset revision): ${JSON.stringify({identity, policy, environment, assets: ASSETS})}`);
  }
  const empty = await makePngFixture('empty', 32, 24), flat = await makePngFixture('alpha254', 32, 24);
  const portrait = await createImageBitmap(await (await fetch('/benchmarks/ios/face/asset_face_preview_original.input.png')).blob());
  const canvas = new OffscreenCanvas(1024, 512);
  canvas.getContext('2d').drawImage(portrait, 512, 0, 512, 512); portrait.close();
  const half = new File([await canvas.convertToBlob({type: PNG})], 'half-transparent-portrait.png', {type: PNG});
  canvas.width = canvas.height = 1;
  const blank = {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0}, visible = {...blank, e: -512};
  const faces = transforms => transforms.map((transform, index) => ({index, transform}));
  const cases = [], failures = [];
  for (const [name, request, usesEngine, expectedPatches] of [
    ['empty-detect', {file: empty}, false, []],
    ['empty-enhance', {mode: 'enhance', file: empty, faces: faces([blank])}, false, [false]],
    ['all-crops-transparent', {mode: 'enhance', file: half, faces: faces([blank])}, false, [false]],
    ['yunet-without-gfpgan', {file: flat}, true, []],
    ['enhance-after-transparent-crop', {mode: 'enhance', file: half, faces: faces([blank, visible])}, true, [false, true]],
  ]) {
    const choices = choicesFor('faces'), execution = choices[0], initializations = [];
    if (!(execution.threads > 1)) throw new Error(`${name}: multithreading was disabled before the case`);
    const result = await runProductWorker(request, {group: 'faces', ...execution,
      onRuntimeFailure: (attempt, error) => {
        failures.push({name, error}); rememberThreadFailure(localStorage, execution.failureKey);
      },
      onProgress: data => {
        if (data.type === 'status' && data.operation === 'initialize' && data.completed === 1) {
          initializations.push({backend: data.backend, effectiveThreads: data.effectiveThreads});
        }
      },
    });
    const patches = result.faces.map(face => Boolean(face.patch));
    const passed = result.requestedThreads === execution.threads &&
      (usesEngine ? result.effectiveThreads === execution.threads && initializations.length === 1
        : result.effectiveThreads === undefined && initializations.length === 0) &&
      JSON.stringify(patches) === JSON.stringify(expectedPatches) &&
      !localStorage.getItem(execution.failureKey) && failures.length === 0;
    cases.push({name, requestedThreads: result.requestedThreads, effectiveThreads: result.effectiveThreads,
      threadCountPresent: result.effectiveThreads !== undefined, type: result.type, patches, initializations, passed});
    if (!passed) throw new Error(`Face thread-cache regression: ${JSON.stringify(cases.at(-1))}`);
  }
  return {environment, identity, policy, cases, failures, assets: ASSETS, passed: true};
}

export const PNG_FIXTURES = ['gradient', 'hard-light', 'hard-dark', 'shadow', 'holes', 'alpha254', 'faint', 'empty', 'webp'];
export async function makePngFixture(name, width = 270, height = 70) {
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    image.data.set(name === 'hard-dark' ? [12, 8, 20, 255] : name === 'hard-light' ? [246, 244, 250, 255] : [240, 32, 180, 255], p);
    let a = 255;
    if (name === 'gradient' || name === 'webp') a = Math.round(x / (width - 1) * 255);
    else if (name === 'hard-light' || name === 'hard-dark') a = x > 30 && x < width - 30 && y > 10 && y < height - 10 ? 255 : 0;
    else if (name === 'shadow') a = Math.round(150 * Math.max(0, 1 - Math.hypot((x - width / 2) / (width / 2), (y - height / 2) / (height / 2))));
    else if (name === 'holes') a = Math.hypot(x - width / 2, y - height / 2) < 20 ? 0 : 255;
    else if (name === 'alpha254') a = x === 10 && y === 10 ? 254 : 255;
    else if (name === 'faint') a = 12;
    else if (name === 'empty') a = 0;
    image.data[p + 3] = a;
  }
  context.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({type: name === 'webp' ? 'image/webp' : PNG, quality: 1});
  return new File([blob], `${name}.${blob.type === PNG ? 'png' : 'webp'}`, {type: blob.type});
}


export async function makeCpuFixture(width = 64, height = 48) {
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
  const pixels = context.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    pixels.data.set([(x * 173 + y * 149) % 256, (x * 17 + y * 67) % 256,
      ((x >> 2) + (y >> 2)) % 2 ? 220 : 30, p === 0 ? 254 : 255], p);
  }
  context.putImageData(pixels, 0, 0);
  return new File([await canvas.convertToBlob({type: PNG})], 'cpu-colour-checker.png', {type: PNG});
}

export async function readPixels(blob) {
  const bitmap = await createImageBitmap(blob), canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(bitmap, 0, 0); bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height); canvas.width = canvas.height = 1;
  return image;
}

export async function runPngAcceptance({backend = 'wasm', models = ['drawing'], scales = [2, 4], names = PNG_FIXTURES,
  onProgress = () => {}, onArtifact = () => {}, signal} = {}) {
  const cases = [], references = new Map();
  for (const name of names) {
    const file = await makePngFixture(name);
    const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image', premultiplyAlpha: 'none'});
    const source = await readTransparency(bitmap); bitmap.close();
    const {alpha} = source;
    fillTransparentRgb(source.rgb, alpha, source.width, source.height);
    for (const modelKind of models) for (const scale of scales) {
      onProgress(`${name} ${modelKind} ${scale}x`);
      const result = await runProductWorker({type: 'prepare', file, modelKind, scale}, {backend, signal});
      const output = await readPixels(result.blob);
      let alphaError = 0;
      for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
        alphaError = Math.max(alphaError, Math.abs(output.data[(y * output.width + x) * 4 + 3] - alphaAt(alpha, source.width, source.height, x, y, scale)));
      }
      let compositeError = 0;
      if (name !== 'empty') {
        const key = `${name}:${modelKind}:${scale}`;
        if (!references.has(key)) {
          const canvas = new OffscreenCanvas(source.width, source.height), ctx = canvas.getContext('2d');
          const pixels = ctx.createImageData(source.width, source.height);
          // Compare the identical decoded RGB through the old opaque tiler.
          // Comparing to the pre-Canvas constant would instead measure the
          // documented browser loss of low-alpha colour before inference.
          for (let p = 0; p < source.width * source.height; p++) {
            pixels.data.set(source.rgb.subarray(p * 3, p * 3 + 3), p * 4); pixels.data[p * 4 + 3] = 255;
          }
          ctx.putImageData(pixels, 0, 0);
          const opaqueFile = new File([await canvas.convertToBlob({type: PNG})], 'reference.png', {type: PNG});
          const reference = await runProductWorker({type: 'prepare', file: opaqueFile, modelKind, scale, benchmark: {lossless: true}}, {backend, signal});
          references.set(key, await readPixels(reference.blob));
        }
        const reference = references.get(key);
        for (let p = 0; p < output.data.length; p += 4) for (const background of [0, 255]) for (let c = 0; c < 3; c++) {
          const a = output.data[p + 3] / 255;
          const actual = Math.round(output.data[p + c] * a + background * (1 - a));
          const expected = Math.round(reference.data[p + c] * a + background * (1 - a));
          compositeError = Math.max(compositeError, Math.abs(actual - expected));
        }
      }
      cases.push({name, modelKind, scale, alphaError, compositeError, mime: result.blob.type, width: output.width, height: output.height,
        fullMs: result.fullMs, effectiveThreads: result.effectiveThreads, skippedTiles: result.skippedTiles, operations: result.operations,
        passed: alphaError <= 1 && compositeError <= 2 && result.blob.type === PNG && output.width === source.width * scale && output.height === source.height * scale});
      await onArtifact(`${name}-${modelKind}-${scale}x`, await pngBackgroundComparison(output));
    }
  }
  return {schemaVersion: 2, createdAt: new Date().toISOString(), kind: 'png-acceptance', environment: browserEnvironment(),
    assets: ASSETS, passed: cases.every(c => c.passed), cases};
}

export async function pngBackgroundComparison(image) {
  const source = new OffscreenCanvas(image.width, image.height);
  source.getContext('2d').putImageData(image, 0, 0);
  const canvas = new OffscreenCanvas(image.width, (image.height + 24) * 3), ctx = canvas.getContext('2d');
  for (let panel = 0; panel < 3; panel++) {
    const top = panel * (image.height + 24);
    ctx.fillStyle = panel === 1 ? '#000' : '#fff'; ctx.fillRect(0, top, image.width, image.height + 24);
    if (panel === 2) for (let y = 0; y < image.height; y += 16) for (let x = 0; x < image.width; x += 16) {
      ctx.fillStyle = ((x + y) / 16) % 2 ? '#aaa' : '#eee'; ctx.fillRect(x, top + 24 + y, 16, Math.min(16, image.height - y));
    }
    ctx.fillStyle = panel === 1 ? '#fff' : '#000'; ctx.font = '14px sans-serif';
    ctx.fillText(['White', 'Black', 'Checkerboard'][panel], 8, top + 17);
    ctx.drawImage(source, 0, top + 24);
  }
  const blob = await canvas.convertToBlob({type: PNG});
  canvas.width = canvas.height = source.width = source.height = 1;
  return blob;
}

export async function runCpuComparison({file, group = 'photo', modelKind = 'photo', scale = 2, faces,
  candidates = threadCandidates(browserEnvironment()), runs = 5, pauseMs = cpuIdentity(browserEnvironment()).mobile ? 60_000 : 0,
  onProgress = () => {}, signal} = {}) {
  if (!file) file = await makeCpuFixture();
  const samples = [], failures = [], env = browserEnvironment();
  const request = group === 'faces' ? {mode: faces ? 'enhance' : 'detect', file, faces} : {type: 'prepare', file, modelKind, scale};
  let baseline;
  const warmed = [];
  // Each candidate gets the same unmeasured warmup. Fresh workers are intentional:
  // full time includes their startup and runtime initialisation, just as production.
  for (const threads of candidates) {
    onProgress(`warmup ${threads}`);
    try { await runProductWorker(request, {group, threads, signal}); warmed.push(threads); }
    catch (error) { if (error.name === 'AbortError') throw error; failures.push({phase: 'warmup', threads, message: error.message}); }
  }
  for (let round = 0; round < runs; round++) {
    const ordered = round % 2 ? [...warmed].reverse() : warmed;
    for (const threads of ordered) {
      if (pauseMs) await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(id); reject(new DOMException('Cancelled', 'AbortError')); };
        const id = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, pauseMs);
        if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
      });
      onProgress(`round ${round + 1}/${runs}, ${threads} threads`);
      try {
        const output = await runProductWorker(request, {group, threads, signal});
        const blobs = output.blob ? [output.blob] : (output.faces || []).flatMap(f => f.patch ? [f.patch] : []);
        const images = await Promise.all(blobs.map(readPixels));
        if (threads === 1 && !baseline && images.length) baseline = images;
        let maximumCompositeError = 0, qualityPassed = Boolean(baseline?.length && images.length === baseline.length);
        const quality = [];
        if (qualityPassed) for (let image = 0; image < images.length; image++) {
          const pixels = images[image], reference = baseline[image];
          if (pixels.width !== reference.width || pixels.height !== reference.height) throw new Error('Output dimensions changed');
          const a = new Float32Array(pixels.width * pixels.height * 3), b = new Float32Array(a.length);
          for (let p = 0; p < pixels.data.length; p++) maximumCompositeError = Math.max(maximumCompositeError, Math.abs(pixels.data[p] - reference.data[p]));
          for (let p = 0; p < pixels.width * pixels.height; p++) for (let c = 0; c < 3; c++) {
            a[p * 3 + c] = reference.data[p * 4 + c] / 255; b[p * 3 + c] = pixels.data[p * 4 + c] / 255;
          }
          const metrics = measure(a, b, pixels.width, pixels.height);
          quality.push(metrics); qualityPassed &&= passes(metrics);
        }
        samples.push({round, requestedThreads: threads, effectiveThreads: output.effectiveThreads || 1,
          fullMs: output.fullMs, totalMs: output.totalMs, tileTimes: output.tileTimes,
          pauseMs, maximumCompositeError, qualityPassed, quality, operations: output.operations, faceCount: output.faceCount ?? output.faces?.length});
      } catch (error) { if (error.name === 'AbortError') throw error; failures.push({round, threads, message: error.message}); }
    }
  }
  const summary = candidates.map(threads => {
    const data = samples.filter(s => s.requestedThreads === threads);
    return {threads, runs: data.length, medianMs: data.length ? median(data.map(s => s.fullMs)) : null,
      stable: data.length === runs && data.every(s => s.effectiveThreads === threads && s.qualityPassed) && !failures.some(f => f.threads === threads)};
  });
  return {schemaVersion: 2, createdAt: new Date().toISOString(), kind: 'product-cpu-comparison', group, modelKind, scale,
    environment: env, identity: cpuIdentity(env), assets: ASSETS, thresholds: THRESHOLDS, pauseMs, runs, samples, failures, summary,
    winner: selectThreadWinner(summary)};
}

// Checks the two ingestion paths in the same browser, independently of JPEG
// encoder differences. Use an opaque fixture spanning a tile boundary.
export async function verifyOpaqueInputParity() {
  const file = await makePngFixture('alpha254', 280, 60), image = await readPixels(file);
  for (let p = 3; p < image.data.length; p += 4) image.data[p] = 255;
  const canvas = new OffscreenCanvas(image.width, image.height); canvas.getContext('2d').putImageData(image, 0, 0);
  const bitmap = await createImageBitmap(canvas), rgb = new Uint8Array(image.width * image.height * 3);
  for (let p = 0; p < image.width * image.height; p++) for (let c = 0; c < 3; c++) rgb[p * 3 + c] = image.data[p * 4 + c];
  let mismatches = 0;
  for (const [x, y] of [[0, 0], [208, 0], [250, 40]]) {
    const before = sampleTile(bitmap, x, y), after = sampleRgbTile({rgb, width: image.width, height: image.height}, x, y);
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) mismatches++;
  }
  const scan = await readTransparency(bitmap); bitmap.close();
  return {passed: mismatches === 0 && !scan.hasTransparency, mismatches};
}

export async function verifyFaceAlpha() {
  const file = await makePngFixture('gradient', 64, 48), base = await readPixels(file);
  const patch = new OffscreenCanvas(512, 512), context = patch.getContext('2d'); context.fillStyle = '#00ff00'; context.fillRect(0, 0, 512, 512);
  const face = {patch: await patch.convertToBlob({type: PNG}), transform: {a: 1, b: 0, c: 0, d: 1, e: 224, f: 232}};
  const result = await runProductWorker({type: 'apply', base: file, plan: {outputWidth: 64, outputHeight: 48, scale: 1}, faces: [face]}, {group: 'composite', backend: 'canvas'});
  const after = await readPixels(result.blob);
  let error = 0, changed = 0;
  for (let p = 0; p < after.data.length; p += 4) if (after.data[p + 3] && after.data[p + 1] !== base.data[p + 1]) changed++;
  for (let p = 3; p < after.data.length; p += 4) error = Math.max(error, Math.abs(after.data[p] - base.data[p]));
  return {passed: error <= 1 && changed > 0 && result.blob.type === PNG, alphaError: error, changed};
}

// Exercise actual browser worker crash/timeout delivery and a successful fresh
// product worker after them. No runtime/model is altered by fault injection.
export async function verifyWorkerRecovery() {
  const file = await makePngFixture('alpha254', 32, 24);
  return new Promise(resolve => {
    let count = 0; const attempts = [], remembered = [];
    const controller = createAttemptController({makeWorker(config) {
      attempts.push({backend: config.backend, threads: config.threads});
      if (++count > 2) return PRODUCT_WORKERS.photo();
      const script = count === 1 ? "onmessage=()=>{throw Error('Injected worker crash')}"
        : "onmessage=({data})=>postMessage({type:'status',operation:'tile',model:'fault',completed:0,attemptId:data.execution.attemptId})";
      const url = URL.createObjectURL(new Blob([script], {type: 'text/javascript'}));
      const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
    }, timeoutFor: operation => operation.model === 'fault' ? 100 : operationTimeout(operation),
    onRuntimeFailure: config => remembered.push(config.threads),
    onFailure: error => resolve({passed: false, error, attempts, remembered}),
    onMessage: data => { if (data.type === 'done') resolve({passed: attempts.length === 3 && remembered.length === 1 &&
      remembered[0] === 8 && data.blob.type === PNG, attempts, remembered, effectiveThreads: data.effectiveThreads}); },
    });
    controller.start({type: 'prepare', file, modelKind: 'drawing', scale: 2, environment: browserEnvironment()},
      [{backend: 'webgpu', threads: 1}, {backend: 'wasm', threads: 8}, {backend: 'wasm', threads: 1}]);
  });
}

// The caller blocks only the WebGPU ORT module. The CPU attempt must execute
// the unchanged product worker; download failures are checked separately.
export async function verifyBackendImportRecovery(group = 'photo', expected = 'import') {
  const file = await makePngFixture('alpha254', 32, 24);
  return new Promise(resolve => {
    const attempts = [], operations = [], retries = [], diagnostics = [];
    const controller = createAttemptController({makeWorker(config) {
      attempts.push(config.backend); return PRODUCT_WORKERS[group]();
    }, onFailure: error => resolve({passed: expected === 'download' && error.code === 'download' && attempts.length === 1,
      error, attempts, operations, retries, diagnostics}),
    onRetry: transition => retries.push({...transition, operation: operations.at(-1)}),
    onMessage(data) {
      if (data.type === 'gpu-probe' || data.type === 'asset-request') diagnostics.push(data);
      if (data.operation && operations.at(-1) !== data.operation) operations.push(data.operation);
      if (['done', 'faces'].includes(data.type)) resolve({passed: expected === 'import' && attempts.join(',') === 'webgpu,wasm', attempts, operations, retries, diagnostics});
    }});
    controller.start({type: 'prepare', file, modelKind: 'drawing', scale: 2, environment: browserEnvironment()},
      [{backend: 'webgpu', threads: 1}, {backend: 'wasm', threads: 1}]);
  });
}

export async function verifyCachedFaceScale() {
  // One fixed 512px patch and source-coordinate transform, reused at both
  // scales. Only the composition worker runs; it cannot invoke GFPGAN.
  const patch = new OffscreenCanvas(512, 512), ctx = patch.getContext('2d');
  ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 512, 512);
  const face = {patch: await patch.convertToBlob({type: PNG}),
    transform: {a: 4, b: 0, c: 0, d: 4, e: -144, f: -144}};
  const cases = [];
  for (const scale of [2, 4]) {
    const width = 200 * scale, height = 200 * scale;
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
    context.fillStyle = 'rgba(240,32,180,.5)'; context.fillRect(0, 0, width, height);
    const base = await canvas.convertToBlob({type: PNG});
    const before = await readPixels(base);
    const result = await runProductWorker({type: 'apply', base, plan: {outputWidth: width, outputHeight: height, scale}, faces: [face]},
      {group: 'composite', backend: 'canvas'});
    const after = await readPixels(result.blob);
    let alphaError = 0, minX = width, minY = height, maxX = -1, maxY = -1;
    for (let p = 0; p < after.data.length; p += 4) {
      alphaError = Math.max(alphaError, Math.abs(after.data[p + 3] - before.data[p + 3]));
      if (after.data[p + 1] - before.data[p + 1] > 100) {
        const x = p / 4 % width, y = Math.floor(p / 4 / width);
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    const bounds = [minX / scale, minY / scale, (maxX + 1) / scale, (maxY + 1) / scale];
    cases.push({scale, bounds, alphaError, operations: result.operations,
      passed: alphaError <= 1 && Math.abs((minX + maxX + 1) / (2 * scale) - 100) < 1 &&
        Math.abs((minY + maxY + 1) / (2 * scale) - 100) < 1 && maxX > minX});
    canvas.width = canvas.height = 1;
  }
  patch.width = patch.height = 1;
  return {cases, passed: cases.every(c => c.passed) && cases[0].bounds.every((v, i) => Math.abs(v - cases[1].bounds[i]) <= 1)};
}

export async function verifyTransparentFaces({onProgress = () => {}, onArtifact = () => {}} = {}) {
  const original = await (await fetch('/benchmarks/ios/face/asset_face_preview_original.input.png')).blob();
  const source = await readPixels(original), {width, height} = source;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    source.data[(y * width + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, x / 20, y / 20, (width - 1 - x) / 20, (height - 1 - y) / 20)));
  }
  const canvas = new OffscreenCanvas(width, height); canvas.getContext('2d').putImageData(source, 0, 0);
  const file = new File([await canvas.convertToBlob({type: PNG})], 'transparent-portrait.png', {type: PNG});
  canvas.width = canvas.height = 1;
  const faces = await runProductWorker({file}, {group: 'faces', threads: 4, onProgress});
  // Detection and local landmarks/GFPGAN must actually run for this fixture.
  const enhanced = faces.faces.filter(face => face.patch);
  if (!faces.hasTransparency || !faces.detectedCount || !enhanced.length) return {passed: false, detectedCount: faces.detectedCount, enhancedCount: enhanced.length};
  const result = await runProductWorker({type: 'prepare', file, modelKind: 'photo', scale: 2, faceResults: faces}, {threads: 4, onProgress});
  if (!result.canEdit || !result.baseBlob) return {passed: false, reason: 'Missing editable PNG base'};
  const bare = await runProductWorker({type: 'apply', base: result.baseBlob, plan: result.plan, faces: []}, {group: 'composite'});
  const reapplied = await runProductWorker({type: 'apply', base: result.baseBlob, plan: result.plan, faces: enhanced}, {group: 'composite'});
  const images = await Promise.all([result.blob, bare.blob, reapplied.blob].map(readPixels));
  const baseImage = await readPixels(result.baseBlob);
  const sourceAlpha = new Uint8Array(width * height);
  for (let p = 0; p < sourceAlpha.length; p++) sourceAlpha[p] = source.data[p * 4 + 3];
  let alphaError = 0, selectionDifference = 0, reapplyError = 0, reapplyCompositeError = 0, opaqueReapplyError = 0;
  const baseRoundTrip = {rgbError: 0, compositeError: 0, opaqueError: 0, alphaError: 0};
  for (let p = 0; p < images[0].data.length; p++) {
    if (p % 4 === 3) {
      const x = (p >> 2) % images[0].width, y = Math.floor((p >> 2) / images[0].width);
      const expected = alphaAt(sourceAlpha, width, height, x, y, 2);
      alphaError = Math.max(alphaError, ...images.map(image => Math.abs(image.data[p] - expected)));
    } else {
      selectionDifference = Math.max(selectionDifference, Math.abs(images[0].data[p] - images[1].data[p]));
      reapplyError = Math.max(reapplyError, Math.abs(images[0].data[p] - images[2].data[p]));
      const alphaIndex = p - p % 4 + 3;
      if (images[0].data[alphaIndex] === 255) opaqueReapplyError = Math.max(opaqueReapplyError, Math.abs(images[0].data[p] - images[2].data[p]));
      baseRoundTrip.rgbError = Math.max(baseRoundTrip.rgbError, Math.abs(baseImage.data[p] - images[1].data[p]));
      if (baseImage.data[alphaIndex] === 255) baseRoundTrip.opaqueError = Math.max(baseRoundTrip.opaqueError, Math.abs(baseImage.data[p] - images[1].data[p]));
      baseRoundTrip.alphaError = Math.max(baseRoundTrip.alphaError, Math.abs(baseImage.data[alphaIndex] - images[1].data[alphaIndex]));
      for (const background of [0, 255]) {
        const composite = image => Math.round(image.data[p] * image.data[alphaIndex] / 255 + background * (1 - image.data[alphaIndex] / 255));
        reapplyCompositeError = Math.max(reapplyCompositeError, Math.abs(composite(images[0]) - composite(images[2])));
        baseRoundTrip.compositeError = Math.max(baseRoundTrip.compositeError, Math.abs(composite(baseImage) - composite(images[1])));
      }
    }
  }
  await onArtifact('transparent-face-restored', await pngBackgroundComparison(images[0]));
  await onArtifact('transparent-face-disabled', await pngBackgroundComparison(images[1]));
  await onArtifact('transparent-face-reapplied', await pngBackgroundComparison(images[2]));
  // Firefox can change unpremultiplied RGB substantially at tiny alpha during
  // a plain PNG -> Canvas -> PNG round trip, with no inference or face blend.
  // Keep raw RGB evidence, but judge visible colour by the same black/white
  // composite tolerance as the PNG matrix. Opaque pixels remain strict.
  return {passed: alphaError <= 1 && reapplyCompositeError <= 2 && opaqueReapplyError <= 1 && selectionDifference > 0 &&
      baseRoundTrip.alphaError <= 1 && baseRoundTrip.compositeError <= 2 && baseRoundTrip.opaqueError <= 1 &&
      images.every(image => image.width === width * 2 && image.height === height * 2),
    detectedCount: faces.detectedCount, enhancedCount: enhanced.length, mime: result.blob.type, canEdit: result.canEdit,
    alphaError, selectionDifference, reapplyError, reapplyCompositeError, opaqueReapplyError, baseRoundTrip, operations: faces.operations};
}

// Ablation, not a quality ranking: neither result is ground truth. Preserve a
// lossless intermediate so this isolates one native 4x model vs two 2x passes.
export async function compareDrawingScales({onProgress = () => {}, onArtifact = () => {}} = {}) {
  const corpus = await (await fetch('/benchmarks/ios/normal_2x/corpus.json')).json();
  const fixtures = corpus.cases.map(item => ({name: item.name, url: `/benchmarks/ios/normal_2x/${item.input}`}));
  fixtures.push({name: 'hero-anime', url: '/resources/before_after/hero_anime_before.jpg'},
    {name: 'anime-thumb', url: '/resources/before_after/anime_thumb.jpg'});
  const results = [];
  for (const {name, url} of fixtures) {
    onProgress(name);
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const ratio = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const file = new File([await canvas.convertToBlob({type: PNG})], `${name}.png`, {type: PNG});
    canvas.width = canvas.height = 1;
    const run = (input, scale) => runProductWorker({type: 'prepare', file: input, modelKind: 'drawing', scale, benchmark: {lossless: true}}, {threads: 4});
    const native = await run(file, 4), first = await run(file, 2);
    const second = await run(new File([first.blob], 'intermediate.png', {type: PNG}), 2);
    const [a, b] = await Promise.all([native.blob, second.blob].map(readPixels));
    const values = image => {
      const rgb = new Float32Array(image.width * image.height * 3);
      for (let p = 0; p < rgb.length; p++) rgb[p] = image.data[Math.floor(p / 3) * 4 + p % 3] / 255;
      return rgb;
    };
    const metrics = measure(values(a), values(b), a.width, a.height);
    results.push({name, width: a.width, height: a.height, metrics, nativeMs: native.fullMs, twoPassMs: first.fullMs + second.fullMs});
    if (['hero-anime', 'anime-thumb', 'checker', 'gradient', 'asset_girls_blured'].includes(name)) {
      const sheet = new OffscreenCanvas(a.width * 2, a.height + 24), ctx = sheet.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sheet.width, sheet.height); ctx.fillStyle = '#000'; ctx.font = '14px sans-serif';
      ctx.fillText('Native Drawing 4x', 8, 17); ctx.fillText('Drawing 2x, twice (lossless PNG)', a.width + 8, 17);
      ctx.putImageData(a, 0, 24); ctx.putImageData(b, a.width, 24);
      await onArtifact(`drawing-ablation-${name}`, await sheet.convertToBlob({type: PNG}));
      sheet.width = sheet.height = 1;
    }
  }
  return {kind: 'drawing-scale-ablation', environment: browserEnvironment(), assets: ASSETS, results, passed: results.length === fixtures.length,
    interpretation: 'Differences only; no ground truth and no automatic better/worse ranking.'};
}
