import * as amplitude from '@amplitude/analytics-browser';

// Mirrors the iOS and Android analytics helpers: the same Amplitude project, the
// same generic `tap` action with element and screen, and the same named events,
// so web funnels line up with the apps'. Photos, file names and pixels are never
// sent — only what the controls and the processing outcome were.
export const AMPLITUDE_KEY = 'fa6daa9107d5be46943924799f6247d';
export const SCREEN = 'free-upscale';

export const AnalyticsAction = Object.freeze({tap: 'tap'});

export const AnalyticsEvent = Object.freeze({
  mediaImportSuccess: 'media_import_success',
  mediaImportFailed: 'media_import_failed',
  processingCompleted: 'processing_completed',
  resultSaveSuccess: 'result_save_success',
  photoRejected: 'photo_rejected',
});

// Written by the site-wide consent banner in assets/site.js.
export const CONSENT_KEY = 'uscale-consent';
export const CONSENT_EVENT = 'uscale:consent';
const ID_KEY = 'uscale-analytics-id-v1';
// Events from before the visitor answers the banner stay in this tab's memory and
// are sent only if analytics is accepted; rejecting discards them.
const PENDING_LIMIT = 100;

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

// true / false once the visitor chose, undefined while the banner is unanswered.
export function storedConsent(storage = browserStorage()) {
  try {
    const record = JSON.parse(storage?.getItem(CONSENT_KEY));
    return record?.v === 1 ? Boolean(record.analytics) : undefined;
  } catch {
    return undefined;
  }
}

// Best-effort identity. The apps keep theirs across reinstalls (Keychain,
// ANDROID_ID); a browser can only keep a random id in site storage, so it resets
// with cleared data, private windows and other browsers. No cookies are used.
export function webIdentity(storage = browserStorage(), random = () => globalThis.crypto.randomUUID()) {
  try {
    const existing = storage?.getItem(ID_KEY);
    if (existing && existing.length >= 5) return existing;
  } catch { /* Storage can be blocked; a per-page id still groups this visit. */ }
  const id = `web-${random()}`;
  try { storage?.setItem(ID_KEY, id); } catch { /* Same as above. */ }
  return id;
}

// Withdrawing consent removes the id and everything the SDK stored.
export function forgetIdentity(storage = browserStorage()) {
  try {
    const keys = Array.from({length: storage.length}, (_, index) => storage.key(index));
    for (const key of keys) if (key === ID_KEY || key?.startsWith('AMP_')) storage.removeItem(key);
  } catch { /* Nothing to remove, or storage is blocked. */ }
}

// The apps' mode strings for their local models: normal2/normal4 and anime2/anime4.
export function modeValue(modelKind, scale) {
  return `${modelKind === 'drawing' ? 'anime' : 'normal'}${scale}`;
}

const messageOf = error => (error instanceof Error ? error.message : String(error ?? 'unknown'));
const typeOf = error => error?.code || error?.name || (error instanceof Error ? error.constructor.name : typeof error);

// Pure core so it runs under node:test with a fake client. `connect` creates the
// SDK client the first time analytics is allowed, so nothing is stored or sent
// before consent. `debug` logs instead of sending, like the apps' DEBUG builds.
// Tracking never throws into the page.
export function createAnalytics({client, connect = client && (() => client), consent, debug = false,
  log = (...args) => console.debug(...args), forget = () => {}, context = {}} = {}) {
  const base = {platform: 'web', ...context};
  let connected;
  let pending = [];

  function sink() {
    if (debug) return undefined;
    if (!connected && connect) {
      try { connected = connect(); } catch { connect = undefined; }
    }
    return connected;
  }

  function deliver(item) {
    if (debug) { log?.(`[analytics] ${item.type}`, item.properties); return; }
    const target = sink();
    if (!target) return;
    try {
      if (item.type === '$identify') target.identify(new target.Identify().set(item.key, item.value));
      else target.track(item.type, item.properties);
    } catch { /* Analytics must not break the tool. */ }
  }

  function queue(item) {
    if (consent === true) deliver(item);
    else if (consent === undefined && pending.length < PENDING_LIMIT) pending.push(item);
  }

  const send = (type, properties = {}) => queue({type, properties: {...base, ...properties}});

  return {
    get consent() { return consent; },
    setConsent(allowed) {
      const previous = consent;
      consent = Boolean(allowed);
      if (debug) log?.('[analytics] consent', {analytics: consent});
      if (consent) {
        if (previous === false && connected) try { connected.setOptOut(false); } catch { /* See deliver. */ }
        const held = pending; pending = [];
        held.forEach(deliver);
      } else {
        pending = [];
        if (connected) try { connected.setOptOut(true); } catch { /* See deliver. */ }
        forget();
      }
    },
    trackScreen(screen) {
      send('[Amplitude] Screen Viewed', {'[Amplitude] Screen Name': screen || 'unknown-screen'});
    },
    trackView(element) {
      send('view', {element});
    },
    trackAction(action, element, screen, properties = {}) {
      send(action, {...properties, element, screen});
    },
    trackEvent(eventType, properties = {}) {
      send(eventType, properties);
    },
    trackError(error, action, properties = {}) {
      send('error', {...properties, msg: messageOf(error), action, error_type: typeOf(error)});
    },
    setUserProperty(key, value) {
      queue({type: '$identify', key, value, properties: {[key]: value}});
    },
    // Called from pagehide: a closing tab can only be relied on to send a beacon.
    flush() {
      if (debug || consent !== true || !connected) return;
      try { connected.setTransport('beacon'); connected.flush(); } catch { /* See deliver. */ }
    },
  };
}

// Browser entry. Local hosts, or ?analytics-debug, log to the console and send nothing.
export function initAnalytics({location = globalThis.location, document = globalThis.document,
  storage = browserStorage()} = {}) {
  const host = location?.hostname || '';
  const local = host === 'localhost' || host === '127.0.0.1';
  const debug = local || new URLSearchParams(location?.search || '').has('analytics-debug');
  const context = {
    environment: local ? 'local' : host.endsWith('.pages.dev') ? 'preview' : 'production',
    locale: document?.documentElement?.lang || 'en',
  };
  const analytics = createAnalytics({
    debug,
    context,
    consent: storedConsent(storage),
    forget: () => forgetIdentity(storage),
    connect: () => {
      amplitude.init(AMPLITUDE_KEY, webIdentity(storage), {
        identityStorage: 'localStorage',
        autocapture: false,
        fetchRemoteConfig: false,
        transport: 'fetch',
      });
      return amplitude;
    },
  });
  document?.addEventListener(CONSENT_EVENT, event => analytics.setConsent(Boolean(event.detail?.analytics)));
  return analytics;
}
