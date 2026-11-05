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
import {createSession} from './account-link.js';
import {createTopUp} from './topup.js';
import {createAttemptController} from './attempt-controller.js';
import {executionChoices, rememberThreadFailure} from './cpu-policy.js';
import {exportExtension, PNG} from './transparency.js';
import {ASSETS} from './assets.generated.js';
import {learnedTileMs, processingFailureProperties} from './processing-policy.js';
import {attemptErrorProperties, installErrorDiagnostics} from './diagnostics.js';
import {approvedPhoto4xCandidate, photo4xGpuVendor, photoExecutionChoices, savePhoto4xProfile, rememberPhoto4xFailure, PHOTO4X_RELEASE} from './photo4x-policy.js';

const analytics = initAnalytics();
installErrorDiagnostics({analytics, state: () => {
  try { return {...runProperties(), phase, progress: runProgress}; }
  catch { return {screen: SCREEN, phase: 'startup'}; }
}});

const {t, duration} = pageTranslator(document);
const $ = id => document.getElementById(id);
const elements = Object.fromEntries(['photo-input', 'choose-photo', 'remove-photo', 'drop-zone', 'drop-empty',
  'selected-photo', 'source-thumb', 'source-name', 'source-size', 'status-title', 'status-detail', 'progress',
  'status-value', 'process-photo', 'cancel', 'retry', 'cpu-retry', 'try-2x', 'results', 'result-image', 'result-summary',
  'download-result', 'another-photo', 'limit-note', 'interrupted', 'visibility-note', 'photo-stage', 'stage-title',
  'before-image', 'result-comparison', 'comparison-handle', 'enhance-faces',
  'face-summary', 'result-viewer', 'result-stage', 'expand-result', 'close-result', 'scale-2x', 'scale-4x', 'scale-popover',
  'result-tag', 'result-title', 'quality-chip', 'quality-note', 'model-photo', 'model-drawing', 'face-option', 'choose-faces', 'face-editor', 'face-stage',
  'face-frame', 'face-photo', 'face-marks', 'face-apply', 'face-cancel', 'face-close', 'face-editor-title',
  'face-status', 'face-progress', 'photo-error', 'status', 'tool-options', 'choose-another', 'mode-device', 'mode-creative',
  'mode-restore', 'private-note', 'cloud-note', 'creative-options', 'creativity',
  'creativity-value', 'restore-options', 'negative', 'increase-resolution', 'hires-note', 'prompt-field', 'restore-prompt',
  'topup-panel', 'topup-title', 'topup-status', 'topup-amounts', 'topup-refresh', 'saved-note', 'tool-picker', 'tool-step',
  'tool-body', 'back-to-tools', 'signin-checking'].map(id => [id, $(id)]));
const comparison = createComparison(elements['result-comparison'], elements['before-image'], elements['comparison-handle'],
  value => t('slider_value', {value}));
const environment = {userAgent: navigator.userAgent, platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints, deviceMemory: navigator.deviceMemory,
  hardwareConcurrency: navigator.hardwareConcurrency, crossOriginIsolated: globalThis.crossOriginIsolated,
  sharedMemory: typeof SharedArrayBuffer === 'function', webgpu: Boolean(navigator.gpu)};
let storage;
try { storage = localStorage; } catch { /* Storage is optional. */ }
const marker = 'uscale-preview-active-v1';
const policy = devicePolicy(environment);
const trackTap = (element, properties) => analytics.trackAction(AnalyticsAction.tap, element, SCREEN, properties);

