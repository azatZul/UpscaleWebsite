// Browser funnel only. Paid conversions are produced by verified Stripe paths
// on the Worker, never by a URL parameter or a public browser event.
export const REDDIT_PIXEL_ID = 'a2_i7c385uefy4v';
export const AD_CONSENT_KEY = 'uscale-consent';
export const ATTRIBUTION_KEY = 'uscale-reddit-attribution-v1';
const RETENTION_MS = 30 * 86400_000;
const EVENTS = new Set(['PageVisit', 'UpscaleCompleted', 'RestoreCompleted', 'ResultDownloaded']);

export function readAdConsent(storage) {
  try {
    const record = JSON.parse(storage?.getItem(AD_CONSENT_KEY));
    return record?.v === 2 && record.advertising === true;
  } catch { return false; }
}

export function createRedditTracking({location, storage, post, pixel, forgetPixel = () => {},
  random = () => crypto.randomUUID(), now = () => Date.now()} = {}) {
  const production = location?.hostname === 'upscales.app' && location?.protocol === 'https:';
  const params = new URLSearchParams(location?.search || '');
  const enabled = production && !params.has('fixture') && !params.has('analytics-debug');
  let allowed = readAdConsent(storage);
  let serial = Promise.resolve(false);
  let registered = false;
  let generation = 0;
  let pageTracked = false;
  let initialized = false;
  const seen = new Set();

  function attribution() {
    let saved;
    try { saved = JSON.parse(storage?.getItem(ATTRIBUTION_KEY)); } catch { /* Optional storage. */ }
    if (!saved || saved.expires <= now()) saved = {};
    const click = params.get('rdt_cid');
    if (click && /^[a-zA-Z0-9_.:-]{1,256}$/.test(click)) {
      saved = {clickId: click, expires: now() + RETENTION_MS};
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
        if (params.has(key)) saved[key] = params.get(key).slice(0, 150);
      }
    }
    try {
      if (saved.expires) storage?.setItem(ATTRIBUTION_KEY, JSON.stringify(saved));
      else storage?.removeItem(ATTRIBUTION_KEY);
    } catch { /* Cookies can still maintain consented attribution. */ }
    return {...saved, path: location.pathname};
  }

  function ready() {
    if (!enabled || !allowed) return Promise.resolve(false);
    if (registered) return serial;
    registered = true;
    const revision = generation;
    serial = serial.catch(() => false).then(async () => {
      if (!allowed || revision !== generation) return false;
      try {
        const result = await post('/api/ads/consent', {v: 2, advertising: true, ...attribution()});
        const accepted = allowed && revision === generation && result?.accepted === true;
        if (!accepted) registered = false;
        return accepted;
      } catch { registered = false; return false; }
    });
    return serial;
  }

  async function track(event, id = random()) {
    if (!enabled || !allowed || !EVENTS.has(event) || seen.has(id)) return false;
    seen.add(id);
    const revision = generation;
    // Marketing PageVisit uses the pixel. Tool/account/album PageVisit and
    // result events use a same-origin relay, compatible with COEP and strict CSP.
    if (event === 'PageVisit' && pixel) {
      try {
        if (!await ready()) return false;
        if (!allowed || revision !== generation) return false;
        if (await pixel(id)) return true;
      } catch { /* A blocked pixel falls back to the consented relay. */ }
    }
    if (!await ready() || !allowed || revision !== generation) return false;
    try {
      const result = await post('/api/ads/event', {event, id, path: location.pathname});
      return result?.accepted === true;
    } catch { return false; }
  }

  function pageVisit() {
    if (!allowed || pageTracked) return;
    pageTracked = true;
    void track('PageVisit');
  }

  function setConsent(value) {
    if (initialized && (value === true) === allowed) return;
    initialized = true;
    const previouslyAllowed = allowed;
    allowed = value === true;
    generation++;
    registered = false;
    if (allowed) {
      void ready();
      pageVisit();
    } else {
      try { storage?.removeItem(ATTRIBUTION_KEY); } catch { /* Blocked storage. */ }
      forgetPixel();
      // Serialize withdrawal after an in-flight registration, including its
      // Set-Cookie response, so that request cannot restore revoked consent.
      if (enabled) serial = serial.catch(() => false).then(async () => {
        try { await post('/api/ads/consent', {v: 2, advertising: false}); } catch { /* Retry on next page load. */ }
        return false;
      });
      if (previouslyAllowed) pageTracked = false;
    }
  }

  return {ready, track, setConsent, start() { setConsent(allowed); }};
}

