import {assessPhoto, checkBrowser, DEFAULT_TILE_MS, devicePolicy, estimateDuration, maxInputPixelsForScale, supportsScale} from './capability.js';
import {inspectFile} from './image-info.js';
import {createComparison} from './comparison.js';
import {createPanZoom} from './pan-zoom.js';
import {pageTranslator} from './i18n.js';
import {boxPercent} from './face-detect.js';
import {pendingEnhancements, sameSelection, selectedPatches} from './face-selection.js';
import {createOverlay} from './overlay.js';
import {shouldEnhanceFaces, tileMetricKey} from './model-selection.js';

const {t, duration} = pageTranslator(document);
const $ = id => document.getElementById(id);
const elements = Object.fromEntries(['photo-input', 'choose-photo', 'remove-photo', 'drop-zone', 'drop-empty',
  'selected-photo', 'source-thumb', 'source-name', 'source-size', 'status-title', 'status-detail', 'progress',
  'status-value', 'process-photo', 'cancel', 'retry', 'cpu-retry', 'try-2x', 'results', 'result-image', 'result-summary',
  'download-result', 'another-photo', 'limit-note', 'interrupted', 'visibility-note', 'photo-stage', 'stage-title',
  'step-choose', 'step-upscale', 'step-compare', 'before-image', 'result-comparison', 'comparison-handle', 'enhance-faces',
  'face-summary', 'result-viewer', 'result-stage', 'expand-result', 'close-result', 'scale-2x', 'scale-4x', 'scale-popover',
  'result-tag', 'result-title', 'model-photo', 'model-drawing', 'face-option', 'choose-faces', 'face-editor', 'face-stage',
  'face-frame', 'face-photo', 'face-marks', 'face-apply', 'face-cancel', 'face-close', 'face-editor-title',
  'face-status', 'face-progress', 'photo-error', 'status', 'tool-options', 'choose-another'].map(id => [id, $(id)]));
const comparison = createComparison(elements['result-comparison'], elements['before-image'], elements['comparison-handle'],
  value => t('slider_value', {value}));
const environment = {userAgent: navigator.userAgent, platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints, deviceMemory: navigator.deviceMemory};
const marker = 'uscale-preview-active-v1';
const policy = devicePolicy(environment);

// Estimating before any download needs a per-tile figure. Use the measured one
// from this device's last run, otherwise a conservative default.
function knownTileMs() {
  try { const stored = Number(localStorage.getItem(tileMetricKey(modelKind, scale))); if (stored > 0) return stored; }
  catch { /* Storage is optional. */ }
  return policy.mobile ? DEFAULT_TILE_MS.mobile : DEFAULT_TILE_MS.desktop;
}
function rememberTileMs(ms, kind, factor) {
  try {
    if (ms > 0 && Number.isFinite(ms)) localStorage.setItem(tileMetricKey(kind, factor), String(Math.round(ms)));
  } catch { /* Storage is optional. */ }
}
let worker;
let file;
let scale = 2;
let modelKind = 'photo';
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
// The current photo fits at 2× but not at 4×, so 4× is shown as unavailable.
let tooLargeFor4x = false;
let popoverTimer;
let runningFaces = false;
let expanded = false;
let lastResult;
// Picker state stays transferable: a faceless base plus cached face patches.
let faceEdit;
let faceChoice;
let faceOpen = false;
let applying = false;
let applyToken = 0;
let applyTimer;
let applyWorker;
let applyForceCpu = false;
const panZoom = createPanZoom({root: elements['result-viewer'], stage: elements['result-stage'],
  frame: elements['result-comparison'], active: () => expanded});
const stageObserver = new ResizeObserver(entries => {
  const {width, height} = entries[0].contentRect;
  if (height) elements['result-comparison'].style.setProperty('--stage-ratio', width / height);
  panZoom.clamp();
});
stageObserver.observe(elements['result-stage']);
const resultOverlay = createOverlay({root: elements['result-viewer'],
  regions: '.nav, .skip-link, .tool-heading, .tool-steps, #photo-stage, .inline-cta, footer',
  onClose: () => expandResult(false)});
