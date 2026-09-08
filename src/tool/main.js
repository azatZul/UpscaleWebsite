import {checkBrowser, devicePolicy, durationLabel} from './capability.js';

const $ = id => document.getElementById(id);
const elements = Object.fromEntries(['photo-input', 'choose-photo', 'sample-photo', 'drop-zone', 'selected-photo', 'source-thumb',
  'source-name', 'source-size', 'change-photo', 'status', 'status-title', 'status-detail', 'progress', 'status-value',
  'process-photo', 'cancel', 'retry', 'cpu-retry', 'app-fallback', 'results', 'result-image', 'result-summary',
  'download-result', 'another-photo', 'limit-note', 'interrupted', 'visibility-note'].map(id => [id, $(id)]));
const environment = {userAgent: navigator.userAgent, platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints, deviceMemory: navigator.deviceMemory};
const marker = 'uscale-preview-active-v1';
let worker;
let file;
let phase = 'idle';
let forceCpu = false;
let retriedGpu = false;
let generation = 0;
let thumbnailUrl;
let resultUrl;
let timer;
let wakeLock;
let supported = true;
let loadingSample = false;
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
  elements['photo-input'].disabled = busy() || !supported;
  elements['choose-photo'].disabled = busy() || !supported;
  elements['sample-photo'].disabled = busy() || loadingSample || !supported;
  elements['change-photo'].disabled = busy();
  elements['process-photo'].hidden = phase !== 'ready';
  elements.cancel.hidden = !busy();
  elements.retry.hidden = !file || !['error', 'cancelled'].includes(phase) || !supported;
  elements['visibility-note'].hidden = !busy() || !document.hidden;
  elements['drop-zone'].setAttribute('aria-disabled', String(busy() || !supported));
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
  elements.results.hidden = true;
  elements['result-image'].removeAttribute('src');
  elements['download-result'].removeAttribute('href');
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
}

