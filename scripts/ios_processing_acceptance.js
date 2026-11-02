// Runs only in an isolated Safari WebDriver tab with the locally built UI.
// Model/runtime URLs remain the pinned production assets; nothing is deployed.
import {alphaAt, fillTransparentRgb, PNG, readTransparency} from '../src/tool/transparency.js';
import {createAttemptController} from '../src/tool/attempt-controller.js';
import {devicePolicy, assessPhoto, assessPng} from '../src/tool/capability.js';

const state = () => window.__iosAcceptance;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async (predicate, timeout = 180_000) => {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeout) throw new Error(`Timed out: ${state().step}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
const environment = () => ({userAgent: navigator.userAgent, platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints, hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemory: navigator.deviceMemory, crossOriginIsolated, sharedMemory: typeof SharedArrayBuffer === 'function',
  webgpu: Boolean(navigator.gpu)});
const $ = id => document.getElementById(id);
const fileOf = (blob, name) => new File([blob], name, {type: blob.type});

async function pixels(blob) {
  const bitmap = await createImageBitmap(blob), canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.drawImage(bitmap, 0, 0); bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 1;
  return image;
}

function workerRun(request, backend = 'webgpu') {
  return new Promise((resolve, reject) => {
    const controller = createAttemptController({makeWorker: () => new Worker(window.__iosWorkers.processor),
      onMessage(data) {
        if (data.type === 'status') Object.assign(state(), {operation: data.operation, completed: data.completed});
        if (data.type === 'done') resolve(data);
      }, onFailure: error => reject(new Error(JSON.stringify(error))),
    });
    controller.start({type: 'prepare', environment: environment(), scale: 2, ...request}, [{backend, threads: 1}]);
  });
}

async function fixture(name, width = 270, height = 70) {
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
  canvas.width = canvas.height = 1;
  return fileOf(blob, `${name}.${blob.type === PNG ? 'png' : 'webp'}`);
}

async function matrix() {
  const cases = [];
  for (const name of ['gradient', 'hard-light', 'hard-dark', 'shadow', 'holes', 'alpha254', 'faint', 'empty', 'webp']) {
    const file = await fixture(name), bitmap = await createImageBitmap(file, {premultiplyAlpha: 'none'});
    const source = await readTransparency(bitmap); bitmap.close();
    fillTransparentRgb(source.rgb, source.alpha, source.width, source.height);
    const canvas = new OffscreenCanvas(source.width, source.height), context = canvas.getContext('2d');
    const opaque = context.createImageData(source.width, source.height);
    for (let p = 0; p < source.alpha.length; p++) {
      opaque.data.set(source.rgb.subarray(p * 3, p * 3 + 3), p * 4); opaque.data[p * 4 + 3] = 255;
    }
    context.putImageData(opaque, 0, 0);
    const referenceFile = fileOf(await canvas.convertToBlob({type: PNG}), 'opaque-reference.png');
    canvas.width = canvas.height = 1;
    for (const modelKind of ['photo', 'drawing']) {
      state().step = `matrix:${name}:${modelKind}:2x`;
      const result = await workerRun({file, modelKind}), image = await pixels(result.blob);
      const reference = name === 'empty' ? null : await pixels((await workerRun({file: referenceFile, modelKind, benchmark: {lossless: true}})).blob);
      let alphaError = 0, compositeError = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const p = (y * image.width + x) * 4;
        alphaError = Math.max(alphaError, Math.abs(image.data[p + 3] - alphaAt(source.alpha, source.width, source.height, x, y, 2)));
        if (reference) for (const background of [0, 255]) for (let c = 0; c < 3; c++) {
          const a = image.data[p + 3] / 255;
          compositeError = Math.max(compositeError, Math.abs(Math.round(image.data[p + c] * a + background * (1 - a)) -
            Math.round(reference.data[p + c] * a + background * (1 - a))));
        }
      }
      const row = {name, modelKind, scale: 2, backend: result.backend, alphaError, compositeError,
        width: image.width, height: image.height, mime: result.blob.type,
        passed: alphaError <= 1 && compositeError <= 2 && result.blob.type === PNG && image.width === source.width * 2 && image.height === source.height * 2};
      cases.push(row); state().matrix = cases;
      assert(row.passed, `PNG matrix failed: ${JSON.stringify(row)}`);
    }
  }
  return cases;
}

async function choose(file) {
  if (!$('another-photo').hidden && !$('results').hidden) $('another-photo').click();
  const transfer = new DataTransfer(); transfer.items.add(file);
  $('photo-input').files = transfer.files;
  $('photo-input').dispatchEvent(new Event('change', {bubbles: true}));
  await wait(() => !$('process-photo').hidden && !$('process-photo').disabled);
}

async function runUi(file, {drawing = false, faces = true, readImage = true, timeout = 600_000} = {}) {
  await choose(file);
  $(drawing ? 'model-drawing' : 'model-photo').click();
  if ($('enhance-faces').checked !== faces) {
    $('enhance-faces').checked = faces; $('enhance-faces').dispatchEvent(new Event('change', {bubbles: true}));
  }
  await wait(() => !$('process-photo').disabled);
  $('process-photo').click();
  await wait(() => !$('results').hidden || !$('status').classList.contains('is-busy'), timeout);
  assert(!$('results').hidden, `UI processing failed: ${$('status-detail').textContent} ${$('photo-error').textContent}`);
  await $('result-image').decode();
  const link = $('download-result'), blob = await (await fetch(link.href)).blob();
  return {blob, image: readImage ? await pixels(blob) : undefined, filename: link.download, summary: $('result-summary').textContent};
}

async function recovery() {
  state().step = 'worker:crash-timeout-cpu-recovery';
  const file = await fixture('alpha254', 32, 24), attempts = [], rejected = [];
  const result = await new Promise((resolve, reject) => {
    const controller = createAttemptController({makeWorker(config) {
      attempts.push({backend: config.backend, threads: config.threads});
      if (attempts.length === 3) return new Worker(window.__iosWorkers.processor);
      const script = attempts.length === 1 ? "onmessage=()=>{throw Error('Injected acceptance crash')}"
        : "onmessage=({data})=>postMessage({type:'status',operation:'tile',model:'fault',completed:0,attemptId:data.execution.attemptId})";
      const url = URL.createObjectURL(new Blob([script], {type: 'text/javascript'}));
      const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
    }, timeoutFor: operation => operation.model === 'fault' ? 1000 : 120_000,
    onRuntimeFailure: config => rejected.push(config.threads),
    onMessage: data => { if (data.type === 'done') resolve(data); },
    onFailure: error => reject(new Error(JSON.stringify(error)))});
    controller.start({type: 'prepare', file, scale: 2, modelKind: 'photo', environment: environment()},
      [{backend: 'webgpu', threads: 1}, {backend: 'wasm', threads: 2}, {backend: 'wasm', threads: 1}]);
  });
  assert(attempts.length === 3 && rejected.length === 1 && rejected[0] === 2 && result.blob.type === PNG, 'Safari worker recovery failed');
  state().recovery = {attempts, rejected, mime: result.blob.type, effectiveThreads: result.effectiveThreads, passed: true};
}

async function largeEditor(portrait) {
  state().step = 'ui:large-png-face-editor:prepare';
  const width = 3072, height = 2304, x = (width - 512) / 2, y = (height - 512) / 2;
  const bitmap = await createImageBitmap(new Blob([portrait], {type: PNG}));
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
  context.drawImage(bitmap, x, y, 512, 512); bitmap.close();
  const file = fileOf(await canvas.convertToBlob({type: PNG}), 'large-transparent-portrait.png');
  canvas.width = canvas.height = 1;
  const initial = await runUi(file, {readImage: false});
  assert(initial.blob.type === PNG && !$('choose-faces').hidden, 'Large PNG face editor unavailable');
  // Read only 1px samples: the test must not retain several extra full-size
  // pixel arrays alongside the actual editor's memory working set.
  const samples = async blob => {
    const bitmap = await createImageBitmap(blob), stripe = new OffscreenCanvas(1, 1), ctx = stripe.getContext('2d');
    const positions = [];
    for (let i = 0; i < 64; i++) positions.push([(i * 7919) % (width * 2), (i * 1237) % (height * 2)]);
    for (let i = 0; i < 64; i++) positions.push([x * 2 + (i * 173) % 1024, y * 2 + (i * 257) % 1024]);
    const values = positions.map(([px, py]) => { ctx.clearRect(0, 0, 1, 1); ctx.drawImage(bitmap, px, py, 1, 1, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; });
    const dimensions = [bitmap.width, bitmap.height]; bitmap.close(); stripe.width = stripe.height = 1;
    return {values, dimensions};
  };
  const before = await samples(initial.blob);
  $('choose-faces').click();
  const selected = [...document.querySelectorAll('.face-mark')].map(mark => mark.getAttribute('aria-pressed') === 'true');
  assert(selected.some(Boolean), 'Large PNG did not enhance any real face');
  for (const mark of document.querySelectorAll('.face-mark')) if (mark.getAttribute('aria-pressed') === 'true') mark.click();
  state().step = 'ui:large-png-face-editor:off'; $('face-apply').click();
  await wait(() => $('face-editor').hidden || $('face-status').classList.contains('is-error'), 240_000);
  assert($('face-editor').hidden, `Large editor failed: ${$('face-status').textContent}`); await $('result-image').decode();
  const bare = await samples(await (await fetch($('download-result').href)).blob());
  $('choose-faces').click();
  for (const [index, mark] of [...document.querySelectorAll('.face-mark')].entries()) if (selected[index]) mark.click();
  state().step = 'ui:large-png-face-editor:on'; $('face-apply').click();
  await wait(() => $('face-editor').hidden || $('face-status').classList.contains('is-error'), 240_000);
  assert($('face-editor').hidden, `Large editor failed: ${$('face-status').textContent}`); await $('result-image').decode();
  const after = await samples(await (await fetch($('download-result').href)).blob());
  let alphaError = 0, reapplyError = 0, selectionDifference = 0;
  for (let i = 0; i < before.values.length; i++) for (let c = 0; c < 4; c++) {
    if (c === 3) alphaError = Math.max(alphaError, Math.abs(before.values[i][c] - bare.values[i][c]), Math.abs(before.values[i][c] - after.values[i][c]));
    else { reapplyError = Math.max(reapplyError, Math.abs(before.values[i][c] - after.values[i][c])); selectionDifference = Math.max(selectionDifference, Math.abs(before.values[i][c] - bare.values[i][c])); }
  }
  const result = {dimensions: after.dimensions, input: [width, height], samples: before.values.length,
    alphaError, reapplyError, selectionDifference, passed: alphaError <= 1 && reapplyError <= 1 && selectionDifference > 0 && after.dimensions[0] === width * 2 && after.dimensions[1] === height * 2};
  state().largeEditor = result; assert(result.passed, `Large PNG editor failed: ${JSON.stringify(result)}`);
}

async function editor(portrait) {
  state().step = 'ui:transparent-face-detect-enhance-upscale';
  const source = await pixels(fileOf(new Blob([portrait], {type: PNG}), 'portrait.png'));
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    source.data[(y * source.width + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, x / 20, y / 20, (source.width - 1 - x) / 20, (source.height - 1 - y) / 20)));
  }
  const canvas = new OffscreenCanvas(source.width, source.height), ctx = canvas.getContext('2d');
  ctx.putImageData(source, 0, 0);
  const file = fileOf(await canvas.convertToBlob({type: PNG}), 'transparent-portrait.png');
  canvas.width = canvas.height = 1;
  const initial = await runUi(file);
  assert(initial.blob.type === PNG && initial.filename.endsWith('.png') && initial.summary.includes('PNG'), 'Wrong PNG UI metadata');
  assert(!$('choose-faces').hidden, 'Face editor was not offered');
  assert(getComputedStyle($('before-image')).backgroundImage.includes('gradient') && getComputedStyle($('result-image')).backgroundImage.includes('gradient'), 'Missing comparison checkerboards');
  $('choose-faces').click();
  const marks = [...document.querySelectorAll('.face-mark')];
  const selected = marks.map(mark => mark.getAttribute('aria-pressed') === 'true');
  assert(marks.length > 0, 'Real face detection found no selectable face');
  assert(marks.some(mark => mark.getAttribute('aria-pressed') === 'true'), 'GFPGAN did not enhance a face');
  assert(getComputedStyle($('face-photo')).backgroundImage.includes('gradient'), 'Missing face editor checkerboard');
  for (const mark of marks) if (mark.getAttribute('aria-pressed') === 'true') mark.click();
  state().step = 'ui:face-selection-off'; $('face-apply').click();
  await wait(() => $('face-editor').hidden || $('face-status').classList.contains('is-error'));
  assert($('face-editor').hidden, `Editor failed: ${$('face-status').textContent}`); await $('result-image').decode();
  const bare = await pixels(await (await fetch($('download-result').href)).blob());
  $('choose-faces').click();
  for (const [index, mark] of [...document.querySelectorAll('.face-mark')].entries()) {
    if (selected[index] && mark.getAttribute('aria-pressed') === 'false') mark.click();
  }
  state().step = 'ui:face-selection-on'; $('face-apply').click();
  await wait(() => $('face-editor').hidden || $('face-status').classList.contains('is-error'));
  assert($('face-editor').hidden, `Editor failed: ${$('face-status').textContent}`); await $('result-image').decode();
  const restored = await pixels(await (await fetch($('download-result').href)).blob());
  const sourceAlpha = new Uint8Array(source.width * source.height);
  for (let p = 0; p < sourceAlpha.length; p++) sourceAlpha[p] = source.data[p * 4 + 3];
  let alphaError = 0, selectionDifference = 0, reapplyError = 0;
  for (let p = 0; p < initial.image.data.length; p++) {
    if (p % 4 === 3) {
      const x = (p >> 2) % restored.width, y = Math.floor((p >> 2) / restored.width);
      const expected = alphaAt(sourceAlpha, source.width, source.height, x, y, 2);
      alphaError = Math.max(alphaError, ...[initial.image, bare, restored].map(image => Math.abs(image.data[p] - expected)));
    } else {
      selectionDifference = Math.max(selectionDifference, Math.abs(initial.image.data[p] - bare.data[p]));
      reapplyError = Math.max(reapplyError, Math.abs(initial.image.data[p] - restored.data[p]));
    }
  }
  const result = {faces: marks.length, alphaError, selectionDifference, reapplyError, mime: initial.blob.type,
    filename: initial.filename, width: restored.width, height: restored.height,
    passed: alphaError <= 1 && selectionDifference > 0 && reapplyError <= 1};
  state().editor = result; assert(result.passed, `Physical editor failed: ${JSON.stringify(result)}`);
  window.__iosArtifactBlobs = {initial: initial.blob, restored: await (await fetch($('download-result').href)).blob()};
  // Keep the real result visible for a WebDriver screenshot and manual inspection.
  return result;
}

export async function runAcceptance(portrait) {
  let lock;
  try {
    try { lock = await navigator.wakeLock.request('screen'); } catch { /* Optional. */ }
    await matrix();
    await recovery();
    state().step = 'ui:png';
    const png = await runUi(await fixture('gradient'), {drawing: true, faces: false});
    assert(png.blob.type === PNG && png.filename.endsWith('.png') && png.summary.includes('PNG'), 'Transparent UI output is not PNG');
    state().step = 'ui:opaque';
    const opaque = new OffscreenCanvas(80, 60); const context = opaque.getContext('2d');
    context.fillStyle = '#f020b4'; context.fillRect(0, 0, 80, 60);
    const jpeg = await runUi(fileOf(await opaque.convertToBlob({type: PNG}), 'opaque.png'), {drawing: true, faces: false});
    assert(jpeg.blob.type === 'image/jpeg' && jpeg.filename.endsWith('.jpg') && jpeg.summary.includes('JPEG'), 'Opaque UI output is not JPEG');
    opaque.width = opaque.height = 1;
    state().ui = {png: {mime: png.blob.type, filename: png.filename}, jpeg: {mime: jpeg.blob.type, filename: jpeg.filename}, passed: true};
    state().step = 'ui:cancel'; await choose(await fixture('gradient', 512, 512));
    $('process-photo').click(); await wait(() => !$('cancel').hidden); $('cancel').click();
    await wait(() => !$('process-photo').disabled); state().ui.cancelled = true;
    const policy = devicePolicy(environment());
    const aboveLimit = assessPhoto({width: 4096, height: 1729}, policy);
    let rejectedAboveLimit = false;
    try { assessPng(aboveLimit, policy); } catch (error) { rejectedAboveLimit = error.key === 'err_png_size'; }
    assert(rejectedAboveLimit, 'Mobile PNG ceiling was not enforced');
    state().largeEditorAdmission = {maxPngOutputPixels: policy.maxPngOutputPixels,
      rejectedDimensions: [aboveLimit.outputWidth, aboveLimit.outputHeight], rejectedAboveLimit, passed: true};
    await editor(portrait);
    await largeEditor(portrait);
    const faceRuns = state().executions.filter(run => run.group === 'faces');
    const portraitRuns = state().executions.filter(run => run.group === 'processor' && run.file?.includes('portrait'));
    const composites = state().executions.filter(run => run.group === 'composite');
    assert(faceRuns.length === 2 && faceRuns.every(run => run.backend === 'wasm' && run.requestedThreads === 1 && run.effectiveThreads === 1), 'iPhone face policy or patch cache changed');
    assert(portraitRuns.length === 2 && portraitRuns.every(run => run.backend === 'webgpu' && run.canEdit), 'iPhone upscale policy or editor admission changed');
    assert(composites.length === 4 && composites.every(run => run.backend === 'canvas' && run.result === 'applied'), 'Face selections must rebuild without another inference');
    state().backendPolicy = {facePasses: faceRuns.length, faceThreads: 1, upscale: 'webgpu', cachedComposites: composites.length, passed: true};
    state().step = 'done'; state().passed = true;
  } catch (error) { state().step = 'failed'; state().passed = false; state().error = `${error.message || error}\n${error.stack || ''}`; }
  finally { await lock?.release(); }
}

// Exercise the real page's worker lifecycle, retained source/result images and
// download Blob, instead of accepting only an isolated inference worker.
export async function runMaximumAcceptance({width = 4096, height = 1728, runs = 3} = {}) {
  Object.assign(state(), {kind: 'physical-iphone-maximum-ui', width, height, requestedRuns: runs,
    runs: [], events: [], method: 'Locally built product UI; pinned production models; sequential PNG display/download-Blob/reopen checks'});
  const record = type => state().events.push({type, at: new Date().toISOString(), hidden: document.hidden, run: state().run});
  const visibility = () => record('visibilitychange');
  const pagehide = () => record('pagehide');
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  let lock;
  try {
    assert(Number.isInteger(runs) && runs >= 3, 'Maximum acceptance requires at least three consecutive runs');
    assert(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0, 'Invalid fixture dimensions');
    // Safari Automation can deny Wake Lock even after a trusted touch. Keep
    // the request's actual outcome and provide an inert driver touch target.
    const button = document.createElement('button');
    button.id = 'acceptance-keep-active'; button.textContent = 'PNG acceptance running';
    button.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;padding:16px;touch-action:manipulation;-webkit-user-select:none;user-select:none';
    button.addEventListener('click', event => event.preventDefault());
    button.addEventListener('touchend', event => event.preventDefault(), {passive: false});
    document.body.append(button);
    try {
      lock = await navigator.wakeLock.request('screen'); state().wakeLockGranted = true;
      lock.addEventListener('release', () => record('wake-lock-released'));
    } catch (error) { state().wakeLockGranted = false; state().wakeLockError = String(error); }
    const draw = async run => {
      state().step = 'maximum:generate-source';
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
      let seed = 0xc0de;
      try {
        for (let y = 0; y < height; y += 128) {
          const rows = Math.min(128, height - y), image = ctx.createImageData(width, rows);
          for (let row = 0; row < rows; row++) for (let x = 0; x < width; x++) {
            const p = (row * width + x) * 4;
            seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
            image.data.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 32 + (13 * x + 37 * (y + row)) % 224], p);
          }
          ctx.putImageData(image, 0, y);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        return fileOf(await canvas.convertToBlob({type: PNG}), `maximum-${run}.png`);
      } finally { canvas.width = canvas.height = 1; }
    };
    const check = async run => {
      const file = await draw(run), started = performance.now();
      state().step = 'maximum:processing';
      const result = await runUi(file, {drawing: true, faces: false, readImage: false, timeout: 1_200_000});
      state().step = 'maximum:reopen-download';
      const bitmap = await createImageBitmap(result.blob), canvas = new OffscreenCanvas(1, 1), ctx = canvas.getContext('2d');
      let alphaError = 0;
      try {
        const sourceAlpha = (x, y) => 32 + (13 * x + 37 * y) % 224;
        for (let i = 0; i < 256; i++) {
          const x = i * 7919 % (width * 2), y = i * 1237 % (height * 2);
          ctx.clearRect(0, 0, 1, 1); ctx.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
          const sx = Math.max(0, Math.min(width - 1, (x + .5) / 2 - .5));
          const sy = Math.max(0, Math.min(height - 1, (y + .5) / 2 - .5));
          const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
          const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
          const expected = Math.round((sourceAlpha(x0, y0) * (1 - fx) + sourceAlpha(x1, y0) * fx) * (1 - fy) +
            (sourceAlpha(x0, y1) * (1 - fx) + sourceAlpha(x1, y1) * fx) * fy);
          alphaError = Math.max(alphaError, Math.abs(ctx.getImageData(0, 0, 1, 1).data[3] - expected));
        }
        const dimensions = [bitmap.width, bitmap.height];
        const displayed = [$('result-image').naturalWidth, $('result-image').naturalHeight];
        const execution = state().executions.filter(item => item.file === file.name && item.group === 'processor').at(-1);
        const passed = alphaError <= 1 && result.blob.type === PNG && result.filename.endsWith('.png') && result.summary.includes('PNG') &&
          dimensions[0] === width * 2 && dimensions[1] === height * 2 && displayed.every((value, i) => value === dimensions[i]) && execution?.result === 'done';
        return {run, passed, alphaError, dimensions, displayed, sourceBytes: file.size, outputBytes: result.blob.size,
          filename: result.filename, execution, fullMs: performance.now() - started};
      } finally { bitmap.close(); canvas.width = canvas.height = 1; }
    };
    for (let run = 1; run <= runs; run++) {
      state().run = run; record('run-start');
      const result = await check(run);
      state().runs.push(result); record('run-finish');
      assert(result.passed, `Maximum UI PNG failed: ${JSON.stringify(result)}`);
    }
    state().step = 'done'; state().passed = state().runs.length === runs && state().errors.length === 0;
  } catch (error) { state().step = 'failed'; state().passed = false; state().error = `${error.message || error}\n${error.stack || ''}`; }
  finally {
    await lock?.release();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pagehide);
    document.getElementById('acceptance-keep-active')?.remove();
  }
}