function expandResult(value) {
  expanded = value;
  elements['result-viewer'].classList.toggle('is-expanded', value);
  panZoom.reset();
  value ? resultOverlay.open() : resultOverlay.close();
  elements['expand-result'].hidden = value; elements['close-result'].hidden = !value;
  (value ? elements['close-result'] : elements['expand-result']).focus({preventScroll: true});
}
elements['expand-result'].addEventListener('click', () => expandResult(true));
elements['close-result'].addEventListener('click', () => expandResult(false));

// Full-screen picker over the original photo.
const faceOverlay = createOverlay({root: elements['face-editor'], regions: '#main-content, .nav, .skip-link, footer',
  onClose: () => closeFaces()});
// pan-zoom captures the pointer on the stage, so a mark never receives the
// pointer's click. Taps are read here instead, in the capture phase, which
// still runs when pan-zoom stops a pinch from propagating.
let tap;
elements['face-stage'].addEventListener('pointerdown', event => {
  if (!faceOpen) return;
  if (tap) { tap.multi = true; return; }
  tap = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, multi: false,
    mark: event.target.closest('.face-mark')};
}, true);
elements['face-stage'].addEventListener('pointermove', event => {
  if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6) tap.moved = true;
}, true);
for (const name of ['pointerup', 'pointercancel']) elements['face-stage'].addEventListener(name, event => {
  if (tap?.id !== event.pointerId) return;
  const {mark, moved, multi} = tap;
  tap = null;
  if (name !== 'pointerup' || !mark || moved || multi || (event.pointerType === 'mouse' && event.button !== 0)) return;
  toggleFace(Number(mark.dataset.index));
  mark.focus({preventScroll: true});
}, true);
const facePanZoom = createPanZoom({root: elements['face-editor'], stage: elements['face-stage'],
  frame: elements['face-frame'], active: () => faceOpen});
new ResizeObserver(entries => {
  const {width, height} = entries[0].contentRect;
  if (height) elements['face-frame'].style.setProperty('--stage-ratio', width / height);
  facePanZoom.clamp();
}).observe(elements['face-stage']);
// Keyboard path: Enter and Space give a click with detail 0; a pointer click
// never does, so the two paths cannot both toggle.
elements['face-marks'].addEventListener('click', event => {
  const mark = event.target.closest('.face-mark');
  if (mark && event.detail === 0) toggleFace(Number(mark.dataset.index));
});

function setFaceStatus(text, progress, error = false) {
  elements['face-status'].textContent = text;
  elements['face-status'].hidden = !text;
  elements['face-status'].classList.toggle('is-error', error);
  elements['face-progress'].hidden = progress === undefined;
  if (progress !== undefined) elements['face-progress'].value = progress;
}

function refreshFaceEditor() {
  if (!faceEdit || !faceChoice) return;
  const {faces} = faceEdit;
  for (const mark of elements['face-marks'].children) {
    mark.setAttribute('aria-pressed', String(Boolean(faceChoice[mark.dataset.index])));
    mark.disabled = applying;
  }
  elements['face-editor-title'].textContent = t('face_editor_title', {count: faceChoice.filter(Boolean).length, total: faces.length});
  elements['face-apply'].disabled = applying;
}

function toggleFace(index) {
  if (applying || !faceChoice || !(index in faceChoice)) return;
  faceChoice[index] = !faceChoice[index];
  refreshFaceEditor();
}