function fail(code, message) {
  const duringCheck = phase === 'checking';
  if (code === 'gpu' && duringCheck && !forceCpu && !retriedGpu) {
    retriedGpu = true;
    prepare(true);
    return;
  }
  stopWorker();
  phase = 'error';
  if (!thumbnailUrl && file) elements['source-size'].textContent = 'Photo not processed';
  const cannotProcess = ['browser', 'size', 'format'].includes(code);
  setStatus(cannotProcess ? 'Try this photo in the app' : 'Couldn’t finish this photo', message);
  elements['app-fallback'].hidden = false;
  elements['cpu-retry'].hidden = code !== 'gpu' || forceCpu;
  refreshControls();
  if (cannotProcess) elements.retry.hidden = true;
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
      `Estimated time: ${durationLabel(data.milliseconds)}. ${data.slow ? 'Keep this page open, or use the app instead.' : 'Your photo will be processed on this device.'}`);
    elements['process-photo'].textContent = data.slow ? 'Continue in browser · 2×' : 'Upscale photo · 2×';
    elements['app-fallback'].hidden = !data.slow;
    refreshControls();
  } else if (data.type === 'error') {
    fail(data.code, data.message);
  } else if (data.type === 'done') {
    stopWorker(); phase = 'done';
    clearOutput();
    resultUrl = URL.createObjectURL(data.blob);
    elements['result-image'].src = resultUrl;
    elements['download-result'].href = resultUrl;
    elements['download-result'].download = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}-uscale-2x.jpg`;
    elements['result-summary'].textContent = `${data.plan.width} × ${data.plan.height} → ${data.plan.outputWidth} × ${data.plan.outputHeight}. Saved as JPEG. Your photo was never uploaded.`;
    setStatus('Your photo is ready', 'Download the full-size result below.', 1);
    elements.results.hidden = false;
    elements['app-fallback'].hidden = true;
    refreshControls();
    elements.results.focus({preventScroll: true});
    elements.results.scrollIntoView({behavior: 'smooth', block: 'start'});
  }
}

function prepare(cpu = false) {
  if (!file || !supported) return;
  stopWorker();
  forceCpu = cpu;
  clearOutput();
  phase = 'checking';
  elements.interrupted.hidden = true;
  elements['app-fallback'].hidden = true;
  elements['cpu-retry'].hidden = true;
  setStatus(cpu ? 'Trying another processing method' : 'Checking this browser and photo',
    cpu ? 'Checking the CPU option. It may take longer.' : 'A small test will estimate how long your photo will take.');
  refreshControls();
  const current = generation;
  try {
    worker = new Worker(new URL('./processor.worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = event => onMessage(event.data, current);
    worker.onerror = event => { event.preventDefault(); if (current === generation) fail('runtime', 'The processing task stopped. Try again or use the app.'); };
    worker.onmessageerror = () => { if (current === generation) fail('runtime', 'The browser couldn’t read the processing result. Try the app.'); };
    remember(true);
    worker.postMessage({type: 'prepare', file, environment, forceCpu});
    watchdog(); keepAwake();
  } catch { fail('browser', 'This browser couldn’t start a processing task. Try a current browser or get the app.'); }
}

function chooseFile(next) {
  if (!next || busy() || !supported) return;
  file = next; retriedGpu = false;
  if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  thumbnailUrl = undefined;
  elements['source-thumb'].removeAttribute('src');
  elements['source-name'].textContent = file.name;
  elements['source-size'].textContent = 'Checking image dimensions…';
  elements['selected-photo'].hidden = false;
  prepare();
}

elements['choose-photo'].addEventListener('click', () => elements['photo-input'].click());
elements['change-photo'].addEventListener('click', () => { elements['photo-input'].value = ''; elements['photo-input'].click(); });
elements['photo-input'].addEventListener('change', () => chooseFile(elements['photo-input'].files[0]));
elements['sample-photo'].addEventListener('click', async () => {
  if (busy() || loadingSample) return;
  const current = generation;
  loadingSample = true; refreshControls();
  try {
    const response = await fetch('/resources/before_after/hero_girls_play_before.jpg');
    if (!response.ok) throw new Error('Sample unavailable');
    const blob = await response.blob();
    if (!busy() && current === generation) chooseFile(new File([blob], 'uscale-sample.jpg', {type: 'image/jpeg'}));
  } catch {
    if (current === generation) setStatus('The sample couldn’t load', 'Check your connection, or choose a photo from your device.');
  } finally { loadingSample = false; refreshControls(); }
});
elements['process-photo'].addEventListener('click', () => {
  if (phase !== 'ready' || !worker) return;
  phase = 'processing'; remember(true); refreshControls(); watchdog(); keepAwake();
  worker.postMessage({type: 'process'});
});
elements.cancel.addEventListener('click', () => {
  stopWorker(); phase = 'cancelled';
  setStatus('Processing cancelled', 'Your photo stayed on this device. You can retry or choose another photo.');
  refreshControls();
});
elements.retry.addEventListener('click', () => { retriedGpu = false; prepare(forceCpu); });
elements['cpu-retry'].addEventListener('click', () => prepare(true));
elements['another-photo'].addEventListener('click', () => {
  stopWorker(); phase = 'idle'; file = null;
  clearOutput(); elements.status.hidden = true; elements['selected-photo'].hidden = true;
  elements['photo-input'].value = '';
  if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  thumbnailUrl = undefined; elements['source-thumb'].removeAttribute('src');
  refreshControls(); elements['choose-photo'].focus();
});
for (const eventName of ['dragenter', 'dragover']) elements['drop-zone'].addEventListener(eventName, event => {
  event.preventDefault(); if (!busy()) elements['drop-zone'].classList.add('dragging');
});
for (const eventName of ['dragleave', 'drop']) elements['drop-zone'].addEventListener(eventName, event => {
  event.preventDefault(); elements['drop-zone'].classList.remove('dragging');
  if (eventName === 'drop') chooseFile(event.dataTransfer.files[0]);
});
document.addEventListener('visibilitychange', () => { refreshControls(); watchdog(); keepAwake(); });
window.addEventListener('pagehide', () => {
  const interrupted = busy();
  stopWorker(); if (interrupted) remember(true);
  phase = 'cancelled';
});
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    setStatus('Check your photo again', 'The previous processing task ended when you left this page.');
    refreshControls();
  }
});

try {
  const pending = Number(localStorage.getItem(marker));
  elements.interrupted.hidden = !(pending > 0 && Date.now() - pending < 24 * 60 * 60 * 1000);
  remember(false);
} catch { /* Browser storage is optional. */ }
elements['limit-note'].textContent = `JPEG, PNG or WebP · up to ${devicePolicy(environment).maxInputPixels / 1_000_000} MP on this device · 50 MB maximum`;
try {
  checkBrowser({secure: isSecureContext, worker: typeof Worker === 'function', wasm: typeof WebAssembly === 'object',
    bitmap: typeof createImageBitmap === 'function', offscreen: typeof OffscreenCanvas === 'function'});
} catch (error) { supported = false; fail(error.code, error.message); }
refreshControls();