// Estimating before any download needs a per-tile figure. Use the measured one
// from this device's last run, otherwise a conservative default.
function knownTileMs() {
  try { const stored = Number(localStorage.getItem(tileMetricKey(modelKind, scale))); if (stored > 0) return stored; }
  catch { /* Storage is optional. */ }
  return policy.mobile ? DEFAULT_TILE_MS.mobile : DEFAULT_TILE_MS.desktop;
}
function rememberTileMs(ms, kind, factor, variant, backend) {
  try {
    if (ms > 0 && Number.isFinite(ms)) localStorage.setItem(tileMetricKey(kind, factor, variant, backend), String(Math.round(ms)));
  } catch { /* Storage is optional. */ }
}
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
// idle (no photo) → assessing → ready → processing → done, or error.
let phase = 'idle';
let cpuRequested = false;
let cpuFallback = false;
let generation = 0;
// Bumped per header check, so a slow check can't overwrite a newer photo.
let selection = 0;
let thumbnailUrl;
let resultUrl;
let originalUrl;
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
// Set only once a Photo 4× preflight requested an adapter; started when its attempt begins.
let photo4xAnalytics = {}, photo4xStartedAt;
let outcomeTracked = true;
let runProgress = 0;
// The heavier model passed its forecast and is upscaling this photo now.
let maxQuality = false;
let popoverTimer;
let expanded = false;
let lastResult;
let completedFaces;
let processingController;
let applyController;
// Picker state stays transferable: a faceless base plus cached face patches.
let faceEdit;
let faceChoice;
let faceOpen = false;
let applying = false;
let applyToken = 0;
const panZoom = createPanZoom({root: elements['result-viewer'], stage: elements['result-stage'],
  frame: elements['result-comparison'], active: () => expanded});