export function initRedditTracking(win = globalThis.window) {
  if (!win?.document) return;
  let storage;
  try { storage = win.localStorage; } catch { /* In-memory preference still works. */ }
  const doc = win.document;
  let pixelLoad;
  let pixelScript;
  const canUsePixel = !win.crossOriginIsolated
    && !/^\/(?:account|gallery)(?:\/|$)/.test(win.location.pathname)
    && !/(?:^|\/)(?:free-upscale|upscale)(?:\/|$)/.test(win.location.pathname);
  let pixelAllowed = readAdConsent(storage);

  function forgetPixel() {
    pixelAllowed = false;
    pixelScript?.remove();
    if (win.rdt) {
      if (win.rdt.callQueue) win.rdt.callQueue.length = 0;
      // Stop the loaded instance too: event-setup listeners may retain it even
      // after removing its script element. A fresh grant loads a new instance.
      win.rdt.sendEvent = () => {};
      delete win.rdt;
    }
    pixelLoad = undefined;
    pixelScript = undefined;
    for (const name of ['_rdt_cid', '_rdt_uuid', '_rdt_em', '_rdt_pn']) {
      for (const domain of ['', '; Domain=upscales.app', '; Domain=.upscales.app']) {
        doc.cookie = `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax${domain}`;
      }
    }
  }

  async function pixel(id) {
    if (!pixelAllowed) return false;
    if (!pixelLoad) pixelLoad = new Promise(resolve => {
      if (!win.rdt) {
        const rdt = function (...args) {
          if (rdt.sendEvent) rdt.sendEvent(...args); else rdt.callQueue.push(args);
        };
        rdt.callQueue = [];
        win.rdt = rdt;
      }
      pixelScript = doc.createElement('script');
      pixelScript.async = true;
      pixelScript.src = `https://www.redditstatic.com/ads/pixel.js?pixel_id=${REDDIT_PIXEL_ID}`;
      pixelScript.onload = () => resolve(true);
      pixelScript.onerror = () => resolve(false);
      doc.head.append(pixelScript);
      // Don't delay the tool or lose PageVisit if a blocker leaves loading hung.
      win.setTimeout(() => resolve(false), 4000);
    });
    if (!await pixelLoad || !pixelAllowed) return false;
    win.rdt('init', REDDIT_PIXEL_ID, {optOut: false, useDecimalCurrencyValues: true});
    win.rdt('track', 'PageVisit', {conversionId: id});
    return true;
  }

  const tracker = createRedditTracking({location: win.location, storage,
    pixel: canUsePixel ? pixel : undefined, forgetPixel,
    post: async (path, body) => {
      const result = await win.fetch(path, {method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(5000)});
      return result.ok ? result.json() : null;
    },
  });
  win.uscaleAds = tracker;
  doc.addEventListener('uscale:consent', event => {
    pixelAllowed = event.detail?.v === 2 && event.detail.advertising === true;
    tracker.setConsent(pixelAllowed);
  });
  win.addEventListener('storage', event => {
    if (event.key === AD_CONSENT_KEY || event.key === null) {
      pixelAllowed = readAdConsent(storage);
      tracker.setConsent(pixelAllowed);
    }
  });
  doc.addEventListener('uscale:ad-event', event => {
    void tracker.track(event.detail?.event, event.detail?.id);
  });
  // Native album forms must give context registration time to finish, without
  // making a tracker failure prevent the purchase.
  doc.addEventListener('submit', event => {
    const form = event.target;
    if (!form.matches?.('[data-album-unlock]') || form.dataset.adsReady) return;
    event.preventDefault();
    void tracker.ready().finally(() => { form.dataset.adsReady = 'true'; form.requestSubmit(); });
  });
  tracker.start();
  return tracker;
}

if (globalThis.window?.document) initRedditTracking();
