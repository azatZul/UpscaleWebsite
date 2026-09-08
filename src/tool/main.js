import {assessPhoto, checkBrowser, DEFAULT_TILE_MS, devicePolicy, durationLabel, estimateDuration} from './capability.js';
import {inspectFile} from './image-info.js';
import {createComparison} from './comparison.js';

const $ = id => document.getElementById(id);
const elements = Object.fromEntries(['photo-input', 'choose-photo', 'drop-zone', 'selected-photo', 'source-thumb',
  'source-name', 'source-size', 'status', 'status-title', 'status-detail', 'progress', 'status-value',
  'process-photo', 'cancel', 'retry', 'cpu-retry', 'app-fallback', 'results', 'result-image', 'result-summary',
  'download-result', 'another-photo', 'start-over', 'limit-note', 'interrupted', 'visibility-note', 'photo-stage',
  'stage-title', 'tool-footnote', 'step-choose', 'step-upscale', 'step-compare', 'before-image', 'result-comparison',
  'comparison-handle', 'face-option', 'enhance-faces', 'face-summary', 'result-viewer', 'result-stage', 'expand-result', 'close-result'].map(id => [id, $(id)]));
const comparison = createComparison(elements['result-comparison'], elements['before-image'], elements['comparison-handle']);
const environment = {userAgent: navigator.userAgent, platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints, deviceMemory: navigator.deviceMemory};
const marker = 'uscale-preview-active-v1';
const tileKey = 'uscale-tile-ms-v1';
const policy = devicePolicy(environment);

// Estimating before any download needs a per-tile figure. Use the measured one
// from this device's last run, otherwise a conservative default.
function knownTileMs() {
  try { const stored = Number(localStorage.getItem(tileKey)); if (stored > 0) return stored; } catch { /* Storage is optional. */ }
  return policy.mobile ? DEFAULT_TILE_MS.mobile : DEFAULT_TILE_MS.desktop;
}
function rememberTileMs(ms) {
  try { if (ms > 0 && Number.isFinite(ms)) localStorage.setItem(tileKey, String(Math.round(ms))); } catch { /* Storage is optional. */ }
}
let worker;
let file;
let phase = 'idle';
let forceCpu = false;
let retriedGpu = false;
let generation = 0;
let thumbnailUrl;
let resultUrl;
let originalUrl;
let timer;
let wakeLock;
let supported = true;
let errorCode;
let runningFaces = false;
let expanded = false;
const stageObserver = new ResizeObserver(entries => {
  const {width, height} = entries[0].contentRect;
  if (height) elements['result-comparison'].style.setProperty('--stage-ratio', width / height);
});
stageObserver.observe(elements['result-stage']);
function expandResult(value) {
  expanded = value;
  elements['result-viewer'].classList.toggle('is-expanded', value);
  document.body.classList.toggle('album-expanded-lock', value);
  elements['expand-result'].hidden = value; elements['close-result'].hidden = !value;
  // Hide the rest of the page from keyboard and assistive navigation while expanded.
  for (const node of document.querySelectorAll('.nav, .tool-heading, .tool-steps, .result-app')) node.inert = value;
  (value ? elements['close-result'] : elements['expand-result']).focus({preventScroll: true});
}
elements['expand-result'].addEventListener('click', () => expandResult(true));
elements['close-result'].addEventListener('click', () => expandResult(false));
document.addEventListener('keydown', event => {
  if (!expanded) return;
  if (event.key === 'Escape') expandResult(false);
  if (event.key === 'Tab') {
    event.preventDefault();
    (document.activeElement === elements['close-result'] ? elements['comparison-handle'] : elements['close-result']).focus();
  }
});
const busy = () => ['checking', 'processing'].includes(phase);

function remember(active) {
  try { active ? localStorage.setItem(marker, String(Date.now())) : localStorage.removeItem(marker); } catch { /* Private browsing still works. */ }
}

function setStatus(title, detail, progress) {
  elements.status.hidden = false;
  elements['status-title'].textContent = title;
  elements['status-detail'].textContent = detail;
  elements.progress.hidden = progress === undefined;
  if (progress !== undefined) elements.progress.value = progress;
  elements['status-value'].textContent = progress === undefined ? '' : `${Math.round(progress * 100)}%`;
}

