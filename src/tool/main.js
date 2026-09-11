import {assessPhoto, checkBrowser, DEFAULT_TILE_MS, devicePolicy, estimateDuration, maxInputPixelsForScale, supportsScale} from './capability.js';
import {inspectFile} from './image-info.js';
import {createComparison} from './comparison.js';
import {createPanZoom} from './pan-zoom.js';
import {pageTranslator} from './i18n.js';

const {t, duration} = pageTranslator(document);
const $ = id => document.getElementById(id);
const elements = Object.fromEntries(['photo-input', 'choose-photo', 'replace-photo', 'drop-zone', 'drop-empty',
  'selected-photo', 'source-thumb', 'source-name', 'source-size', 'status-title', 'status-detail', 'progress',
  'status-value', 'process-photo', 'cancel', 'retry', 'cpu-retry', 'try-2x', 'results', 'result-image', 'result-summary',
  'download-result', 'another-photo', 'limit-note', 'interrupted', 'visibility-note', 'photo-stage', 'stage-title',
  'step-choose', 'step-upscale', 'step-compare', 'before-image', 'result-comparison', 'comparison-handle', 'enhance-faces',
  'face-summary', 'result-viewer', 'result-stage', 'expand-result', 'close-result', 'scale-2x', 'scale-4x', 'scale-note',
  'result-tag'].map(id => [id, $(id)]));
const comparison = createComparison(elements['result-comparison'], elements['before-image'], elements['comparison-handle'],
  value => t('slider_value', {value}));
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
let scale = 2;
// idle (no photo) → assessing → ready → checking/processing → done, or error.
let phase = 'idle';
let forceCpu = false;
let retriedGpu = false;
let generation = 0;
// Bumped per header check, so a slow check can't overwrite a newer photo.
let selection = 0;
let thumbnailUrl;
let resultUrl;
let originalUrl;
let timer;
let wakeLock;
let supported = true;
let errorCode;
let scaleFallback = false;
let runningFaces = false;
let expanded = false;
const panZoom = createPanZoom({root: elements['result-viewer'], stage: elements['result-stage'],
  frame: elements['result-comparison'], active: () => expanded});
