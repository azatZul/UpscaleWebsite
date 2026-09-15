import {assessPhoto, checkBrowser, DEFAULT_TILE_MS, devicePolicy, estimateDuration, maxInputPixelsForScale, supportsScale} from './capability.js';
import {inspectFile} from './image-info.js';
import {createComparison} from './comparison.js';
import {createPanZoom} from './pan-zoom.js';
import {pageTranslator} from './i18n.js';
import {boxPercent} from './face-detect.js';
import {pendingEnhancements, sameSelection, selectedPatches} from './face-selection.js';
import {createOverlay} from './overlay.js';
import {shouldEnhanceFaces, tileMetricKey} from './model-selection.js';
import {AnalyticsAction, AnalyticsEvent, SCREEN, initAnalytics, modeValue} from './analytics.js';
import {createCloud} from './cloud.js';
import {ApiError, createSession} from './account-link.js';
import {createTopUp} from './topup.js';

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
  'face-status', 'face-progress', 'photo-error', 'status', 'tool-options', 'choose-another', 'mode-device', 'mode-creative',
  'mode-restore', 'private-badge', 'cloud-badge', 'creative-options', 'creativity',
  'creativity-value', 'restore-options', 'negative', 'increase-resolution', 'hires-note', 'prompt-field', 'restore-prompt',
  'topup-panel', 'topup-title', 'topup-status', 'topup-amounts', 'topup-refresh', 'saved-note', 'tool-picker', 'tool-step',
  'tool-body', 'back-to-tools', 'signin-checking', 'device-quota'].map(id => [id, $(id)]));
const comparison = createComparison(elements['result-comparison'], elements['before-image'], elements['comparison-handle'],
  value => t('slider_value', {value}));
const environment = {userAgent: navigator.userAgent, platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints, deviceMemory: navigator.deviceMemory};
const marker = 'uscale-preview-active-v1';
const policy = devicePolicy(environment);
const analytics = initAnalytics();
const trackTap = (element, properties) => analytics.trackAction(AnalyticsAction.tap, element, SCREEN, properties);

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
// 'device' runs the upscaler here; 'creative' and 'restore' send the photo to the
// cloud for credits (cloud.js). The photo, status and result viewer are shared.
let mode = 'device';
let cloud;
// 'pick' shows the tool picker; 'tool' shows one tool. Both live on this page,
// switched with ?mode= so the back button returns to the picker.
let step = 'pick';
const session = createSession();
const topUp = createTopUp({elements, t, session, trackTap: (...args) => trackTap(...args)});
const number = value => new Intl.NumberFormat(document.documentElement.lang || 'en').format(value);
// On-device results are confirmed with the worker before they are shown: the
// first ten are free, then each costs a credit. A result waiting on that sits here.
let heldResult;
let deviceRequestId;
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
// Analytics for one processing run and one imported photo; nothing about the image itself.
let importSource;
let lastInfo;
let processingStartedAt;
let outcomeTracked = true;
let runProgress = 0;
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
elements['expand-result'].addEventListener('click', () => { trackTap('expand_result'); expandResult(true); });
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

const busy = () => ['checking', 'processing', 'confirming'].includes(phase);
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
  if (progress !== undefined) runProgress = Math.round((elements.progress.value = progress) * 100) / 100;
  elements['status-value'].textContent = progress === undefined ? '' : `${Math.round(progress * 100)}%`;
}
const idleStatus = () => setStatus('', t(mode === 'device' ? 'idle_detail' : 'cloud_ready_detail'));

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
  // Cloud modes share the photo, status, buttons and result viewer; only the
  // on-device options and recovery paths stand down. A cloud job cannot be
  // cancelled from here once uploaded, so Cancel is not offered.
  if (mode !== 'device') {
    elements['tool-options'].hidden = true;
    elements['face-option'].hidden = true;
    elements['choose-faces'].hidden = true;
    elements['cpu-retry'].hidden = true;
    elements['try-2x'].hidden = true;
    elements.cancel.hidden = true;
  }
  if (mode === 'device') {
    if (!busy()) elements['process-photo'].textContent = deviceButtonLabel();
    if (topUp.isOpen()) elements['process-photo'].hidden = true;
  }
  // A finished on-device result waiting on confirmation or credits: Retry
  // re-confirms it, unless the top-up panel already stands in for the button.
  if (phase === 'held') {
    elements['process-photo'].hidden = true;
    elements.retry.hidden = topUp.isOpen();
    elements.cancel.hidden = true;
  }
  renderAccount();
  cloud?.refresh({busy: busy(), locked});
}