function openFaces() {
  if (!faceEdit || !originalUrl || applying || busy()) return;
  if (expanded) expandResult(false);
  const {plan, faces} = faceEdit;
  faceChoice = faceEdit.applied.slice();
  elements['face-photo'].src = originalUrl;
  elements['face-frame'].style.aspectRatio = `${plan.width} / ${plan.height}`;
  elements['face-frame'].style.setProperty('--photo-ratio', plan.width / plan.height);
  elements['face-marks'].replaceChildren(...faces.map((face, index) => {
    const rect = boxPercent(face.box, plan.width, plan.height);
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'face-mark';
    mark.dataset.index = index;
    Object.assign(mark.style, {left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%`});
    mark.setAttribute('aria-label', t('face_toggle', {index: index + 1}));
    const badge = document.createElement('span');
    badge.className = 'face-mark-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = index + 1;
    mark.append(badge);
    return mark;
  }));
  setFaceStatus('');
  refreshFaceEditor();
  elements['face-editor'].hidden = false;
  faceOpen = true;
  faceOverlay.open();
  facePanZoom.reset();
  elements['face-close'].focus({preventScroll: true});
}

function closeFaces(restoreFocus = true) {
  if (!faceOpen) return;
  if (applying) { stopApply(); refreshControls(); }
  faceOpen = false; tap = null;
  faceOverlay.close();
  elements['face-editor'].hidden = true;
  elements['face-marks'].replaceChildren();
  elements['face-photo'].removeAttribute('src');
  faceChoice = undefined;
  if (restoreFocus && !elements['choose-faces'].hidden) elements['choose-faces'].focus({preventScroll: true});
}

function stopApply() {
  applyToken++;
  applyWorker?.terminate(); applyWorker = null;
  clearTimeout(applyTimer);
  applying = false;
  if (!busy()) { wakeLock?.release().catch(() => {}); wakeLock = null; }
}

// Apply failures preserve the previous result and stay local to the picker.
function applyFailed(key, params) {
  stopApply();
  setFaceStatus(t(key, params), undefined, true);
  refreshFaceEditor();
  refreshControls();
}

function applyWatchdog() {
  clearTimeout(applyTimer);
  if (!applying || document.hidden) return;
  applyTimer = setTimeout(() => applyFailed('err_timeout'), 120_000);
}

function wireApplyWorker(active, token, onData) {
  applyWorker?.terminate();
  applyWorker = active;
  active.onmessage = event => { if (token === applyToken) { applyWatchdog(); onData(event.data); } };
  active.onerror = event => { event.preventDefault(); if (token === applyToken) applyFailed('err_face_apply'); };
  active.onmessageerror = () => { if (token === applyToken) applyFailed('err_face_apply'); };
  return active;
}

function applyFaces() {
  if (!faceEdit || !faceChoice || applying) return;
  if (sameSelection(faceChoice, faceEdit.applied)) { closeFaces(); return; }
  const token = ++applyToken;
  const choice = faceChoice.slice();
  applying = true; applyForceCpu = forceCpu;
  setFaceStatus(t('applying_faces'));
  refreshFaceEditor(); refreshControls(); applyWatchdog(); keepAwake();
  const missing = pendingEnhancements(faceEdit.faces, choice);
  missing.length ? enhanceMissing(token, choice, missing) : rebuildResult(token, choice);
}

function enhanceMissing(token, choice, missing) {
  try {
    const active = wireApplyWorker(new Worker(new URL('./face.worker.js', import.meta.url)), token, data => {
      if (data.type === 'status') setFaceStatus(t(data.title, data.params), data.progress);
      else if (data.type === 'error') {
        // Same GPU fallback as the first face pass, kept local so the upscaler
        // is not pinned to CPU for the next photo.
        if (data.code === 'gpu' && !applyForceCpu) { applyForceCpu = true; enhanceMissing(token, choice, missing); }
        else applyFailed(data.key === 'err_face' ? 'err_face_apply' : data.key, data.params);
      } else if (data.type === 'enhanced') {
        active.terminate(); applyWorker = null;
        for (const {index, patch} of data.faces) faceEdit.faces[index].patch = patch;
        rebuildResult(token, choice);
      }
    });
    active.postMessage({mode: 'enhance', file, environment, forceCpu: applyForceCpu,
      faces: missing.map(index => ({index, transform: faceEdit.faces[index].transform}))});
  } catch { applyFailed('err_face_apply'); }
}

function rebuildResult(token, choice) {
  try {
    const active = wireApplyWorker(new Worker(new URL('./face-edit.worker.js', import.meta.url), {type: 'module'}), token, data => {
      if (data.type === 'status') setFaceStatus(t(data.title, data.params));
      else if (data.type === 'error') applyFailed(data.key, data.params);
      else if (data.type === 'applied') {
        stopApply();
        faceEdit.applied = choice; faceEdit.changed = true;
        setResultBlob(data.blob);
        renderSummary();
        setStatus(t('done_title'), t('done_detail'));
        // Re-enable Choose faces first, so closing can hand focus back to it.
        refreshControls();
        closeFaces();
      }
    });
    active.postMessage({type: 'apply', base: faceEdit.baseBlob, plan: faceEdit.plan,
      faces: selectedPatches(faceEdit.faces, choice)});
  } catch { applyFailed('err_face_apply'); }
}

function setResultBlob(blob) {
  const previous = resultUrl;
  resultUrl = URL.createObjectURL(blob);
  elements['result-image'].src = resultUrl;
  elements['download-result'].href = resultUrl;
  if (previous) elements['result-image'].decode().catch(() => {}).finally(() => URL.revokeObjectURL(previous));
}

// With the picker available, its button owns the face count.
function renderSummary() {
  const {plan, modelKind: kind, faceEnabled, detectedCount, faceCount} = lastResult;
  const faces = faceEdit || kind === 'drawing' ? '' : !faceEnabled ? t('faces_off')
    : faceCount ? t('faces_enhanced', {count: faceCount}) : t(detectedCount ? 'faces_none_suitable' : 'faces_none');
  elements['result-summary'].textContent = `${dimensions(plan)} · JPEG${faces ? `; ${faces}` : ''}`;
  elements['face-summary'].textContent = !faceEdit && faceCount && detectedCount > faceCount ? t('faces_partial') : '';
  if (faceEdit) {
    elements['choose-faces'].textContent = t('choose_faces', {count: faceEdit.applied.filter(Boolean).length, total: faceEdit.faces.length});
  }
}

const busy = () => ['checking', 'processing'].includes(phase);
const locked = () => busy() || applying;
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
  const locked = busy() || applying || !supported;
  const failed = phase === 'error';
  elements['drop-empty'].hidden = hasFile;
  elements['selected-photo'].hidden = !hasFile;
  elements['stage-title'].textContent = t(hasFile ? 'your_photo' : 'choose_title');
  elements['drop-zone'].setAttribute('aria-disabled', String(locked));
  for (const id of ['photo-input', 'choose-photo', 'remove-photo', 'model-photo', 'model-drawing', 'scale-2x',
    'scale-4x', 'enhance-faces']) elements[id].disabled = locked;
  // Unavailable 4× stays tappable so it can explain why, instead of silently disabled.
  elements['scale-4x'].setAttribute('aria-disabled', String(Boolean(blocked4x())));
  // A photo already processing can't take new options or be removed; Cancel stays.
  elements['tool-options'].hidden = busy();
  elements['remove-photo'].hidden = busy();
  if (busy()) hideScalePopover();
  elements['face-option'].hidden = modelKind !== 'photo';
  elements['choose-faces'].hidden = !faceEdit || phase !== 'done';
  elements['choose-faces'].disabled = applying;
  const appOnly = ['browser', 'size', 'format'].includes(errorCode);
  const cpuRetry = failed && errorCode === 'gpu' && !forceCpu;
  const tryTwo = failed && scaleFallback;
  const retry = hasFile && failed && !appOnly && !cpuRetry && !tryTwo && supported;
  // A photo this device can't take is explained under the photo itself, where it
  // stays in view on a phone, and the main button offers a different photo.
  const photoError = hasFile && failed && ['size', 'format'].includes(errorCode);
  const chooseAnother = photoError && !tryTwo;
  elements['photo-error'].hidden = !photoError;
  elements.status.hidden = photoError;
  elements['choose-another'].hidden = !chooseAnother;
  elements['process-photo'].hidden = busy() || cpuRetry || tryTwo || retry || chooseAnother;
  elements['process-photo'].disabled = phase !== 'ready';
  elements.cancel.hidden = !busy();
  elements['cpu-retry'].hidden = !cpuRetry;
  elements.retry.hidden = !retry;
  elements['try-2x'].hidden = !tryTwo;
  elements['visibility-note'].hidden = !busy() || !document.hidden;
  // "Upscale" lights up when processing starts, not when a photo is chosen.
  const currentStep = phase === 'done' ? 2 : busy() ? 1 : 0;
  ['step-choose', 'step-upscale', 'step-compare'].forEach((id, index) => {
    index === currentStep ? elements[id].setAttribute('aria-current', 'step') : elements[id].removeAttribute('aria-current');
    elements[id].classList.toggle('complete', index < currentStep);
  });
}

async function keepAwake() {
  if (document.hidden || !navigator.wakeLock || wakeLock || !locked()) return;
  const current = generation;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (current !== generation || !locked() || wakeLock) { await lock.release(); return; }
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
  closeFaces(false); stopApply();
  faceEdit = undefined; lastResult = undefined;
  elements['choose-faces'].hidden = true;
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
  elements['photo-error'].textContent = t(key, params);
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
    if (data.plan?.tileCount >= 16 && data.tilesMs) {
      rememberTileMs(data.tilesMs / data.plan.tileCount, data.modelKind, data.plan.scale);
    }
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
    lastResult = {plan: data.plan, modelKind: data.modelKind, faceEnabled: data.faceEnabled,
      detectedCount: data.detectedCount, faceCount: data.faceCount};
    faceEdit = data.canEdit && data.faces?.length ? {baseBlob: data.baseBlob, plan: data.plan, faces: data.faces,
      applied: data.faces.map(face => Boolean(face.patch)), changed: false} : undefined;
    elements['result-title'].textContent = t('upscaled', {scale: resultScale});
    renderSummary();
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
    worker.postMessage({type: 'prepare', file, environment, forceCpu, autoStart, faceResults, scale, modelKind});
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
  if (!file || !supported || locked()) return;
  retriedGpu = false;
  if (shouldEnhanceFaces(modelKind, elements['enhance-faces'].checked)) startFaces(forceCpu);
  else prepare(forceCpu, true);
}

// Decide from the file header alone, before downloading an engine or model.
// A photo this device cannot take is refused straight away rather than after
// a download and a speed test. Runs for a new photo and again whenever the
// scale or face option changes for the photo already in the drop zone.
async function assessCurrentFile() {
  if (!file || locked()) return;
  const current = ++selection;
  clearOutput();
  phase = 'assessing'; errorCode = undefined; scaleFallback = false;
  elements['source-size'].textContent = t('checking_size');
  refreshControls();
  let plan, info;
  try {
    info = await inspectFile(file);
    if (current !== selection) return;
    tooLargeFor4x = supportsScale(policy, 4) && fits(info, 2) && !fits(info, 4);
    plan = assessPhoto(info, policy, scale);
  } catch (error) {
    if (current !== selection) return;
    elements['source-size'].textContent = info ? `${info.width} × ${info.height}` : t('not_processed');
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

const fits = (info, factor) => { try { assessPhoto(info, policy, factor); return true; } catch { return false; } };

// Why 4× can't run for this device or photo, or '' when it can.
function blocked4x() {
  if (!supportsScale(policy, 4)) return 'err_4x_device';
  return tooLargeFor4x ? 'err_4x_too_large' : '';
}
function hideScalePopover() {
  clearTimeout(popoverTimer);
  elements['scale-popover'].hidden = true;
}
function showScalePopover(text) {
  elements['scale-popover'].textContent = text;
  elements['scale-popover'].hidden = false;
  clearTimeout(popoverTimer);
  popoverTimer = setTimeout(hideScalePopover, 4000);
}

async function chooseFile(next) {
  if (!next || locked() || !supported) return;
  stopWorker();
  file = next; retriedGpu = false; forceCpu = false; tooLargeFor4x = false;
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
function setModelKind(value) {
  modelKind = value;
  elements['model-photo'].setAttribute('aria-pressed', String(value === 'photo'));
  elements['model-drawing'].setAttribute('aria-pressed', String(value === 'drawing'));
  refreshControls();
}
elements['model-photo'].addEventListener('click', () => {
  if (modelKind !== 'photo') { setModelKind('photo'); assessCurrentFile(); }
});
elements['model-drawing'].addEventListener('click', () => {
  if (modelKind !== 'drawing') { setModelKind('drawing'); assessCurrentFile(); }
});
elements['scale-2x'].addEventListener('click', () => { if (scale !== 2) { setScale(2); assessCurrentFile(); } });
// Wrapping depends on the width and on the locale's words, so it is measured
// rather than tied to a breakpoint.
new ResizeObserver(() => {
  const face = elements['face-option'];
  const firstRow = elements['tool-options'].firstElementChild.offsetTop;
  face.classList.toggle('is-wrapped', !face.hidden && face.offsetTop > firstRow + 4);
}).observe(elements['tool-options']);
elements['scale-4x'].addEventListener('click', () => {
  const reason = blocked4x();
  if (reason) { showScalePopover(t(reason)); return; }
  if (scale !== 4) { setScale(4); assessCurrentFile(); }
});
document.addEventListener('pointerdown', event => {
  if (!elements['scale-popover'].hidden && !event.target.closest('#scale-4x, #scale-popover')) hideScalePopover();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideScalePopover(); });
// A finished or failed photo gets a fresh check, so the other setting can run.
elements['enhance-faces'].addEventListener('change', () => { if (['done', 'error'].includes(phase)) assessCurrentFile(); });

const readFailure = () => fail('format', 'err_unreadable');
const openPicker = () => { if (!locked() && supported) elements['photo-input'].click(); };
elements['choose-photo'].addEventListener('click', openPicker);
elements['choose-another'].addEventListener('click', openPicker);
elements['remove-photo'].addEventListener('click', event => { event.stopPropagation(); if (!locked()) reset(); });
// The empty zone is a click target; its button stays the keyboard path. With a
// photo in place, removing it is explicit, so a stray tap doesn't open the picker.
elements['drop-zone'].addEventListener('click', event => { if (!file && !event.target.closest('button')) openPicker(); });
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
  errorCode = undefined; scaleFallback = false; forceCpu = false; tooLargeFor4x = false;
  hideScalePopover();
  clearOutput(); idleStatus();
  elements['photo-input'].value = '';
  if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  thumbnailUrl = undefined; elements['source-thumb'].removeAttribute('src');
  refreshControls(); elements['choose-photo'].focus({preventScroll: true});
  elements['photo-stage'].scrollIntoView({behavior: 'smooth', block: 'start'});
}
elements['another-photo'].addEventListener('click', reset);
elements['choose-faces'].addEventListener('click', openFaces);
elements['face-apply'].addEventListener('click', applyFaces);
elements['face-cancel'].addEventListener('click', () => closeFaces());
elements['face-close'].addEventListener('click', () => closeFaces());

const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
for (const eventName of ['dragenter', 'dragover']) elements['drop-zone'].addEventListener(eventName, event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (!locked() && supported) elements['drop-zone'].classList.add('dragging');
});
elements['drop-zone'].addEventListener('dragleave', event => {
  if (!elements['drop-zone'].contains(event.relatedTarget)) elements['drop-zone'].classList.remove('dragging');
});
elements['drop-zone'].addEventListener('drop', event => {
  event.preventDefault(); elements['drop-zone'].classList.remove('dragging');
  if (locked() || !supported) return;
  if (event.dataTransfer.files.length > 1) setStatus(t('one_at_a_time'), t('one_at_a_time_detail'));
  else chooseFile(event.dataTransfer.files[0]).catch(readFailure);
});
// A photo dropped beside the zone would otherwise open in the tab and end the session.
for (const eventName of ['dragover', 'drop']) window.addEventListener(eventName, event => { if (hasFiles(event)) event.preventDefault(); });

document.addEventListener('visibilitychange', () => { refreshControls(); watchdog(); applyWatchdog(); keepAwake(); });
window.addEventListener('pagehide', () => {
  const interrupted = busy();
  stopWorker(); if (interrupted) remember(true);
  // A result survives in the back/forward cache; an Apply in flight does not.
  if (applying) applyFailed('err_face_apply');
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
  localStorage.removeItem('uscale-tile-ms-v1');
} catch { /* Browser storage is optional. */ }
setScale(2);
setModelKind('photo');
idleStatus();
try {
  checkBrowser({secure: isSecureContext, worker: typeof Worker === 'function', wasm: typeof WebAssembly === 'object',
    bitmap: typeof createImageBitmap === 'function', offscreen: typeof OffscreenCanvas === 'function'});
} catch (error) { supported = false; fail(error.code, error.key); }
refreshControls();
