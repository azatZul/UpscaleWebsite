// Cloud modes on the upscaler page: their options, the sign-in and credit
// gates, and the request. The photo, status, buttons and result viewer belong
// to main.js and are shared through the hooks it passes in, so both kinds of
// processing live in one card.
import {DEFAULT_PRICES, cloudCredits, cloudFields, defaultOptions, normalizeRestore} from './cloud-pricing.js';
import {prepareUpload, uploadPlan} from './cloud-image.js';
import {mergeTiles, splitPhoto, tileGrid, tileRects, tiledResolution} from './creative-tiles.js';
import {ApiError} from './account-link.js';
import {AnalyticsEvent, SCREEN} from './analytics.js';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function createCloud(hooks) {
  const {elements, t, session, topUp, requireSignIn, getMode, getFile, getInfo, setStatus, setPhase, refreshControls, fail,
    presentResult, optionsChanged, analytics, trackTap, isLocked} = hooks;
  const number = value => new Intl.NumberFormat(document.documentElement.lang || 'en').format(value);
  const options = defaultOptions();
  const restoreButtons = [...document.querySelectorAll('[data-restore-mode]')];
  const resolutionButtons = [...document.querySelectorAll('[data-resolution]')];

  let running = false;

  const cloudMode = () => getMode() !== 'device';
  const currentOptions = () => (getMode() === 'creative' ? {...options.creative} : normalizeRestore(options.restore));
  const credits = () => cloudCredits(session.state.prices || DEFAULT_PRICES, getMode(), currentOptions());
  const update = () => { render(); refreshControls(); };

  const topUpTitle = () => t('topup_title', {credits: number(credits() ?? 0), balance: number(session.state.balance ?? 0)});

  /** Bring the cloud parts of the card in line with the current mode and state.
   *  Called by main.js's refreshControls, after it has set the shared controls. */
  function render({busy = false, locked = isLocked()} = {}) {
    const mode = getMode();
    const cloud = mode !== 'device';
    // The drop zone's corner note says where the photo is processed.
    elements['private-note'].hidden = cloud;
    elements['cloud-note'].hidden = !cloud;
    elements['creative-options'].hidden = mode !== 'creative' || busy;
    elements['restore-options'].hidden = mode !== 'restore' || busy;

    const table = session.state.prices || DEFAULT_PRICES;
    for (const button of restoreButtons) {
      const value = button.dataset.restoreMode;
      button.setAttribute('aria-checked', String(options.restore.mode === value));
      button.disabled = locked;
      // Every mode costing the same makes four identical price tags noise; the
      // process button still says what the photo costs.
      const prices = Object.values(table.restore);
      const sameForAll = prices.every(price => price === prices[0]);
      button.querySelector('.restore-mode-price').textContent = sameForAll
        ? '' : t('price_credits', {credits: number(table.restore[value])});
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

    if (cloud) {
      const price = credits();
      elements['process-photo'].textContent = t(mode === 'creative' ? 'creative_button' : 'restore_button',
        {credits: price === null ? '–' : number(price)});
      if (topUp.isOpen()) elements['process-photo'].hidden = true;
    }
  }

  function onMode() {
    if (topUp.reason() === 'cloud') topUp.hide();
    render();
  }

  function handleFailure(error, cost) {
    const status = error instanceof ApiError ? error.status : 0;
    const body = error instanceof ApiError ? error.body : null;
    session.apply(body);
    const backToReady = () => { setPhase('ready'); setStatus(t('cloud_ready'), t('cloud_ready_detail')); };
    if (status === 401) { requireSignIn(); return; }
    if (status === 402) { topUp.show({reason: 'cloud', title: topUpTitle()}); backToReady(); return; }
    if (status === 413) { fail('size', 'cloud_too_large'); return; }
    if (status === 429) { fail('cloud', 'cloud_too_many'); return; }
    if (status === 503) { fail('cloud', 'cloud_unavailable'); return; }
    if (status === 409 && body?.error === 'history_full') { fail('cloud', 'cloud_history_full'); return; }
    if (status === 502 && body?.refunded) { fail('cloud', 'cloud_failed_refunded', {credits: number(cost)}); return; }
    if (status === 0) { fail('cloud', 'cloud_network'); return; }
    fail('cloud', 'cloud_failed');
  }

  /** Collect the finished tiles, put them back into one photo, and keep it.
   *
   *  The job is already paid for by the time this runs, so nothing here may
   *  throw the result away: if saving it fails, the photo is still shown and
   *  still downloadable, just not kept in history. */
  async function stitch(response, rects, grid, original) {
    // All at once: each is a few megabytes, and one after another they add up.
    let fetched = 0;
    const total = response.tiles.length;
    setStatus(t('cloud_merging'), t('cloud_tile_progress', {index: 1, total}));
    const tiles = await Promise.all(response.tiles.map(tile => session.tile(tile, response.jobId).then(blob => {
      fetched += 1;
      setStatus(t('cloud_merging'), t('cloud_tile_progress', {index: Math.min(fetched + 1, total), total}));
      return blob;
    })));
    setStatus(t('cloud_merging'), t('cloud_merging_detail'));
    const merged = await mergeTiles(tiles, rects, {width: rects.at(-1).x + rects.at(-1).width,
      height: rects.at(-1).y + rects.at(-1).height}, grid);
    let saved = null;
    try {
      setStatus(t('cloud_merging'), t('cloud_saving'));
      saved = await session.saveResult(response.jobId, merged, original);
    } catch {
      // Keeping the copy is best effort; the photo below is the real result.
    }
    // The save answers with resultUrl; the viewer shows outputUrl. Without this
    // the page pointed the result at nothing while history had the photo.
    if (saved?.saved) return {...response, ...saved, outputUrl: saved.resultUrl, downloadUrl: saved.downloadUrl};
    const local = URL.createObjectURL(merged);
    return {...response, outputUrl: local, downloadUrl: local, saved: false};
  }

  async function start() {
    const mode = getMode();
    const file = getFile();
    const info = getInfo();
    if (running || !file || !info || mode === 'device') return;
    if (!session.state.identity) { requireSignIn(); return; }
    const chosen = currentOptions();
    const cost = credits();
    const balance = session.state.balance;
    // The worker is the authority; this only saves a round trip that would
    // certainly come back 402.
    if (balance !== null && cost !== null && balance < cost) { topUp.show({reason: 'cloud', title: topUpTitle()}); update(); return; }

    if (topUp.reason() === 'cloud') topUp.hide();
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

    // A photo past the model's comfortable size goes up in tiles, as the app
    // does, and comes back to be stitched here.
    const grid = mode === 'creative' ? tileGrid(plan.width, plan.height) : {x: 1, y: 1};
    const rects = grid.x * grid.y > 1 ? tileRects(plan.width, plan.height, grid) : null;
    let pieces = null;
    if (rects) {
      try {
        pieces = await splitPhoto(upload, rects);
      } catch {
        running = false;
        fail('format', 'err_unreadable');
        return;
      }
      if (pieces.some(piece => piece.size > MAX_UPLOAD_BYTES)) { running = false; fail('size', 'cloud_too_large'); return; }
    }

    const form = new FormData();
    if (pieces) {
      form.append('tileCount', String(pieces.length));
      pieces.forEach((piece, index) => form.append(`tile${index}`, new File([piece], `tile-${index}.jpg`, {type: 'image/jpeg'})));
    } else {
      form.append('image', new File([upload], 'photo.jpg', {type: 'image/jpeg'}));
    }
    // A fresh id per attempt: the worker charges once per id, so a network
    // retry of this same request can never charge twice.
    form.append('requestId', crypto.randomUUID().replaceAll('-', ''));
    for (const [name, value] of Object.entries(cloudFields(mode, chosen))) form.append(name, value);

    const elapsed = () => Math.round((performance.now() - startedAt) / 1000);
    // The provider reports no progress, so the bar is an estimate, and a
    // pessimistic one: per provider call, about half again what it measured
    // (2K ~17 s, 4K ~45 s), times the rounds of tiles, which go two at a time,
    // plus time to stitch them. It fills to 95% over that and then only creeps,
    // so a slow job never shows a full bar that is not done.
    const tileCount = rects?.length ?? 1;
    const callMs = {'2k': 25_000, '4k': 60_000, '8k': 120_000}[tiledResolution(chosen.resolution, tileCount)];
    const estimateMs = mode === 'creative' && callMs
      ? callMs * Math.ceil(tileCount / 2) + (tileCount > 1 ? 10_000 : 0) : 60_000;
    const fraction = () => {
      const ms = performance.now() - startedAt;
      return ms < estimateMs ? 0.95 * ms / estimateMs : 0.95 + 0.04 * (1 - Math.exp((estimateMs - ms) / estimateMs));
    };
    const tick = () => setStatus(t('cloud_processing'), t('cloud_processing_detail'), fraction());
    tick();
    const timer = setInterval(tick, 500);
    const properties = {screen: SCREEN, mode, credits: cost, media: 'images', batch_count: 1,
      options: JSON.stringify(cloudFields(mode, chosen)), size: `${info.width}x${info.height}`};
    try {
      const response = await session.process(mode, form);
      // Stitching reports its own steps; the estimate must not paint over them.
      clearInterval(timer);
      session.apply(response);
      const result = response.tiles ? await stitch(response, rects, grid, upload) : response;
      running = false;
      analytics.trackEvent(AnalyticsEvent.processingCompleted, {...properties, result: 'success', saved: result.saved,
        tiles: rects?.length ?? 1, duration_sec: elapsed()});
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
  // The cloud top-up closes itself once the balance covers this mode's price.
  session.subscribe(state => {
    if (topUp.reason() !== 'cloud') return;
    const price = credits();
    if (state.balance !== null && price !== null && state.balance >= price) topUp.hide();
    else topUp.setTitle(topUpTitle());
  });

  return {refresh: render, start, onMode};
}
