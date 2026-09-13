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

const ID_KEY = 'uscale-analytics-id-v1';

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
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

// The apps' mode strings for their local models: normal2/normal4 and anime2/anime4.
export function modeValue(modelKind, scale) {
  return `${modelKind === 'drawing' ? 'anime' : 'normal'}${scale}`;
}

const messageOf = error => (error instanceof Error ? error.message : String(error ?? 'unknown'));
const typeOf = error => error?.code || error?.name || (error instanceof Error ? error.constructor.name : typeof error);

// Pure core so it runs under node:test with a fake client. `debug` logs instead
// of sending, like the apps' DEBUG builds. Tracking never throws into the page.
export function createAnalytics({client, debug = false, log = (...args) => console.debug(...args), context = {}} = {}) {
  const base = {platform: 'web', ...context};
  const quiet = () => debug || !client;

  function send(eventType, properties = {}) {
    const merged = {...base, ...properties};
    if (quiet()) { log?.(`[analytics] ${eventType}`, merged); return; }
    try { client.track(eventType, merged); } catch { /* Analytics must not break the tool. */ }
  }

  return {
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
      if (quiet()) { log?.('[analytics] user-property', {[key]: value}); return; }
      try { client.identify(new client.Identify().set(key, value)); } catch { /* See send. */ }
    },
    // Called from pagehide: a closing tab can only be relied on to send a beacon.
    flush() {
      if (quiet()) return;
      try { client.setTransport('beacon'); client.flush(); } catch { /* See send. */ }
    },
  };
}

// Browser entry. Local hosts, or ?analytics-debug, log to the console and send nothing.
export function initAnalytics({location = globalThis.location, document = globalThis.document} = {}) {
  const host = location?.hostname || '';
  const local = host === 'localhost' || host === '127.0.0.1';
  const debug = local || new URLSearchParams(location?.search || '').has('analytics-debug');
  const context = {
    environment: local ? 'local' : host.endsWith('.pages.dev') ? 'preview' : 'production',
    locale: document?.documentElement?.lang || 'en',
  };
  if (debug) return createAnalytics({debug: true, context});
  try {
    amplitude.init(AMPLITUDE_KEY, webIdentity(), {
      identityStorage: 'localStorage',
      autocapture: false,
      fetchRemoteConfig: false,
      transport: 'fetch',
    });
    return createAnalytics({client: amplitude, context});
  } catch {
    return createAnalytics({debug: true, log: null, context});
  }
}