function refreshControls() {
  const selecting = phase === 'idle';
  document.body.classList.toggle('has-photo', Boolean(file));
  document.body.classList.toggle('has-result', phase === 'done');
  elements['face-option'].hidden = !file || !['ready', 'error'].includes(phase);
  elements['enhance-faces'].disabled = busy();
  const failed = phase === 'error';
  const appOnly = ['browser', 'size', 'format'].includes(errorCode);
  elements['photo-stage'].hidden = phase === 'done';
  elements['drop-zone'].hidden = !selecting || !supported;
  elements['selected-photo'].hidden = !file || phase === 'done';
  elements['stage-title'].textContent = file ? 'Your photo' : 'Choose a photo';
  elements['tool-footnote'].hidden = !selecting;
  elements['photo-input'].disabled = !selecting || !supported;
  elements['choose-photo'].disabled = !selecting || !supported;
  elements['process-photo'].hidden = phase !== 'ready';
  elements.cancel.hidden = !busy();
  const cpuRetry = failed && errorCode === 'gpu' && !forceCpu;
  elements['cpu-retry'].hidden = !cpuRetry;
  elements.retry.hidden = !file || !failed || appOnly || cpuRetry || !supported;
  elements['app-fallback'].hidden = !failed || errorCode === 'download';
  elements['start-over'].hidden = !failed || !file;
  elements['visibility-note'].hidden = !busy() || !document.hidden;
  elements['drop-zone'].setAttribute('aria-disabled', String(!selecting || !supported));
  const currentStep = selecting || !file ? 0 : phase === 'done' ? 2 : 1;
  ['step-choose', 'step-upscale', 'step-compare'].forEach((id, index) => {
    index === currentStep ? elements[id].setAttribute('aria-current', 'step') : elements[id].removeAttribute('aria-current');
    elements[id].classList.toggle('complete', index < currentStep);
  });
}

async function keepAwake() {
  if (document.hidden || !navigator.wakeLock || wakeLock || !busy()) return;
  const current = generation;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (current !== generation || !busy() || wakeLock) { await lock.release(); return; }
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch { /* Optional convenience only. */ }
}

function stopWorker() {
  generation++;
  worker?.terminate(); worker = null;
  clearTimeout(timer);
  remember(false);
  wakeLock?.release().catch(() => {}); wakeLock = null;
}

function watchdog() {
  clearTimeout(timer);
  if (document.hidden || !busy()) return;
  timer = setTimeout(() => fail('timeout', 'Processing stopped responding. You can retry, choose a smaller photo, or try the app.'), 120_000);
}

function clearOutput() {
  if (expanded) expandResult(false);
  elements.results.hidden = true;
  elements['result-image'].removeAttribute('src');
  elements['before-image'].removeAttribute('src');
  elements['download-result'].removeAttribute('href');
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  resultUrl = undefined;
  originalUrl = undefined;
  comparison.reset();
}

function fail(code, message) {
  if (runningFaces && code === 'gpu' && !forceCpu) { startFaces(true); return; }
  if (runningFaces && code !== 'download') code = 'face';
  if (code === 'gpu' && !forceCpu && !retriedGpu) {
    retriedGpu = true;
    prepare(true, true);
    return;
  }
  stopWorker();
  phase = 'error';
  errorCode = code;
  if (!thumbnailUrl && file) elements['source-size'].textContent = 'Photo not processed';
  const cannotProcess = ['browser', 'size', 'format'].includes(code);
  setStatus(cannotProcess ? 'Try this photo in the app' : 'Couldn’t finish this photo', message);
  refreshControls();
}

