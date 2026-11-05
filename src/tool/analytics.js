import * as amplitude from '@amplitude/analytics-browser';
import {diagnosticContext} from './diagnostics.js';
import {createAnalytics, storedConsent, forgetIdentity, webIdentity, browserStorage, AMPLITUDE_KEY, CONSENT_EVENT} from './analytics-core.js';
export * from './analytics-core.js';

// Only the canonical production host sends events. Preview/local hosts and
// ?analytics-debug log to the console without initializing the SDK.
export function initAnalytics({location = globalThis.location, document = globalThis.document,
  storage = browserStorage()} = {}) {
  const host = location?.hostname || '';
  const local = host === 'localhost' || host === '127.0.0.1';
  const debug = host !== 'upscales.app' || new URLSearchParams(location?.search || '').has('analytics-debug');
  const context = {
    diagnostic_id: globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    ...diagnosticContext({location, document, navigator: globalThis.navigator,
      crossOriginIsolated: globalThis.crossOriginIsolated, sharedMemory: typeof SharedArrayBuffer === 'function',
      secure: globalThis.isSecureContext, worker: typeof Worker === 'function',
      wasm: typeof WebAssembly === 'object', bitmap: typeof createImageBitmap === 'function',
      offscreen: typeof OffscreenCanvas === 'function'}),
    app_build: import.meta.env?.VITE_TOOL_BUILD || 'development',
    environment: local ? 'local' : host === 'upscales.app' ? 'production' : 'preview',
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