const stageObserver = new ResizeObserver(entries => {
  const {width, height} = entries[0].contentRect;
  if (height) elements['result-comparison'].style.setProperty('--stage-ratio', width / height);
  panZoom.clamp();
});
stageObserver.observe(elements['result-stage']);
const resultOverlay = createOverlay({root: elements['result-viewer'],
  regions: '.nav, .skip-link, .tool-heading, #photo-stage, .inline-cta, footer',
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
  elements['face-frame'].classList.toggle('has-transparency', lastResult?.mime === PNG);
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
  applyController?.cancel(); applyController = null;
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

function controllerFor(makeWorker, onData, onFailure, onRetry) {
  const controller = createAttemptController({makeWorker, onMessage: onData,
    onFailure: (error, config) => {
      analytics.trackEvent('device_processing_error', {...runProperties(), phase, progress: runProgress,
        error_type: error.code, message: error.key, ...attemptErrorProperties(error), ...photo4xAnalytics});
      onFailure(error, config);
    },
    onRetry: transition => {
      analytics.trackEvent('processing_retry', {...runProperties(), phase, ...attemptErrorProperties(transition.error),
        error_type: transition.error.code, message: transition.error.key,
        next_backend: transition.to.backend, next_threads: transition.to.threads, ...photo4xAnalytics,
        // Wall time the heavy model cost this photo before the regular model restarts it.
        ...(transition.from.variant && photo4xStartedAt !== undefined
          ? {photo4x_elapsed_ms: Math.round(performance.now() - photo4xStartedAt)} : {})});
      onRetry?.(transition);
    },
    onRuntimeFailure: (attempt, error) => attempt.variant
      ? rememberPhoto4xFailure(storage, attempt.variant, error)
      : rememberThreadFailure(storage, attempt.failureKey)});
  controller.setHidden(document.hidden);
  return controller;
}

function applyFaces() {
  if (!faceEdit || !faceChoice || applying) return;
  if (sameSelection(faceChoice, faceEdit.applied)) { closeFaces(); return; }
  const token = ++applyToken;
  const choice = faceChoice.slice();
  applying = true;
  setFaceStatus(t('applying_faces'));
  refreshFaceEditor(); refreshControls(); keepAwake();
  const missing = pendingEnhancements(faceEdit.faces, choice);
  missing.length ? enhanceMissing(token, choice, missing) : rebuildResult(token, choice);
}

function enhanceMissing(token, choice, missing) {
  applyController?.cancel();
  applyController = controllerFor(() => new Worker(new URL('./face.worker.js', import.meta.url)), data => {
    if (token !== applyToken) return;
    if (data.type === 'status' && data.title) setFaceStatus(t(data.title, data.params), data.progress);
    else if (data.type === 'enhanced') {
      for (const {index, patch} of data.faces) faceEdit.faces[index].patch = patch;
      rebuildResult(token, choice);
    }
  }, error => { if (token === applyToken) applyFailed(error.key === 'err_face' ? 'err_face_apply' : error.key, error.params); });
  applyController.start({mode: 'enhance', file, environment,
    faces: missing.map(index => ({index, transform: faceEdit.faces[index].transform}))},
  executionChoices(environment, 'faces', {forceCpu: cpuRequested, storage, assets: ASSETS}));
}

function rebuildResult(token, choice) {
  applyController?.cancel();
  applyController = controllerFor(() => new Worker(new URL('./face-edit.worker.js', import.meta.url), {type: 'module'}), data => {
    if (token !== applyToken) return;
    if (data.type === 'status' && data.title) setFaceStatus(t(data.title, data.params));
    else if (data.type === 'applied') {
      stopApply();
      faceEdit.applied = choice; faceEdit.changed = true;
      setResultBlob(data.blob); renderSummary();
      setStatus(t('done_title'), t('done_detail'));
      refreshControls(); closeFaces();
    }
  }, error => { if (token === applyToken) applyFailed(error.key, error.params); });
  applyController.start({type: 'apply', base: faceEdit.baseBlob, plan: faceEdit.plan,
    faces: selectedPatches(faceEdit.faces, choice)}, [{backend: 'canvas', threads: 1}]);
}

function setResultBlob(blob) {
  const previous = resultUrl;
  resultUrl = URL.createObjectURL(blob);
  elements['result-image'].src = resultUrl;
  elements['download-result'].href = resultUrl;
  elements['download-result'].download = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}-uscale-${lastResult.plan.scale}x.${exportExtension(blob.type)}`;
  lastResult.mime = blob.type;
  if (previous) elements['result-image'].decode().catch(() => {}).finally(() => URL.revokeObjectURL(previous));
}

// With the picker available, its button owns the face count.
function renderSummary() {
  const {plan, modelKind: kind, faceEnabled, detectedCount, faceCount} = lastResult;
  const faces = faceEdit || kind === 'drawing' ? '' : !faceEnabled ? t('faces_off')
    : faceCount ? t('faces_enhanced', {count: faceCount}) : t(detectedCount ? 'faces_none_suitable' : 'faces_none');
  elements['result-summary'].textContent = `${dimensions(plan)} · ${lastResult.mime === PNG ? 'PNG' : 'JPEG'}${faces ? `; ${faces}` : ''}`;
  elements['face-summary'].textContent = !faceEdit && faceCount && detectedCount > faceCount ? t('faces_partial') : '';
  if (faceEdit) {
    elements['choose-faces'].textContent = t('choose_faces', {count: faceEdit.applied.filter(Boolean).length, total: faceEdit.faces.length});
  }
}

const busy = () => phase === 'processing';
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
  // Only the idle note has neither a title nor progress: it reads as a caption,
  // while every real status keeps its box.
  elements.status.classList.toggle('is-quiet', !title && progress === undefined);
}
const idleStatus = () => setStatus('', t(mode === 'device' ? 'idle_detail' : 'cloud_ready_detail'));

// The drop zone swaps its contents and the options stay put; the main button
// shows only while a chosen photo waits to be upscaled. The build renders the
// no-photo state (quiet status, no main button), so this first call moves nothing.
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
  // Motion on the photo and the status box shows the work is running, even
  // during stages that report no percentage.
  elements['drop-zone'].classList.toggle('is-busy', busy());
  elements.status.classList.toggle('is-busy', busy());
  if (busy()) hideScalePopover();
  elements['face-option'].hidden = modelKind !== 'photo';
  elements['choose-faces'].hidden = !faceEdit || phase !== 'done';
  elements['choose-faces'].disabled = applying;
  const appOnly = ['browser', 'size', 'format'].includes(errorCode);
  const cpuRetry = failed && errorCode === 'gpu' && !cpuRequested;
  const tryTwo = failed && scaleFallback;
  const retry = hasFile && failed && !appOnly && !cpuRetry && !tryTwo && supported;
  // A photo this device can't take is explained under the photo itself, where it
  // stays in view on a phone, and the main button offers a different photo.
  const photoError = hasFile && failed && ['size', 'format'].includes(errorCode);
  const chooseAnother = photoError && !tryTwo;
  elements['photo-error'].hidden = !photoError;
  elements.status.hidden = photoError;
  elements['choose-another'].hidden = !chooseAnother;
  // Without a photo the drop zone's own button is the only action on the card;
  // with a result the actions move under it, until an option change asks again.
  elements['process-photo'].hidden = !hasFile || phase === 'done' || busy() || cpuRetry || tryTwo || retry || chooseAnother;
  elements['process-photo'].disabled = phase !== 'ready';
  elements.cancel.hidden = !busy();
  elements['cpu-retry'].hidden = !cpuRetry;
  elements.retry.hidden = !retry;
  elements['try-2x'].hidden = !tryTwo;
  elements['visibility-note'].hidden = !busy() || !document.hidden;
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
  renderAccount();
  cloud?.refresh({busy: busy(), locked});
}

function rememberBalance(balance) {
  try {
    const hint = JSON.parse(localStorage.getItem(HINT_KEY) || 'null');
    if (!hint?.signedIn || hint.credits === balance) return;
    localStorage.setItem(HINT_KEY, JSON.stringify({...hint, credits: balance}));
    window.dispatchEvent(new Event('uscale:account-hint'));
  } catch { /* Storage is optional; the header just shows no balance. */ }
}

// The tiles are rendered with the price from pricing.ts; once the worker's own
// table arrives it has the final say, so a price change needs no redeploy.
function renderTilePrices() {
  const prices = session.state.prices;
  if (!prices) return;
  for (const [id, credits] of [['creative', prices.creative?.['4k']], ['restore', prices.restore?.restore]]) {
    const amount = elements[`mode-${id}`]?.querySelector('.mode-tag-amount');
    if (amount && typeof credits === 'number') amount.textContent = t('price_credits', {credits: number(credits)});
  }
}

function renderAccount() {
  const {identity, balance} = session.state;
  renderTilePrices();
  // The balance lives in the header, under Account, not beside a price.
  if (identity && balance !== null) rememberBalance(balance);
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

function setMaxQuality(on) {
  maxQuality = on;
  elements['quality-chip'].hidden = !on;
  elements.status.classList.toggle('is-max', on);
}

function stopWorker() {
  generation++;
  setMaxQuality(false);
  processingController?.cancel(); processingController = null;
  remember(false);
  wakeLock?.release().catch(() => {}); wakeLock = null;
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
  elements['result-comparison'].classList.remove('has-transparency');
  elements['result-tag'].classList.remove('is-max');
  elements['quality-note'].hidden = true;
  elements['download-result'].removeAttribute('href');
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  resultUrl = undefined;
  originalUrl = undefined;
  comparison.reset();
}

function fail(code, key, params, offerScaleFallback = false, stage, diagnostics) {
  if (importSource) {
    analytics.trackEvent(AnalyticsEvent.mediaImportFailed, {source: importSource, count: 1, error_type: code, message: key});
    importSource = undefined;
  }
  if (busy()) trackOutcome('failed', {...processingFailureProperties(code, stage), message: key,
    ...attemptErrorProperties(diagnostics)});
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
  if (data.type === 'photo4x-profile') {
    savePhoto4xProfile(storage, data.profileKey, data.profile);
    return;
  }
  if (data.type === 'forecast') analytics.trackEvent('photo4x_selection', {
    selected_model: data.forecast.allowed ? 'nomos-realplksr' : 'srvgg', reason: data.forecast.reason,
    forecast_ms: data.forecast.milliseconds, cached_profile: Boolean(data.cached), ...photo4xAnalytics,
  });
  if (data.type === 'photo4x-projection') analytics.trackEvent('photo4x_selection', {
    selected_model: 'srvgg', reason: 'projected-over-budget', forecast_ms: data.projectedMs,
    completed_tiles: data.completed, total_tiles: data.total, ...photo4xAnalytics,
  });
  if (data.type === 'photo4x-reference' && !data.passed) analytics.trackEvent('photo4x_selection', {
    selected_model: 'srvgg', reason: 'reference-mismatch', ...photo4xAnalytics,
    mean_error: Number.isFinite(data.meanError) ? Math.round(data.meanError * 10) / 10 : undefined,
    max_error: Number.isFinite(data.maxError) ? data.maxError : undefined,
  });
  if (data.type === 'status' && data.title) {
    const eta = Number.isFinite(data.remainingMs) && data.remainingMs > 5000
      ? `${t('remaining', {time: duration(data.remainingMs)})} ` : '';
    const detail = maxQuality && data.detail === 'upscaling_cancel_detail' ? 'max_quality_detail' : data.detail;
    setStatus(t(data.title, data.params), eta + (detail ? t(detail, data.params) : ''), data.progress);
  } else if (data.type === 'photo') {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    thumbnailUrl = URL.createObjectURL(data.thumbnail);
    elements['source-thumb'].src = thumbnailUrl;
    elements['source-thumb'].classList.toggle('has-transparency', Boolean(data.hasTransparency));
    elements['source-size'].textContent = dimensions(data.plan);
  } else if (data.type === 'forecast' && data.forecast.allowed) {
    // Allowed only after the warm-up and measured tiles, so the badge never shows for a photo it then refuses.
    setMaxQuality(true);
    setStatus(t('upscaling'), `${t('remaining', {time: duration(data.forecast.milliseconds)})} ${t('max_quality_detail')}`, 0);
  } else if (data.type === 'faces') {
    completedFaces = data;
    prepare(data);
  } else if (data.type === 'done') {
    trackOutcome('success', {progress: 1, face_count: data.faceCount || 0, detected_faces: data.detectedCount || 0,
      tile_count: data.plan.tileCount, output_size: `${data.plan.outputWidth}x${data.plan.outputHeight}`,
      backend: data.backend, requested_threads: data.requestedThreads, cpu_threads: data.effectiveThreads, output_format: data.blob.type,
      selected_model: data.variant?.id || 'srvgg', model_revision: data.variant?.revision,
      profile_reused: data.profileReused, calibration_ms: data.calibrationMs, upscale_export_ms: data.upscaleExportMs});
    stopWorker();
    // Only learn from a run long enough to amortise first-inference shader
    // setup. A four-tile photo would otherwise teach a badly pessimistic rate.
    const tileMs = learnedTileMs(data.variant ? {...data, tilesMs: data.tilesMs + data.probeMs} : data);
    if (tileMs !== undefined) rememberTileMs(tileMs, data.modelKind, data.plan.scale, data.variant, data.backend);
    showDeviceResult(data);
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
  // Only the model that really produced the photo decides the badge.
  elements['result-tag'].textContent = t(data.variant ? 'result_tag_max' : 'result_tag', {scale: resultScale});
  elements['result-tag'].classList.toggle('is-max', Boolean(data.variant));
  elements['quality-note'].hidden = !data.variant;
  elements['download-result'].href = resultUrl;
  elements['download-result'].download = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}-uscale-${resultScale}x.${exportExtension(data.blob.type)}`;
  elements['result-comparison'].classList.toggle('has-transparency', Boolean(data.hasTransparency));
  lastResult = {plan: data.plan, modelKind: data.modelKind, mime: data.blob.type, faceEnabled: data.faceEnabled,
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

async function prepare(faceResults = completedFaces) {
  if (!file || !supported) return;
  stopWorker(); clearOutput();
  phase = 'processing';
  errorCode = undefined; scaleFallback = false;
  elements.interrupted.hidden = true;
  setStatus(t(cpuRequested ? 'cpu_title' : 'preparing'), t(cpuRequested ? 'cpu_detail' : 'preparing_detail'));
  refreshControls();
  const current = generation;
  processingController = controllerFor(() => new Worker(new URL('./processor.worker.js', import.meta.url), {type: 'module'}),
    data => { if (current === generation) onMessage(data, current); },
    error => { if (current === generation) {
      fail(error.code, error.key, error.params, error.fallbackScale === 2, 'upscale', error);
    } }, transition => { if (current === generation) recordRetry(transition); });
  remember(true); keepAwake();
  const choices = executionChoices(environment, 'upscale', {forceCpu: cpuRequested, storage, assets: ASSETS});
  photo4xAnalytics = {}; photo4xStartedAt = undefined;
  const variant = await approvedPhoto4xCandidate({environment, modelKind, scale, forceCpu: cpuRequested, storage},
    async () => {
      const adapter = await navigator.gpu?.requestAdapter();
      // Photo 2× and 4× share the model; scale separates them in selection events.
      if (current === generation) photo4xAnalytics = {gpu_vendor: photo4xGpuVendor(adapter?.info), scale};
      return adapter;
    });
  if (current !== generation) return;
  if (modelKind === 'photo' && PHOTO4X_RELEASE.scales.includes(scale)) analytics.trackEvent('photo4x_candidate', {
    eligible: Boolean(variant), cached_profile: Boolean(variant?.cachedProfile), scale, ...photo4xAnalytics,
  });
  if (variant) photo4xStartedAt = performance.now();
  processingController.start({type: 'prepare', file, environment, faceResults, scale, modelKind}, photoExecutionChoices(choices, variant));
}

function startFaces() {
  stopWorker(); clearOutput();
  phase = 'processing';
  errorCode = undefined; scaleFallback = false;
  const current = generation;
  setStatus(t('finding_faces'), t('finding_faces_detail'));
  refreshControls(); remember(true); keepAwake();
  processingController = controllerFor(() => new Worker(new URL('./face.worker.js', import.meta.url)),
    data => { if (current === generation) onMessage(data, current); },
    error => { if (current === generation) {
      fail(error.code, error.key, error.params, false, 'faces', error);
    } }, transition => { if (current === generation) recordRetry(transition); });
  processingController.start({file, environment}, executionChoices(environment, 'faces', {forceCpu: cpuRequested, storage, assets: ASSETS}));
}

function recordRetry({from, to}) {
  if (from.backend === 'webgpu' && to.backend === 'wasm') cpuFallback = true;
  // The photo restarts with the regular model; drop the badge without saying why.
  if (from.variant) setMaxQuality(false);
}

// Same keys as the apps' processingOutcomeProperties, for the web's single photo.
function runProperties() {
  return {screen: SCREEN, mode: mode === 'device' ? modeValue(modelKind, scale) : mode, scale, model: modelKind,
    face: shouldEnhanceFaces(modelKind, elements['enhance-faces'].checked), custom_model: false, media: 'images',
    batch_count: 1, size: lastInfo ? `${lastInfo.width}x${lastInfo.height}` : '-', cpu_fallback: cpuFallback,
    device_class: policy.mobile ? (policy.iPad ? 'ipad' : 'mobile') : 'desktop'};
}
function trackOutcome(result, extra) {
  if (outcomeTracked) return;
  outcomeTracked = true;
  analytics.trackEvent(AnalyticsEvent.processingCompleted, {...runProperties(), result, progress: runProgress,
    duration_sec: Math.round((performance.now() - processingStartedAt) / 100) / 10, ...photo4xAnalytics, ...extra});
}

// Upscaling on the device is free, unlimited and runs in the browser, so it
// asks for nothing. Only the cloud tools need an account, because credits and
// history hang off one.
const needsAccount = value => value !== 'device';
const HINT_KEY = 'uscale-account';
const signedInHint = () => {
  try { return Boolean(JSON.parse(localStorage.getItem(HINT_KEY) || 'null')?.signedIn); } catch { return false; }
};

function requireSignIn(targetMode = mode) {
  location.assign(session.signInUrl(toolUrl(targetMode)));
}

function start({cpu = false} = {}) {
  if (!file || !supported || locked()) return;
  if (needsAccount(mode) && !session.state.identity) { requireSignIn(); return; }
  if (mode === 'device') cpuRequested ||= cpu;
  cpuFallback = mode === 'device' && cpuRequested;
  trackTap('start_processing', runProperties());
  if (mode !== 'device') { cloud.start(); return; }
  processingStartedAt = performance.now(); outcomeTracked = false; runProgress = 0;
  analytics.trackEvent('processing_started', runProperties());
  if (shouldEnhanceFaces(modelKind, elements['enhance-faces'].checked) && completedFaces === undefined) startFaces();
  else prepare();
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
  file = next; completedFaces = undefined; cpuRequested = false; cpuFallback = false; tooLargeFor4x = false;
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
  elements['process-photo'].textContent = t('upscale_button', {scale});
}
function setModelKind(value) {
  if (modelKind !== value) completedFaces = undefined;
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
  completedFaces = undefined;
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
  setStatus(t('done_title'), t(result.saved ? 'done_detail' : 'cloud_not_saved'));
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
  const gated = step === 'tool' && needsAccount(mode);
  const checking = gated && !known;
  elements['signin-checking'].hidden = !checking;
  elements['tool-body'].hidden = gated && !identity;
  if (gated && known && !identity) {
    // A check that timed out tells us nothing. Sending someone to sign in on
    // the strength of it could bounce them straight back, so offer the link
    // and let them decide.
    if (session.state.stalled) offerSignIn(); else requireSignIn();
  }
}

/** Say the check failed, with a way on. Replaces the "checking sign-in" line,
 *  which would otherwise sit there saying nothing for ever. */
function offerSignIn() {
  const notice = elements['signin-checking'];
  notice.hidden = false;
  notice.textContent = t('signin_stalled');
  if (notice.querySelector('a')) return;
  const link = document.createElement('a');
  link.className = 'btn btn-p';
  link.href = session.signInUrl(toolUrl(mode));
  link.textContent = t('signin_go');
  notice.append(document.createElement('br'), link);
}

function toolUrl(value) {
  const url = new URL(location.href);
  url.searchParams.set('mode', value);
  return url.pathname + url.search;
}

function openTool(value, {push = true} = {}) {
  if (needsAccount(value)) {
    session.start();
    if (session.state.known && !session.state.identity && !session.state.stalled) { requireSignIn(value); return; }
  }
  step = 'tool';
  if (push) history.pushState({mode: value}, '', toolUrl(value));
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
session.subscribe(() => {
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
  if (file || event.target.closest('button, .private-note')) return;
  trackTap('drop_zone');
  openPicker();
});
elements['photo-input'].addEventListener('change', () => {
  const next = elements['photo-input'].files[0];
  elements['photo-input'].value = '';
  chooseFile(next, 'picker').catch(readFailure);
});
elements['process-photo'].addEventListener('click', () => { if (phase === 'ready') start(); });
elements.retry.addEventListener('click', () => { trackTap('retry', {reason: errorCode}); start(); });
elements['cpu-retry'].addEventListener('click', () => {
  trackTap('cpu_retry');
  start({cpu: true});
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
  stopWorker(); selection++; phase = 'idle'; file = null;
  if (topUp.isOpen()) topUp.hide();
  errorCode = undefined; scaleFallback = false; cpuRequested = false; cpuFallback = false;
  completedFaces = undefined; tooLargeFor4x = false;
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
  refreshControls();
  processingController?.setHidden(document.hidden); applyController?.setHidden(document.hidden); keepAwake();
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
// Someone here only to upscale on their device never loads the auth SDK; a
// cloud tool, or a browser that has signed in before, does.
if (needsAccount(mode) || signedInHint()) session.start();
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
