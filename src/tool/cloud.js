// Cloud modes on the upscaler page: their options, the sign-in and credit
// gates, and the request. The photo, status, buttons and result viewer belong
// to main.js and are shared through the hooks it passes in, so both kinds of
// processing live in one card.
import {DEFAULT_PRICES, cloudCredits, cloudFields, defaultOptions, normalizeRestore} from './cloud-pricing.js';
import {prepareUpload, uploadPlan} from './cloud-image.js';
import {ApiError, connectAccount} from './account-link.js';
import {AnalyticsEvent, SCREEN} from './analytics.js';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Written by the account page; read here only to decide whether loading the
// auth SDK up front is worth it for someone in on-device mode.
const HINT_KEY = 'uscale-account';

function signedInHint() {
  try { return Boolean(JSON.parse(localStorage.getItem(HINT_KEY) || 'null')?.signedIn); } catch { return false; }
}

export function createCloud(hooks) {
  const {elements, t, getMode, getFile, getInfo, setStatus, setPhase, refreshControls, fail, presentResult,
    optionsChanged, analytics, trackTap, isLocked} = hooks;
  const number = value => new Intl.NumberFormat(document.documentElement.lang || 'en').format(value);
  const options = defaultOptions();
  const account = connectAccount();
  const restoreButtons = [...document.querySelectorAll('[data-restore-mode]')];
  const resolutionButtons = [...document.querySelectorAll('[data-resolution]')];
  const stepText = [...elements['step-upscale'].childNodes].find(node => node.nodeType === Node.TEXT_NODE);
  const deviceStep = stepText?.nodeValue ?? '';

  let watching = false;
  let identityKnown = false;
  let identity = null;
  let prices = null;
  let packs = null;
  let balance = null;
  // 'signin' or 'topup' while one of them stands in for the main button.
  let gate = null;
  let needed = 0;
  let running = false;

  const cloudMode = () => getMode() !== 'device';
  const currentOptions = () => (getMode() === 'creative' ? {...options.creative} : normalizeRestore(options.restore));
  const credits = () => cloudCredits(prices || DEFAULT_PRICES, getMode(), currentOptions());
  const update = () => { render(); refreshControls(); };

  function ensureAccount() {
    if (watching) return;
    watching = true;
    account.watch(next => {
      identity = next;
      identityKnown = true;
      if (!identity) {
        balance = null;
        if (cloudMode()) gate = 'signin';
      } else {
        if (gate === 'signin') gate = null;
        elements['signin-status'].hidden = true;
        loadAccount();
      }
      update();
    });
  }

  async function loadAccount() {
    try {
      const [me, catalogue] = await Promise.all([account.me(), account.catalogue()]);
      balance = me.credits;
      prices = catalogue.prices || null;
      packs = catalogue.packs || null;
      if (gate === 'topup' && balance >= needed) {
        gate = null;
        elements['topup-status'].hidden = true;
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        identity = null;
        if (cloudMode()) gate = 'signin';
      }
    }
    update();
  }

  function renderAmounts() {
    const list = (packs || []).slice().sort((a, b) => a.priceCents - b.priceCents);
    const signature = list.map(pack => `${pack.id}:${pack.credits}`).join();
    if (elements['topup-amounts'].dataset.rendered === signature) return;
    elements['topup-amounts'].dataset.rendered = signature;
    elements['topup-amounts'].replaceChildren(...list.map(pack => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-g';
      button.textContent = t('topup_amount', {price: `$${number(pack.priceCents / 100)}`, credits: number(pack.credits)});
      button.addEventListener('click', () => topUp(pack.priceCents));
      return button;
    }));
  }

  async function topUp(amountCents) {
    trackTap('topup', {amount_cents: amountCents});
    // Opened synchronously, inside the click, so no popup blocker intervenes;
    // it navigates to Stripe once the session exists. The photo stays here.
    const tab = window.open('', '_blank');
    try {
      const {url} = await account.checkout(amountCents);
      if (tab) {
        tab.location.href = url;
        elements['topup-status'].textContent = t('topup_opened');
        elements['topup-status'].hidden = false;
      } else {
        window.location.assign(url);
      }
    } catch {
      tab?.close();
      elements['topup-status'].textContent = t('cloud_network');
      elements['topup-status'].hidden = false;
    }
  }

  /** Bring the cloud parts of the card in line with the current mode and state.
   *  Called by main.js's refreshControls, after it has set the shared controls. */
  function render({busy = false, locked = isLocked()} = {}) {
    const mode = getMode();
    const cloud = mode !== 'device';
    elements['private-badge'].hidden = cloud;
    elements['cloud-badge'].hidden = !cloud;
    elements['creative-options'].hidden = mode !== 'creative' || busy;
    elements['restore-options'].hidden = mode !== 'restore' || busy;
    elements['credit-chip'].hidden = !(identity && balance !== null);
    if (balance !== null) elements['credit-count'].textContent = number(balance);
    if (stepText) stepText.nodeValue = cloud ? t('step_process') : deviceStep;

    const table = prices || DEFAULT_PRICES;
    for (const button of restoreButtons) {
      const value = button.dataset.restoreMode;
      button.setAttribute('aria-checked', String(options.restore.mode === value));
      button.disabled = locked;
      button.querySelector('.restore-mode-price').textContent = t('price_credits', {credits: number(table.restore[value])});
    }
    for (const button of resolutionButtons) {
      button.setAttribute('aria-pressed', String(options.creative.resolution === button.dataset.resolution));
      button.disabled = locked;
    }
    elements.creativity.value = String(options.creative.creativity);
    elements.creativity.disabled = locked;
    elements['creativity-value'].textContent = t(`creativity_${options.creative.creativity + 2}`);
    const advanced = options.restore.mode === 'advanced_restoration';
    elements['increase-resolution'].checked = !advanced && options.restore.increaseResolution;
    elements['increase-resolution'].disabled = advanced || locked;
    elements['hires-note'].hidden = !advanced;
    elements.negative.checked = options.restore.negative;
    elements.negative.disabled = locked;
    elements['prompt-field'].hidden = advanced;
    elements['restore-prompt'].disabled = locked;

    elements['signin-panel'].hidden = !cloud || gate !== 'signin' || busy;
    elements['topup-panel'].hidden = !cloud || gate !== 'topup' || busy;
    if (cloud && gate === 'topup') {
      elements['topup-title'].textContent = t('topup_title', {credits: number(needed), balance: number(balance ?? 0)});
      renderAmounts();
    }
    if (cloud) {
      const price = credits();
      elements['process-photo'].textContent = t(mode === 'creative' ? 'creative_button' : 'restore_button',
        {credits: price === null ? '–' : number(price)});
      if (gate) elements['process-photo'].hidden = true;
    }
  }

  function onMode(mode) {
    if (mode === 'device') {
      gate = null;
    } else {
      ensureAccount();
      if (identityKnown && !identity) gate = 'signin';
    }
    render();
  }

  function handleFailure(error, cost) {
    const status = error instanceof ApiError ? error.status : 0;
    const body = error instanceof ApiError ? error.body : null;
    if (typeof body?.balance === 'number') balance = body.balance;
    const backToReady = () => { setPhase('ready'); setStatus(t('cloud_ready'), t('cloud_ready_detail')); };
    if (status === 401) { identity = null; gate = 'signin'; backToReady(); return; }
    if (status === 402) { needed = body?.required ?? cost; gate = 'topup'; backToReady(); return; }
    if (status === 413) { fail('size', 'cloud_too_large'); return; }
    if (status === 429) { fail('cloud', 'cloud_too_many'); return; }
    if (status === 503) { fail('cloud', 'cloud_unavailable'); return; }
    if (status === 409 && body?.error === 'history_full') { fail('cloud', 'cloud_history_full'); return; }
    if (status === 502 && body?.refunded) { fail('cloud', 'cloud_failed_refunded', {credits: number(cost)}); return; }
    if (status === 0) { fail('cloud', 'cloud_network'); return; }
    fail('cloud', 'cloud_failed');
  }

  async function start() {
    const mode = getMode();
    const file = getFile();
    const info = getInfo();
    if (running || !file || !info || mode === 'device') return;
    ensureAccount();
    if (!identity) { gate = 'signin'; update(); return; }
    const chosen = currentOptions();
    const cost = credits();
    // The worker is the authority; this only saves a round trip that would
    // certainly come back 402.
    if (balance !== null && cost !== null && balance < cost) { needed = cost; gate = 'topup'; update(); return; }

    gate = null;
    running = true;
    const startedAt = performance.now();
    setPhase('processing');
    setStatus(t('cloud_preparing'), t('cloud_processing_detail'));
    refreshControls();

    const plan = uploadPlan(info.width, info.height, mode, chosen);
    let upload;
    try {
      upload = await prepareUpload(file, plan, {negative: mode === 'restore' && chosen.negative});
    } catch {
      running = false;
      fail('format', 'err_unreadable');
      return;
    }
    if (upload.size > MAX_UPLOAD_BYTES) { running = false; fail('size', 'cloud_too_large'); return; }

    const form = new FormData();
    form.append('image', new File([upload], 'photo.jpg', {type: 'image/jpeg'}));
    // A fresh id per attempt: the worker charges once per id, so a network
    // retry of this same request can never charge twice.
    form.append('requestId', crypto.randomUUID().replaceAll('-', ''));
    for (const [name, value] of Object.entries(cloudFields(mode, chosen))) form.append(name, value);

    const elapsed = () => Math.round((performance.now() - startedAt) / 1000);
    const tick = () => setStatus(t('cloud_processing'), `${t('cloud_processing_detail')} ${t('cloud_elapsed', {seconds: elapsed()})}`);
    tick();
    const timer = setInterval(tick, 1000);
    const properties = {screen: SCREEN, mode, credits: cost, media: 'images', batch_count: 1,
      options: JSON.stringify(cloudFields(mode, chosen)), size: `${info.width}x${info.height}`};
    try {
      const result = await account.process(mode, form);
      balance = result.balance;
      running = false;
      analytics.trackEvent(AnalyticsEvent.processingCompleted, {...properties, result: 'success', saved: result.saved, duration_sec: elapsed()});
      presentResult({mode, options: chosen, result, before: upload, plan});
    } catch (error) {
      running = false;
      analytics.trackEvent(AnalyticsEvent.processingCompleted, {...properties, result: 'failed',
        error_type: error instanceof ApiError ? `${error.status}:${error.message}` : 'network', duration_sec: elapsed()});
      handleFailure(error, cost);
    } finally {
      clearInterval(timer);
      update();
    }
  }

  const changed = () => { update(); optionsChanged(); };
  elements.creativity.addEventListener('input', () => {
    options.creative.creativity = Number(elements.creativity.value);
    changed();
  });
  for (const button of resolutionButtons) {
    button.addEventListener('click', () => {
      trackTap('resolution', {value: button.dataset.resolution});
      options.creative.resolution = button.dataset.resolution;
      changed();
    });
  }
  for (const button of restoreButtons) {
    button.addEventListener('click', () => {
      trackTap('restore_mode', {value: button.dataset.restoreMode});
      options.restore.mode = button.dataset.restoreMode;
      changed();
    });
  }
  elements['increase-resolution'].addEventListener('change', () => {
    options.restore.increaseResolution = elements['increase-resolution'].checked;
    changed();
  });
  elements.negative.addEventListener('change', () => {
    options.restore.negative = elements.negative.checked;
    changed();
  });
  elements['restore-prompt'].addEventListener('input', () => { options.restore.prompt = elements['restore-prompt'].value; });
  elements['cloud-signin'].addEventListener('click', () => {
    trackTap('cloud_sign_in');
    const opened = account.openSignIn();
    elements['signin-status'].textContent = t(opened ? 'signin_waiting' : 'signin_blocked');
    elements['signin-status'].hidden = false;
  });
  elements['topup-refresh'].addEventListener('click', () => { trackTap('topup_refresh'); loadAccount(); });
  // Coming back from the checkout tab: pick up the new balance.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && identity && cloudMode()) loadAccount(); });

  if (signedInHint()) ensureAccount();
  return {refresh: render, start, onMode};
}
