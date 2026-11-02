import {cpuIdentity} from './cpu-policy.js';

// Diagnostics contain technical details only. Do not pass files, pixels, input
// prompts, full page/referrer URLs or arbitrary objects to the analytics client.
export function diagnosticText(value, limit = 1200) {
  return String(value ?? '')
    // Parentheses can be part of the URL; stopping at one can expose its query.
    .replace(/(?:https?|file|blob|data):[^\s"'<>]*/gi, '[url]')
    .replace(/\b[A-Z]:\\[^\s"'<>]*/gi, '[path]')
    .replace(/\/(?:Users|home|private|tmp)\/[^\s"'<>)]*/g, '[path]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b[^\s/\\]+\.(?:png|jpe?g|webp|heic|avif|gif|bmp|tiff?)\b/gi, '[image]')
    .slice(0, limit);
}

export function errorDetails(error) {
  // PhotoError carries the visitor-facing translation key; its cause retains
  // the actual engine exception. Only serializable, bounded strings cross workers.
  let cause = error;
  for (let i = 0; i < 4 && cause?.cause && cause.cause !== cause; i++) cause = cause.cause;
  return {
    engine_error_type: diagnosticText(cause?.name || typeof cause, 80),
    engine_message: diagnosticText(cause?.message ?? cause ?? 'unknown'),
    engine_stack: diagnosticText(cause?.stack?.split('\n').slice(0, 6).join('\n')),
  };
}

export function attemptErrorProperties(error = {}) {
  // Keep the selected product model stable across run outcomes and retries.
  return Object.fromEntries(['operation', 'model', 'backend', 'requested_threads', 'attempt_index',
    'engine_error_type', 'engine_message', 'engine_stack', 'error_line', 'error_column']
    .filter(key => error[key] !== undefined).map(key => [key === 'model' ? 'engine_model' : key, error[key]]));
}

export function diagnosticContext({location = {}, document = {}, navigator = {},
  crossOriginIsolated = false, sharedMemory = false, secure = false, worker = false,
  wasm = false, bitmap = false, offscreen = false} = {}) {
  const identity = cpuIdentity(navigator);
  const context = {
    diagnostic_version: 1,
    browser_os: identity.os, browser_engine: identity.engine, browser_version: identity.versionText,
    browser_user_agent: diagnosticText(navigator.userAgent, 500),
    hardware_concurrency: navigator.hardwareConcurrency, device_memory_gb: navigator.deviceMemory,
    webgpu_available: Boolean(navigator.gpu), cross_origin_isolated: Boolean(crossOriginIsolated),
    shared_memory_available: Boolean(sharedMemory), secure_context: Boolean(secure),
    worker_available: Boolean(worker), wasm_available: Boolean(wasm),
    bitmap_available: Boolean(bitmap), offscreen_canvas_available: Boolean(offscreen),
    entry_path: location.pathname,
  };
  try {
    const referrer = new URL(document.referrer);
    if (['http:', 'https:'].includes(referrer.protocol)) context.referring_domain = referrer.hostname;
  } catch { /* Direct navigation or a browser hiding the referrer. */ }
  const query = new URLSearchParams(location.search || '');
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    if (query.get(key)) context[key] = diagnosticText(query.get(key), 120);
  }
  return context;
}

// Keep a noisy script from exhausting the analytics quota. Existing consent and
// debug handling still apply, and reporting must never affect the tool's UI.
export function installErrorDiagnostics({analytics, target = globalThis, state = () => ({})}) {
  let count = 0;
  const seen = new Set();
  const report = (error, action) => {
    try {
      const details = errorDetails(error);
      const key = `${action}:${details.engine_message}:${details.engine_stack}`;
      if (count >= 10 || seen.has(key)) return;
      seen.add(key); count++;
      analytics.trackEvent('browser_error', {...state(), action, ...details});
    } catch { /* Reporting is best effort, including during partial startup. */ }
  };
  const onError = event => {
    // Resource errors have no exception/message and may refer to private media.
    if (event.error || event.message) report(event.error || event.message, 'uncaught_error');
  };
  const onRejection = event => report(event.reason instanceof Error || typeof event.reason === 'string'
    ? event.reason : 'Unhandled promise rejection', 'unhandled_rejection');
  target.addEventListener?.('error', onError);
  target.addEventListener?.('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener?.('error', onError);
    target.removeEventListener?.('unhandledrejection', onRejection);
  };
}