function deviceButtonLabel() {
  const device = session.state.device;
  if (!device) return t('upscale_button', {scale});
  return device.freeRemaining > 0 ? t('device_button_free', {scale}) : t('device_button_paid', {scale, credits: device.credits});
}

function rememberBalance(balance) {
  try {
    const hint = JSON.parse(localStorage.getItem('uscale-account') || 'null');
    if (!hint?.signedIn || hint.credits === balance) return;
    localStorage.setItem('uscale-account', JSON.stringify({...hint, credits: balance}));
    window.dispatchEvent(new Event('uscale:account-hint'));
  } catch { /* Storage is optional; the header just shows no balance. */ }
}

function renderAccount() {
  const {identity, balance, device} = session.state;
  // The balance lives in the header, under Account, not beside a price.
  if (identity && balance !== null) rememberBalance(balance);
  const quota = mode === 'device' && identity && device;
  elements['device-quota'].hidden = !quota;
  if (quota) elements['device-quota'].textContent = t('device_free_left', {count: device.freeRemaining, limit: device.freeLimit});
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
  // Cloud jobs report no progress to reset this, and may legitimately run longer.
  if (document.hidden || !busy() || mode !== 'device') return;
  timer = setTimeout(() => fail('timeout', 'err_timeout'), 120_000);
}

function clearOutput() {
  if (expanded) expandResult(false);
  closeFaces(false); stopApply();
  faceEdit = undefined; lastResult = undefined;
  elements['choose-faces'].hidden = true;
  elements.results.hidden = true;
  elements['saved-note'].hidden = true;
  elements['result-image'].removeAttribute('src');
  elements['result-image'].removeAttribute('crossorigin');
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
  if (importSource) {
    analytics.trackEvent(AnalyticsEvent.mediaImportFailed, {source: importSource, count: 1, error_type: code, message: key});
    importSource = undefined;
  }
  if (busy()) trackOutcome('failed', {error_type: code, message: key});
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
    trackOutcome('success', {progress: 1, face_count: data.faceCount || 0, detected_faces: data.detectedCount || 0,
      tile_count: data.plan.tileCount, output_size: `${data.plan.outputWidth}x${data.plan.outputHeight}`});
    stopWorker();
    // Only learn from a run long enough to amortise first-inference shader
    // setup. A four-tile photo would otherwise teach a badly pessimistic rate.
    if (data.plan?.tileCount >= 16 && data.tilesMs) {
      rememberTileMs(data.tilesMs / data.plan.tileCount, data.modelKind, data.plan.scale);
    }
    heldResult = data;
    confirmDevice();
  }
}

function showDeviceTopUp() {
  const {device, balance} = session.state;
  topUp.show({reason: 'device', title: t('device_topup_title',
    {limit: device?.freeLimit ?? 10, credits: device?.credits ?? 1, balance: number(balance ?? 0)})});
}

/** Record the finished upscale with the worker -- free or one credit -- and only
 *  then show it. Nothing is counted for a run that failed or was cancelled. */
async function confirmDevice() {
  if (!heldResult) return;
  const data = heldResult;
  phase = 'confirming';
  setStatus(t('device_confirming'), '');
  refreshControls();
  try {
    session.apply(await session.claimDevice(deviceRequestId));
    if (heldResult !== data) return;
    heldResult = undefined;
    showDeviceResult(data);
  } catch (error) {
    if (heldResult !== data) return;
    phase = 'held';
    if (error instanceof ApiError && error.status === 401) { requireSignIn(); return; }
    if (error instanceof ApiError && error.status === 402) {
      session.apply(error.body);
      showDeviceTopUp();
      setStatus(t('device_result_held'), '');
    } else {
      setStatus(t('failed_title'), t('device_confirm_failed'));
    }
    refreshControls();
  }
}

