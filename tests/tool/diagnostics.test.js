import test from 'node:test';
import assert from 'node:assert/strict';
import {attemptErrorProperties, diagnosticContext, diagnosticText, errorDetails, installErrorDiagnostics} from '../../src/tool/diagnostics.js';
import {PhotoError} from '../../src/tool/capability.js';
import {createAnalytics} from '../../src/tool/analytics.js';

test('Windows diagnostic context includes capabilities and only selected attribution fields', () => {
  const context = diagnosticContext({
    navigator: {userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.1.2',
      hardwareConcurrency: 8, deviceMemory: 4, gpu: {}},
    location: {pathname: '/upscale/', search: '?mode=device&utm_source=reddit&utm_medium=post&token=secret&email=private'},
    document: {referrer: 'https://www.reddit.com/r/windows/?token=secret#private'},
    secure: true, worker: true, wasm: true, bitmap: true, offscreen: true,
  });
  assert.equal(context.browser_os, 'windows');
  assert.equal(context.browser_engine, 'chromium');
  assert.equal(context.browser_version, '151.0.1.2');
  assert.equal(context.webgpu_available, true);
  assert.equal(context.shared_memory_available, false);
  assert.equal(context.referring_domain, 'www.reddit.com');
  assert.equal(context.utm_source, 'reddit');
  assert.equal(context.utm_medium, 'post');
  assert.doesNotMatch(JSON.stringify(context), /secret|private|token|r\/windows/);
  assert.doesNotThrow(() => diagnosticContext());
});

test('original engine exceptions survive PhotoError wrapping and redact sensitive text', () => {
  const original = new TypeError('Failed to fetch https://example.com/model?token=secret');
  original.stack = 'TypeError: Failed\n at load (https://upscales.app/app.js?secret:10:2)';
  const details = errorDetails(new PhotoError('gpu', 'err_engine_start', undefined, original));
  assert.equal(details.engine_error_type, 'TypeError');
  assert.equal(details.engine_message, 'Failed to fetch [url]');
  assert.doesNotMatch(details.engine_stack, /secret|https:/);
  const text = diagnosticText('Cannot read C:\\Users\\alex\\portrait.png /Users/alex/private.png person@example.com blob:https://example.com/private');
  assert.doesNotMatch(text, /alex|portrait|private|person|example/);
  assert.equal(diagnosticText('a'.repeat(5000)).length, 1200);
  assert.doesNotThrow(() => errorDetails(undefined));
});

test('global diagnostics redact complete URLs containing parentheses from messages and stacks', () => {
  const target = new EventTarget(), calls = [];
  const analytics = createAnalytics({consent: true, client: {track: (type, properties) => calls.push({type, properties})}});
  const detach = installErrorDiagnostics({target, analytics});
  const urls = ['https://example.test/a(b)?token=secret#private',
    'https://example.test/a(b(c))?token=secret', 'blob:https://example.test/a(b)?token=secret',
    'file:///Users/alex/a(b)?token=secret', 'data:text/plain,a(b)?token=secret'];
  for (const [index, url] of urls.entries()) {
    const error = new Error(`Failure ${index}: ${url}`);
    error.stack = `Error: ${error.message}\n at load (${url}:12:3)`;
    target.dispatchEvent(Object.assign(new Event('error'), {error}));
  }
  assert.equal(calls.length, urls.length);
  for (const [index, {type, properties}] of calls.entries()) {
    assert.equal(type, 'browser_error');
    assert.equal(properties.engine_message, `Failure ${index}: [url]`);
    assert.doesNotMatch(properties.engine_stack, /example|alex|token|secret|private/);
  }
  detach();
});

test('attempt diagnostics preserve the selected model in analytics and expose the engine model separately', () => {
  const calls = [];
  const analytics = createAnalytics({consent: true, client: {track: (type, properties) => calls.push({type, properties})}});
  for (const [model, engineModel] of [['photo', 'photo-2'], ['drawing', 'drawing-4'], ['photo', 'faces']]) {
    const diagnostics = attemptErrorProperties({model: engineModel, operation: 'initialize', backend: 'wasm'});
    assert.equal(Object.hasOwn(diagnostics, 'model'), false);
    analytics.trackEvent('processing_completed', {model, result: 'failed', ...diagnostics});
    const event = calls.at(-1);
    assert.equal(event.properties.model, model);
    assert.equal(event.properties.engine_model, engineModel);
  }
  assert.deepEqual(attemptErrorProperties(), {});
});

test('global diagnostics obey consent, deduplicate and cap errors, ignore media errors, and detach', () => {
  const target = new EventTarget(), calls = [];
  const analytics = createAnalytics({client: {track: (type, properties) => calls.push({type, properties})}});
  const detach = installErrorDiagnostics({target, analytics, state: () => ({phase: 'processing'})});
  const emit = (name, properties) => target.dispatchEvent(Object.assign(new Event(name), properties));
  emit('error', {message: 'engine failed'});
  emit('error', {message: 'engine failed'});
  emit('error', {targetImage: 'private.png'});
  assert.equal(calls.length, 0);
  analytics.setConsent(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'browser_error');
  assert.equal(calls[0].properties.phase, 'processing');
  for (let i = 0; i < 20; i++) emit('unhandledrejection', {reason: `Failure ${i}`});
  assert.equal(calls.length, 10);
  detach();
  assert.doesNotThrow(() => emit('error', {message: 'after detach'}));
  assert.equal(calls.length, 10);
});

test('declining consent drops diagnostics and a broken reporter cannot affect the page', () => {
  const target = new EventTarget(), calls = [];
  const analytics = createAnalytics({client: {track: (...args) => calls.push(args)}, consent: false});
  const detach = installErrorDiagnostics({target, analytics});
  target.dispatchEvent(Object.assign(new Event('error'), {message: 'engine failed'}));
  assert.equal(calls.length, 0);
  detach();
  installErrorDiagnostics({target, analytics: {trackEvent() { throw new Error('offline'); }}});
  assert.doesNotThrow(() => target.dispatchEvent(Object.assign(new Event('error'), {message: 'another failure'})));
});