function onMessage(data, current) {
  if (current !== generation) return;
  watchdog();
  if (data.type === 'status') {
    const eta = Number.isFinite(data.remainingMs) && data.remainingMs > 5000
      ? `${durationLabel(data.remainingMs)} remaining. ` : '';
    setStatus(data.title, eta + (data.detail || ''), data.progress);
  } else if (data.type === 'photo') {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    thumbnailUrl = URL.createObjectURL(data.thumbnail);
    elements['source-thumb'].src = thumbnailUrl;
    elements['source-size'].textContent = `${data.plan.width} × ${data.plan.height} → ${data.plan.outputWidth} × ${data.plan.outputHeight}`;
  } else if (data.type === 'ready') {
    phase = 'ready';
    remember(false); clearTimeout(timer);
    wakeLock?.release().catch(() => {}); wakeLock = null;
    setStatus(data.slow ? 'This photo may take a while' : 'Ready to upscale',
      `Photo upscaling: ${durationLabel(data.milliseconds)}. Separate face enhancement adds time when enabled.`);
    refreshControls();
  } else if (data.type === 'faces') {
    runningFaces = false;
    prepare(forceCpu, true, data);
  } else if (data.type === 'error') {
    fail(data.code, data.message);
  } else if (data.type === 'done') {
    stopWorker(); phase = 'done';
    // Only learn from a run long enough to amortise first-inference shader
    // setup. A four-tile photo would otherwise teach a badly pessimistic rate.
    if (data.plan?.tileCount >= 16 && data.tilesMs) rememberTileMs(data.tilesMs / data.plan.tileCount);
    clearOutput();
    resultUrl = URL.createObjectURL(data.blob);
    // Decode the original for comparison only after inference has finished.
    // A thumbnail here would make the "before" side artificially blurry.
    originalUrl = URL.createObjectURL(file);
    elements['result-image'].src = resultUrl;
    elements['before-image'].src = originalUrl;
    elements['result-comparison'].style.aspectRatio = `${data.plan.width} / ${data.plan.height}`;
    elements['result-comparison'].style.setProperty('--photo-ratio', data.plan.width / data.plan.height);
    elements['download-result'].href = resultUrl;
    elements['download-result'].download = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}-uscale-2x.jpg`;
    elements['result-summary'].textContent = `${data.plan.width} × ${data.plan.height} → ${data.plan.outputWidth} × ${data.plan.outputHeight} · JPEG`;
    elements['face-summary'].textContent = data.faceEnabled
      ? data.faceCount ? `${data.faceCount} face${data.faceCount === 1 ? '' : 's'} enhanced separately${data.detectedCount > data.faceCount ? ' · Some faces could not be enhanced' : ''}`
        : data.detectedCount ? 'No suitable faces for separate enhancement · Photo upscaled 2×' : 'No faces detected · Photo upscaled 2×'
      : 'Photo upscaled 2× · Separate face enhancement off';
    elements.results.hidden = false;
    refreshControls();
    elements.results.focus({preventScroll: true});
    elements.results.scrollIntoView({behavior: 'smooth', block: 'start'});
  }
}

function prepare(cpu = false, autoStart = false, faceResults) {
  if (!file || !supported) return;
  stopWorker();
  forceCpu = cpu;
  clearOutput();
  runningFaces = false;
  phase = autoStart ? 'processing' : 'checking';
  errorCode = undefined;
  elements.interrupted.hidden = true;
  setStatus(cpu ? 'Trying another processing method' : 'Preparing',
    cpu ? 'Checking the CPU option. It may take longer.' : 'Loading the upscaler. Your photo stays on this device.');
  refreshControls();
  const current = generation;
  try {
    worker = new Worker(new URL('./processor.worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = event => onMessage(event.data, current);
    worker.onerror = event => { event.preventDefault(); if (current === generation) fail('runtime', 'The processing task stopped. Try again or use the app.'); };
    worker.onmessageerror = () => { if (current === generation) fail('runtime', 'The browser couldn’t read the processing result. Try the app.'); };
    remember(true);
    worker.postMessage({type: 'prepare', file, environment, forceCpu, autoStart, faceResults}, faceResults?.faces.map(face => face.pixels.buffer) || []);
    watchdog(); keepAwake();
  } catch { fail('browser', 'This browser couldn’t start a processing task. Try a current browser or get the app.'); }
}

function startFaces(cpu = false) {
  stopWorker(); forceCpu = cpu; runningFaces = true; phase = 'processing';
  const current = generation;
  setStatus('Finding faces', 'Face enhancement runs separately, on this device.');
  refreshControls(); remember(true); watchdog(); keepAwake();
  try {
    worker = new Worker(new URL('./face.worker.js', import.meta.url));
    worker.onmessage = event => onMessage(event.data, current);
    worker.onerror = event => { event.preventDefault(); if (current === generation) fail('face', 'Face enhancement stopped. Turn it off and try again, or use the app.'); };
    worker.onmessageerror = () => { if (current === generation) fail('face', 'Face enhancement stopped. Turn it off and try again, or use the app.'); };
    worker.postMessage({file, environment, forceCpu});
  } catch { fail('face', 'This browser couldn’t start face enhancement. Turn it off and try again, or use the app.'); }
}

async function chooseFile(next) {
  if (!next || phase !== 'idle' || !supported) return;
  file = next; retriedGpu = false;
  if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  thumbnailUrl = URL.createObjectURL(file);
  elements['source-thumb'].src = thumbnailUrl;
  elements['source-name'].textContent = file.name;
  elements['source-size'].textContent = 'Checking image dimensions…';
  // Decide from the file header alone, before downloading an engine or model.
  // A photo this device cannot take is refused straight away rather than after
  // a download and a speed test.
  let plan;
  try { plan = assessPhoto(await inspectFile(next), policy); }
  catch (error) {
    elements['source-size'].textContent = 'Photo not processed';
    fail(error.code || 'format', error.message);
    return;
  }
  const {milliseconds, slow} = estimateDuration(knownTileMs(), plan.tileCount);
  phase = 'ready'; errorCode = undefined;
  elements['source-size'].textContent = `${plan.width} × ${plan.height} → ${plan.outputWidth} × ${plan.outputHeight}`;
  setStatus(slow ? `This photo takes ${durationLabel(milliseconds)} on this device` : 'Ready to upscale',
    slow ? 'Large photos are slow in a browser. You can still upscale it here, or get full speed in the app.'
      : `Takes ${durationLabel(milliseconds)}. Your photo stays on this device.`);
  refreshControls();
}

elements['choose-photo'].addEventListener('click', () => elements['photo-input'].click());
elements['photo-input'].addEventListener('change', () => { chooseFile(elements['photo-input'].files[0]).catch(() => fail('format', 'We couldn’t read this photo. Try a JPEG, PNG or WebP image.')); });
elements['process-photo'].addEventListener('click', () => {
  if (phase !== 'ready' || !file) return;
  if (elements['enhance-faces'].checked) { startFaces(forceCpu); return; }
  prepare(forceCpu, true);
});
elements.cancel.addEventListener('click', () => {
  reset();
  setStatus('Processing cancelled', 'Your photo stayed on this device. Choose a photo when you’re ready.');
});
elements.retry.addEventListener('click', () => { retriedGpu = false; prepare(forceCpu, true); });
elements['cpu-retry'].addEventListener('click', () => prepare(true, true));
function reset() {
  stopWorker(); phase = 'idle'; file = null;
  errorCode = undefined;
  clearOutput(); elements.status.hidden = true; elements['selected-photo'].hidden = true;
  elements['photo-input'].value = '';
  if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  thumbnailUrl = undefined; elements['source-thumb'].removeAttribute('src');
  refreshControls(); elements['choose-photo'].focus({preventScroll: true});
  elements['photo-stage'].scrollIntoView({behavior: 'smooth', block: 'start'});
}
elements['another-photo'].addEventListener('click', reset);
elements['start-over'].addEventListener('click', reset);
for (const eventName of ['dragenter', 'dragover']) elements['drop-zone'].addEventListener(eventName, event => {
  event.preventDefault(); if (phase === 'idle') elements['drop-zone'].classList.add('dragging');
});
for (const eventName of ['dragleave', 'drop']) elements['drop-zone'].addEventListener(eventName, event => {
  event.preventDefault(); elements['drop-zone'].classList.remove('dragging');
  if (eventName === 'drop') {
    if (event.dataTransfer.files.length > 1) setStatus('Choose one photo at a time', 'Drop a single photo to get started.');
    else chooseFile(event.dataTransfer.files[0]).catch(() => fail('format', 'We couldn’t read this photo. Try a JPEG, PNG or WebP image.'));
  }
});
document.addEventListener('visibilitychange', () => { refreshControls(); watchdog(); keepAwake(); });
window.addEventListener('pagehide', () => {
  const interrupted = busy();
  stopWorker(); if (interrupted) remember(true);
  if (phase !== 'done') phase = 'cancelled';
});
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    if (phase === 'done') return;
    reset();
    setStatus('Choose your photo again', 'The previous processing task ended when you left this page.');
  }
});

try {
  const pending = Number(localStorage.getItem(marker));
  elements.interrupted.hidden = !(pending > 0 && Date.now() - pending < 24 * 60 * 60 * 1000);
  remember(false);
} catch { /* Browser storage is optional. */ }
elements['limit-note'].textContent = `JPEG, PNG or WebP · up to ${policy.maxInputPixels / 1_000_000} MP on this device · 50 MB maximum`;
try {
  checkBrowser({secure: isSecureContext, worker: typeof Worker === 'function', wasm: typeof WebAssembly === 'object',
    bitmap: typeof createImageBitmap === 'function', offscreen: typeof OffscreenCanvas === 'function'});
} catch (error) { supported = false; fail(error.code, error.message); }
refreshControls();