function showDeviceResult(data) {
  phase = 'done';
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

// Same keys as the apps' processingOutcomeProperties, for the web's single photo.
function runProperties() {
  return {screen: SCREEN, mode: mode === 'device' ? modeValue(modelKind, scale) : mode, scale, model: modelKind,
    face: shouldEnhanceFaces(modelKind, elements['enhance-faces'].checked), custom_model: false, media: 'images',
    batch_count: 1, size: lastInfo ? `${lastInfo.width}x${lastInfo.height}` : '-', cpu_fallback: forceCpu,
    device_class: policy.mobile ? (policy.iPad ? 'ipad' : 'mobile') : 'desktop'};
}
function trackOutcome(result, extra) {
  if (outcomeTracked) return;
  outcomeTracked = true;
  analytics.trackEvent(AnalyticsEvent.processingCompleted, {...runProperties(), result, progress: runProgress,
    duration_sec: Math.round((performance.now() - processingStartedAt) / 100) / 10, ...extra});
}

function requireSignIn(targetMode = mode) {
  const url = new URL(location.href);
  url.searchParams.set('mode', targetMode);
  location.assign(session.signInUrl(url.pathname + url.search));
}

function start() {
  if (!file || !supported || locked()) return;
  if (!session.state.identity) { requireSignIn(); return; }
  trackTap('start_processing', runProperties());
  if (mode !== 'device') { cloud.start(); return; }
  const device = session.state.device;
  if (device && device.freeRemaining === 0 && (session.state.balance ?? 0) < device.credits) {
    showDeviceTopUp();
    refreshControls();
    return;
  }
  if (topUp.reason() === 'device') topUp.hide();
  heldResult = undefined;
  deviceRequestId = crypto.randomUUID().replaceAll('-', '');
  processingStartedAt = performance.now(); outcomeTracked = false; runProgress = 0;
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
  heldResult = undefined;
  if (topUp.reason() === 'device') topUp.hide();
  clearOutput();
  phase = 'assessing'; errorCode = undefined; scaleFallback = false;
  elements['source-size'].textContent = t('checking_size');
  refreshControls();
  if (mode !== 'device') { await assessForCloud(current); return; }
  let plan, info;
  try {
    info = await inspectFile(file);
    if (current !== selection) return;
    lastInfo = info;
    if (importSource) {
      analytics.trackEvent(AnalyticsEvent.mediaImportSuccess, {source: importSource, media: 'images', count: 1,
        size: `${info.width}x${info.height}`, megapixels: Math.round(info.width * info.height / 100_000) / 10});
      importSource = undefined;
    }
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
    if (info) {
      analytics.trackEvent(AnalyticsEvent.photoRejected, {reason: error.code || 'format', message: error.key, scale,
        mode: modeValue(modelKind, scale), size: `${info.width}x${info.height}`, offered_2x: offerScaleFallback,
        device_class: policy.mobile ? (policy.iPad ? 'ipad' : 'mobile') : 'desktop'});
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

// Cloud modes only need a readable photo within the upload limits: the device
// policy and the speed estimate are about processing here, which they do not do.
async function assessForCloud(current) {
  let info;
  try {
    info = await inspectFile(file);
    if (current !== selection) return;
    lastInfo = info;
    if (importSource) {
      analytics.trackEvent(AnalyticsEvent.mediaImportSuccess, {source: importSource, media: 'images', count: 1,
        size: `${info.width}x${info.height}`, megapixels: Math.round(info.width * info.height / 100_000) / 10});
      importSource = undefined;
    }
  } catch (error) {
    if (current !== selection) return;
    elements['source-size'].textContent = t('not_processed');
    fail(error.code || 'format', error.key || 'err_unreadable', error.params);
    return;
  }
  phase = 'ready';
  elements['source-size'].textContent = `${info.width} × ${info.height}`;
  setStatus(t('cloud_ready'), t('cloud_ready_detail'));
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

async function chooseFile(next, source = 'picker') {
  if (!next || locked() || !supported) return;
  stopWorker();
  file = next; retriedGpu = false; forceCpu = false; tooLargeFor4x = false;
  importSource = source; lastInfo = undefined;
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
  if (mode !== 'device') return;
  elements['limit-note'].textContent = t('limit_note', {mp: maxInputPixelsForScale(policy, scale) / 1_000_000, scale});
  elements['process-photo'].textContent = deviceButtonLabel();
}
function setModelKind(value) {
  modelKind = value;
  elements['model-photo'].setAttribute('aria-pressed', String(value === 'photo'));
  elements['model-drawing'].setAttribute('aria-pressed', String(value === 'drawing'));
  refreshControls();
}
elements['model-photo'].addEventListener('click', () => {
  trackTap('model', {value: 'photo'});
  if (modelKind !== 'photo') { setModelKind('photo'); assessCurrentFile(); }
});
elements['model-drawing'].addEventListener('click', () => {
  trackTap('model', {value: 'drawing'});
  if (modelKind !== 'drawing') { setModelKind('drawing'); assessCurrentFile(); }
});
elements['scale-2x'].addEventListener('click', () => {
  trackTap('scale', {value: 2, available: true});
  if (scale !== 2) { setScale(2); assessCurrentFile(); }
});
// Wrapping depends on the width and on the locale's words, so it is measured
// rather than tied to a breakpoint.
new ResizeObserver(() => {
  const face = elements['face-option'];
  const firstRow = elements['tool-options'].firstElementChild.offsetTop;
  face.classList.toggle('is-wrapped', !face.hidden && face.offsetTop > firstRow + 4);
}).observe(elements['tool-options']);
elements['scale-4x'].addEventListener('click', () => {
  const reason = blocked4x();
  trackTap('scale', {value: 4, available: !reason, reason: reason === 'err_4x_device' ? 'device' : reason ? 'too_large' : 'none'});
  if (reason) { showScalePopover(t(reason)); return; }
  if (scale !== 4) { setScale(4); assessCurrentFile(); }
});
document.addEventListener('pointerdown', event => {
  if (!elements['scale-popover'].hidden && !event.target.closest('#scale-4x, #scale-popover')) hideScalePopover();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideScalePopover(); });
// A finished or failed photo gets a fresh check, so the other setting can run.
elements['enhance-faces'].addEventListener('change', () => {
  trackTap('enhance_faces', {value: elements['enhance-faces'].checked});
  if (['done', 'error'].includes(phase)) assessCurrentFile();
});

/** Show a finished cloud result in the shared viewer. `before` is the exact
 *  image that was uploaded, so the comparison lines up with what was processed
 *  (restore modes crop to the model's shape). */
function presentCloudResult({mode: kind, options, result, before, plan}) {
  stopWorker();
  phase = 'done';
  clearOutput();
  originalUrl = URL.createObjectURL(before);
  elements['before-image'].src = originalUrl;
  // Saved results come from this origin. An unsaved one is the provider's own
  // link, which this cross-origin-isolated page can only show through CORS.
  if (new URL(result.outputUrl, location.href).origin !== location.origin) elements['result-image'].crossOrigin = 'anonymous';
  elements['result-image'].src = result.outputUrl;
  elements['result-comparison'].style.aspectRatio = `${plan.width} / ${plan.height}`;
  elements['result-comparison'].style.setProperty('--photo-ratio', plan.width / plan.height);
  elements['result-image'].alt = t('result_alt_cloud');
  elements['result-tag'].textContent = t('result_tag_cloud');
  elements['download-result'].href = result.downloadUrl;
  elements['download-result'].download = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}-uscale.jpg`;
  elements['result-title'].textContent = kind === 'restore'
    ? t('restored_title') : t('creative_title', {resolution: options.resolution.toUpperCase()});
  elements['result-summary'].textContent = '';
  elements['face-summary'].textContent = result.saved ? '' : t('cloud_not_saved');
  elements['saved-note'].hidden = !result.saved;
  setStatus(t('done_title'), t(result.saved ? 'cloud_done_detail' : 'cloud_not_saved'));
  elements.results.hidden = false;
  refreshControls();
  elements.results.focus({preventScroll: true});
  elements.results.scrollIntoView({behavior: 'smooth', block: 'start'});
}

const MODES = ['device', 'creative', 'restore'];
// The heading describes the free on-device tool; cloud modes say what they are
// instead, since "never leaves your device" is no longer true for them. The
// on-device copy is read from the page, so it stays the locale's own.
const heading = {
  eyebrow: document.querySelector('.tool-heading .eyebrow'),
  title: document.querySelector('.tool-heading h1'),
  lead: document.querySelector('.tool-heading .lead'),
};
const deviceHeading = Object.fromEntries(Object.entries(heading).map(([key, node]) => [key, node?.textContent ?? '']));
function renderHeading() {
  const copy = mode === 'device' ? deviceHeading
    : {eyebrow: t('eyebrow_cloud'), title: t(`h1_${mode}`), lead: t(`lead_${mode}`)};
  for (const [key, node] of Object.entries(heading)) if (node) node.textContent = copy[key];
}
function setMode(value, {initial = false} = {}) {
  if (!MODES.includes(value) || (value === mode && !initial) || locked()) return;
  mode = value;
  if (value === 'device') setScale(scale); else elements['limit-note'].textContent = formatsNote;
  renderHeading();
  cloud.onMode(value);
  if (file) assessCurrentFile(); else idleStatus();
  refreshControls();
}
const modeFromUrl = () => {
  const requested = new URLSearchParams(location.search).get('mode');
  return MODES.includes(requested) ? requested : null;
};

/** Which step shows, and whether the tool may show yet: every tool needs a
 *  signed-in account, so a tool step waits for sign-in to resolve and sends a
 *  signed-out visitor to the sign-in page. */
function renderStep() {
  $('main-content').dataset.step = step;
  const {known, identity} = session.state;
  const checking = step === 'tool' && !known;
  elements['signin-checking'].hidden = !checking;
  elements['tool-body'].hidden = step === 'tool' && !identity;
  if (step === 'tool' && known && !identity) requireSignIn();
}

function openTool(value, {push = true} = {}) {
  if (session.state.known && !session.state.identity) { requireSignIn(value); return; }
  step = 'tool';
  if (push) {
    const url = new URL(location.href);
    url.searchParams.set('mode', value);
    history.pushState({mode: value}, '', url);
  }
  setMode(value, {initial: true});
  renderStep();
  window.scrollTo({top: 0});
}

function showPicker({push = true} = {}) {
  if (locked()) return;
  step = 'pick';
  if (push) {
    const url = new URL(location.href);
    url.searchParams.delete('mode');
    history.pushState({}, '', url);
  }
  if (topUp.isOpen()) topUp.hide();
  renderStep();
  window.scrollTo({top: 0});
}

for (const id of MODES) {
  elements[`mode-${id}`].addEventListener('click', () => { trackTap('tool', {value: id}); openTool(id); });
}
elements['back-to-tools'].addEventListener('click', () => { trackTap('back_to_tools', {mode}); showPicker(); });
window.addEventListener('popstate', () => {
  const requested = modeFromUrl();
  if (requested) openTool(requested, {push: false}); else showPicker({push: false});
});
session.subscribe(state => {
  if (topUp.reason() === 'device') {
    const device = state.device;
    if (device && (device.freeRemaining > 0 || (state.balance ?? 0) >= device.credits)) {
      topUp.hide();
      if (phase === 'held') confirmDevice();
    } else {
      showDeviceTopUp();
    }
  }
  renderStep();
  refreshControls();
});

const readFailure = () => fail('format', 'err_unreadable');
const openPicker = () => { if (!locked() && supported) elements['photo-input'].click(); };
elements['choose-photo'].addEventListener('click', () => { trackTap('choose_photo'); openPicker(); });
elements['choose-another'].addEventListener('click', () => { trackTap('choose_another', {reason: errorCode}); openPicker(); });
elements['remove-photo'].addEventListener('click', event => {
  event.stopPropagation();
  if (locked()) return;
  trackTap('remove_photo', {phase});
  reset();
});
// The empty zone is a click target; its button stays the keyboard path. With a
// photo in place, removing it is explicit, so a stray tap doesn't open the picker.
elements['drop-zone'].addEventListener('click', event => {
  if (file || event.target.closest('button')) return;
  trackTap('drop_zone');
  openPicker();
});
elements['photo-input'].addEventListener('change', () => {
  const next = elements['photo-input'].files[0];
  elements['photo-input'].value = '';
  chooseFile(next, 'picker').catch(readFailure);
});
elements['process-photo'].addEventListener('click', () => { if (phase === 'ready') start(); });
elements.retry.addEventListener('click', () => {
  trackTap('retry', {reason: phase === 'held' ? 'confirm' : errorCode});
  if (phase === 'held') confirmDevice(); else start();
});
elements['cpu-retry'].addEventListener('click', () => {
  trackTap('cpu_retry');
  processingStartedAt = performance.now(); outcomeTracked = false;
  prepare(true, true);
});
elements['try-2x'].addEventListener('click', () => { trackTap('try_2x'); setScale(2); assessCurrentFile(); });
elements.cancel.addEventListener('click', () => {
  trackTap('cancel', {progress: runProgress});
  trackOutcome('cancelled');
  stopWorker(); clearOutput();
  phase = 'ready';
  setStatus(t('cancelled'), t('cancelled_detail'));
  refreshControls();
});
function reset() {
  stopWorker(); selection++; phase = 'idle'; file = null; heldResult = undefined;
  if (topUp.isOpen()) topUp.hide();
  errorCode = undefined; scaleFallback = false; forceCpu = false; tooLargeFor4x = false;
  hideScalePopover();
  clearOutput(); idleStatus();
  elements['photo-input'].value = '';
  if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  thumbnailUrl = undefined; elements['source-thumb'].removeAttribute('src');
  refreshControls(); elements['choose-photo'].focus({preventScroll: true});
  elements['photo-stage'].scrollIntoView({behavior: 'smooth', block: 'start'});
}
elements['another-photo'].addEventListener('click', () => { trackTap('another_photo'); reset(); });
elements['choose-faces'].addEventListener('click', () => {
  trackTap('choose_faces', {faces: faceEdit?.faces.length || 0});
  openFaces();
});
elements['face-apply'].addEventListener('click', () => {
  trackTap('face_apply', {selected: faceChoice?.filter(Boolean).length || 0, total: faceEdit?.faces.length || 0});
  applyFaces();
});
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
  else chooseFile(event.dataTransfer.files[0], 'drop').catch(readFailure);
});
// A photo dropped beside the zone would otherwise open in the tab and end the session.
for (const eventName of ['dragover', 'drop']) window.addEventListener(eventName, event => { if (hasFiles(event)) event.preventDefault(); });

document.addEventListener('visibilitychange', () => {
  refreshControls(); watchdog(); applyWatchdog(); keepAwake();
  // Back from the checkout tab: pick up the new balance.
  if (!document.hidden && session.state.identity) session.refresh();
});
window.addEventListener('pagehide', () => {
  const interrupted = busy();
  if (interrupted) trackOutcome('interrupted');
  analytics.flush();
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
// Captured before setScale replaces it with the on-device size limit.
const formatsNote = elements['limit-note'].textContent;
cloud = createCloud({elements, t, session, topUp, requireSignIn, getMode: () => mode, getFile: () => file, getInfo: () => lastInfo, setStatus,
  setPhase: value => { phase = value; }, refreshControls, fail, presentResult: presentCloudResult,
  optionsChanged: () => { if (['done', 'error'].includes(phase)) assessCurrentFile(); },
  analytics, trackTap, isLocked: () => busy() || applying || !supported});
setScale(2);
setModelKind('photo');
const startMode = modeFromUrl();
step = startMode ? 'tool' : 'pick';
setMode(startMode || 'device', {initial: true});
session.start();
renderStep();
idleStatus();
try {
  checkBrowser({secure: isSecureContext, worker: typeof Worker === 'function', wasm: typeof WebAssembly === 'object',
    bitmap: typeof createImageBitmap === 'function', offscreen: typeof OffscreenCanvas === 'function'});
} catch (error) { supported = false; fail(error.code, error.key); }
refreshControls();

analytics.trackScreen(SCREEN);
if (!supported) analytics.trackEvent('browser_unsupported', {screen: SCREEN, error_type: errorCode});
// Saving on the web is a download link, so a click is the closest to the apps' save success.
elements['download-result'].addEventListener('click', () => {
  analytics.trackEvent(AnalyticsEvent.resultSaveSuccess, {screen: SCREEN, save_to_gallery: false, is_video: false,
    batch_count: 1, method: 'download', scale: lastResult?.plan.scale, mode: lastResult ? modeValue(lastResult.modelKind, lastResult.plan.scale) : undefined,
    faces_edited: Boolean(faceEdit?.changed)});
});
// App Store badges carry data-cta; one listener covers every placement on the page.
document.addEventListener('click', event => {
  const cta = event.target.closest('a[data-cta]');
  if (cta) trackTap(cta.dataset.cta, {placement: cta.closest('.inline-cta') ? 'inline_banner' : 'page', phase});
});