const stageObserver = new ResizeObserver(entries => {
  const {width, height} = entries[0].contentRect;
  if (height) elements['result-comparison'].style.setProperty('--stage-ratio', width / height);
  panZoom.clamp();
});
stageObserver.observe(elements['result-stage']);
function expandResult(value) {
  expanded = value;
  elements['result-viewer'].classList.toggle('is-expanded', value);
  panZoom.reset();
  document.body.classList.toggle('album-expanded-lock', value);
  elements['expand-result'].hidden = value; elements['close-result'].hidden = !value;
  // Hide the rest of the page from keyboard and assistive navigation while expanded.
  for (const node of document.querySelectorAll('.nav, .skip-link, .tool-heading, .tool-steps, #photo-stage, .inline-cta, footer')) node.inert = value;
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
const dimensions = plan => `${plan.width} × ${plan.height} → ${plan.outputWidth} × ${plan.outputHeight}`;

function remember(active) {
  try { active ? localStorage.setItem(marker, String(Date.now())) : localStorage.removeItem(marker); } catch { /* Private browsing still works. */ }
}

function setStatus(title, detail, progress) {
  elements['status-title'].textContent = title;
  elements['status-title'].hidden = !title;
  elements['status-detail'].textContent = detail;
  elements.progress.hidden = progress === undefined;
  if (progress !== undefined) elements.progress.value = progress;
  elements['status-value'].textContent = progress === undefined ? '' : `${Math.round(progress * 100)}%`;
}
const idleStatus = () => setStatus('', t('idle_detail'));

// The card keeps one layout from the first visit to the finished photo: the
// drop zone swaps its contents, and the options and main button stay put.
function refreshControls() {
  const hasFile = Boolean(file);
  const locked = busy() || !supported;
  const failed = phase === 'error';
  elements['drop-empty'].hidden = hasFile;
  elements['selected-photo'].hidden = !hasFile;
  elements['stage-title'].textContent = t(hasFile ? 'your_photo' : 'choose_title');
  elements['drop-zone'].setAttribute('aria-disabled', String(locked));
  for (const id of ['photo-input', 'choose-photo', 'replace-photo', 'scale-2x', 'enhance-faces']) elements[id].disabled = locked;
  elements['scale-4x'].disabled = locked || !supportsScale(policy, 4);
  const appOnly = ['browser', 'size', 'format'].includes(errorCode);
  const cpuRetry = failed && errorCode === 'gpu' && !forceCpu;
  const tryTwo = failed && scaleFallback;
  const retry = hasFile && failed && !appOnly && !cpuRetry && !tryTwo && supported;
  elements['process-photo'].hidden = busy() || cpuRetry || tryTwo || retry;
  elements['process-photo'].disabled = phase !== 'ready';
  elements.cancel.hidden = !busy();
  elements['cpu-retry'].hidden = !cpuRetry;
  elements.retry.hidden = !retry;
  elements['try-2x'].hidden = !tryTwo;
  elements['visibility-note'].hidden = !busy() || !document.hidden;
  const currentStep = !hasFile ? 0 : phase === 'done' ? 2 : 1;
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
  runningFaces = false;
  remember(false);
  wakeLock?.release().catch(() => {}); wakeLock = null;
}

function watchdog() {
  clearTimeout(timer);
  if (document.hidden || !busy()) return;
  timer = setTimeout(() => fail('timeout', 'err_timeout'), 120_000);
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

function fail(code, key, params, offerScaleFallback = false) {
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
  scaleFallback = offerScaleFallback;
  if (!thumbnailUrl && file) elements['source-size'].textContent = t('not_processed');
  const cannotProcess = ['browser', 'size', 'format'].includes(code);
  setStatus(t(cannotProcess ? 'cannot_title' : 'failed_title'), t(key, params));
  refreshControls();
}

function onMessage(data, current) {
  if (current !== generation) return;
  watchdog();
  if (data.type === 'status') {
    const eta = Number.isFinite(data.remainingMs) && data.remainingMs > 5000
      ? `${t('remaining', {time: duration(data.remainingMs)})} ` : '';
    setStatus(t(data.title, data.params), eta + (data.detail ? t(data.detail, data.params) : ''), data.progress);
  } else if (data.type === 'photo') {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    thumbnailUrl = URL.createObjectURL(data.thumbnail);
    elements['source-thumb'].src = thumbnailUrl;
    elements['source-size'].textContent = dimensions(data.plan);
  } else if (data.type === 'ready') {
    phase = 'ready';
    remember(false); clearTimeout(timer);
    wakeLock?.release().catch(() => {}); wakeLock = null;
    const time = duration(data.milliseconds);
    setStatus(data.slow ? t('slow_title', {time}) : t('ready'), t('probe_detail', {time}));
    refreshControls();
  } else if (data.type === 'faces') {
    runningFaces = false;
    prepare(forceCpu, true, data);
  } else if (data.type === 'error') {
    fail(data.code, data.key, data.params);
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
    const resultScale = data.plan.scale;
    elements['result-image'].alt = t('result_alt', {scale: resultScale});
    elements['result-tag'].textContent = t('result_tag', {scale: resultScale});
    elements['download-result'].href = resultUrl;
    elements['download-result'].download = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}-uscale-${resultScale}x.jpg`;
    elements['result-summary'].textContent = `${dimensions(data.plan)} · JPEG`;
    const faces = !data.faceEnabled ? t('faces_off')
      : data.faceCount ? t('faces_enhanced', {count: data.faceCount}) + (data.detectedCount > data.faceCount ? ` · ${t('faces_partial')}` : '')
        : t(data.detectedCount ? 'faces_none_suitable' : 'faces_none');
    elements['face-summary'].textContent = `${t('upscaled', {scale: resultScale})} · ${faces}`;
    setStatus(t('done_title'), t('done_detail'));
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
  phase = autoStart ? 'processing' : 'checking';
  errorCode = undefined; scaleFallback = false;
  elements.interrupted.hidden = true;
  setStatus(t(cpu ? 'cpu_title' : 'preparing'), t(cpu ? 'cpu_detail' : 'preparing_detail'));
  refreshControls();
  const current = generation;
  try {
    worker = new Worker(new URL('./processor.worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = event => onMessage(event.data, current);
    worker.onerror = event => { event.preventDefault(); if (current === generation) fail('runtime', 'err_task_stopped'); };
    worker.onmessageerror = () => { if (current === generation) fail('runtime', 'err_result_read'); };
    remember(true);
    worker.postMessage({type: 'prepare', file, environment, forceCpu, autoStart, faceResults, scale}, faceResults?.faces.map(face => face.pixels.buffer) || []);
    watchdog(); keepAwake();
  } catch { fail('browser', 'err_worker_start'); }
}

function startFaces(cpu = false) {
  stopWorker(); forceCpu = cpu; runningFaces = true; phase = 'processing';
  errorCode = undefined; scaleFallback = false;
  const current = generation;
  clearOutput();
  setStatus(t('finding_faces'), t('finding_faces_detail'));
  refreshControls(); remember(true); watchdog(); keepAwake();
  try {
    worker = new Worker(new URL('./face.worker.js', import.meta.url));
    worker.onmessage = event => onMessage(event.data, current);
    worker.onerror = event => { event.preventDefault(); if (current === generation) fail('face', 'err_face_stopped'); };
    worker.onmessageerror = () => { if (current === generation) fail('face', 'err_face_stopped'); };
    worker.postMessage({file, environment, forceCpu});
  } catch { fail('face', 'err_face_start'); }
}

function start() {
  if (!file || !supported || busy()) return;
  retriedGpu = false;
  if (elements['enhance-faces'].checked) startFaces(forceCpu);
  else prepare(forceCpu, true);
}

// Decide from the file header alone, before downloading an engine or model.
// A photo this device cannot take is refused straight away rather than after
// a download and a speed test. Runs for a new photo and again whenever the
// scale or face option changes for the photo already in the drop zone.
async function assessCurrentFile() {
  if (!file || busy()) return;
  const current = ++selection;
  clearOutput();
  phase = 'assessing'; errorCode = undefined; scaleFallback = false;
  elements['source-size'].textContent = t('checking_size');
  refreshControls();
  let plan, info;
  try {
    info = await inspectFile(file);
    if (current !== selection) return;
    plan = assessPhoto(info, policy, scale);
  } catch (error) {
    if (current !== selection) return;
    elements['source-size'].textContent = t('not_processed');
    // Only 4x can be too big while 2x of the same photo would still fit --
    // that is the one case worth offering a one-click way out of, instead of
    // just "choose a different photo".
    let offerScaleFallback = false;
    if (scale === 4 && error.code === 'size' && info) {
      try { assessPhoto(info, policy, 2); offerScaleFallback = true; } catch { /* Still too big at 2x either. */ }
    }
    fail(error.code || 'format', error.key || 'err_unreadable', error.params, offerScaleFallback);
    return;
  }
  const {milliseconds, slow} = estimateDuration(knownTileMs(), plan.tileCount);
  const time = duration(milliseconds);
  phase = 'ready';
  elements['source-size'].textContent = dimensions(plan);
  setStatus(slow ? t('slow_title', {time}) : t('ready'), t(slow ? 'slow_detail' : 'ready_detail', {time}));
  refreshControls();
}

async function chooseFile(next) {
  if (!next || busy() || !supported) return;
  stopWorker();
  file = next; retriedGpu = false; forceCpu = false;
  if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  thumbnailUrl = URL.createObjectURL(file);
  elements['source-thumb'].src = thumbnailUrl;
  elements['source-name'].textContent = file.name;
  await assessCurrentFile();
}

function setScale(value) {
  scale = value;
  elements['scale-2x'].setAttribute('aria-pressed', String(value === 2));
  elements['scale-4x'].setAttribute('aria-pressed', String(value === 4));
  elements['limit-note'].textContent = t('limit_note', {mp: maxInputPixelsForScale(policy, scale) / 1_000_000, scale});
  elements['process-photo'].textContent = t('upscale_button', {scale});
}
elements['scale-2x'].addEventListener('click', () => { if (scale !== 2) { setScale(2); assessCurrentFile(); } });
elements['scale-4x'].addEventListener('click', () => { if (scale !== 4) { setScale(4); assessCurrentFile(); } });
elements['scale-note'].hidden = supportsScale(policy, 4);
// A finished or failed photo gets a fresh check, so the other setting can run.
elements['enhance-faces'].addEventListener('change', () => { if (['done', 'error'].includes(phase)) assessCurrentFile(); });

const readFailure = () => fail('format', 'err_unreadable');
const openPicker = () => { if (!busy() && supported) elements['photo-input'].click(); };
elements['choose-photo'].addEventListener('click', openPicker);
elements['replace-photo'].addEventListener('click', openPicker);
// The whole zone is a click target; its buttons stay the keyboard path.
elements['drop-zone'].addEventListener('click', event => { if (!event.target.closest('button')) openPicker(); });
elements['photo-input'].addEventListener('change', () => {
  const next = elements['photo-input'].files[0];
  elements['photo-input'].value = '';
  chooseFile(next).catch(readFailure);
});
elements['process-photo'].addEventListener('click', () => { if (phase === 'ready') start(); });
elements.retry.addEventListener('click', start);
elements['cpu-retry'].addEventListener('click', () => prepare(true, true));
elements['try-2x'].addEventListener('click', () => { setScale(2); assessCurrentFile(); });
elements.cancel.addEventListener('click', () => {
  stopWorker(); clearOutput();
  phase = 'ready';
  setStatus(t('cancelled'), t('cancelled_detail'));
  refreshControls();
});
function reset() {
  stopWorker(); selection++; phase = 'idle'; file = null;
  errorCode = undefined; scaleFallback = false; forceCpu = false;
  clearOutput(); idleStatus();
  elements['photo-input'].value = '';
  if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  thumbnailUrl = undefined; elements['source-thumb'].removeAttribute('src');
  refreshControls(); elements['choose-photo'].focus({preventScroll: true});
  elements['photo-stage'].scrollIntoView({behavior: 'smooth', block: 'start'});
}
elements['another-photo'].addEventListener('click', reset);

const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
for (const eventName of ['dragenter', 'dragover']) elements['drop-zone'].addEventListener(eventName, event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (!busy() && supported) elements['drop-zone'].classList.add('dragging');
});
elements['drop-zone'].addEventListener('dragleave', event => {
  if (!elements['drop-zone'].contains(event.relatedTarget)) elements['drop-zone'].classList.remove('dragging');
});
elements['drop-zone'].addEventListener('drop', event => {
  event.preventDefault(); elements['drop-zone'].classList.remove('dragging');
  if (busy() || !supported) return;
  if (event.dataTransfer.files.length > 1) setStatus(t('one_at_a_time'), t('one_at_a_time_detail'));
  else chooseFile(event.dataTransfer.files[0]).catch(readFailure);
});
// A photo dropped beside the zone would otherwise open in the tab and end the session.
for (const eventName of ['dragover', 'drop']) window.addEventListener(eventName, event => { if (hasFiles(event)) event.preventDefault(); });

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
    setStatus(t('choose_again'), t('choose_again_detail'));
  }
});

try {
  const pending = Number(localStorage.getItem(marker));
  elements.interrupted.hidden = !(pending > 0 && Date.now() - pending < 24 * 60 * 60 * 1000);
  remember(false);
} catch { /* Browser storage is optional. */ }
setScale(2);
idleStatus();
try {
  checkBrowser({secure: isSecureContext, worker: typeof Worker === 'function', wasm: typeof WebAssembly === 'object',
    bitmap: typeof createImageBitmap === 'function', offscreen: typeof OffscreenCanvas === 'function'});
} catch (error) { supported = false; fail(error.code, error.key); }
refreshControls();
