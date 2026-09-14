import test from 'node:test';
import assert from 'node:assert/strict';
import {AnalyticsAction, AnalyticsEvent, createAnalytics, forgetIdentity, modeValue, storedConsent, webIdentity}
  from '../../src/tool/analytics.js';

const memory = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    keys: () => [...map.keys()],
  };
};

function fakeClient() {
  const calls = [];
  class Identify { set(key, value) { this.entry = [key, value]; return this; } }
  return {
    calls, Identify,
    track: (type, properties) => calls.push({type, properties}),
    identify: identify => calls.push({type: 'identify', entry: identify.entry}),
    setTransport: transport => calls.push({type: 'transport', transport}),
    setOptOut: optOut => calls.push({type: 'optOut', optOut}),
    flush: () => calls.push({type: 'flush'}),
  };
}

test('web identity persists per browser and survives blocked storage', () => {
  const storage = memory();
  let n = 0;
  const random = () => `id-${++n}`;
  const first = webIdentity(storage, random);
  assert.equal(first, 'web-id-1');
  assert.equal(webIdentity(storage, random), first);
  const blocked = {getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }};
  assert.equal(webIdentity(blocked, random), 'web-id-2');
});

test('stored consent reads the banner record and ignores anything else', () => {
  assert.equal(storedConsent(memory()), undefined);
  assert.equal(storedConsent(memory({'uscale-consent': '{"v":1,"analytics":true}'})), true);
  assert.equal(storedConsent(memory({'uscale-consent': '{"v":1,"analytics":false}'})), false);
  assert.equal(storedConsent(memory({'uscale-consent': 'yes'})), undefined);
  assert.equal(storedConsent(memory({'uscale-consent': '{"v":2,"analytics":true}'})), undefined);
});

test('nothing connects or sends before consent; accepting releases held events', () => {
  const client = fakeClient();
  let connects = 0;
  const analytics = createAnalytics({connect: () => { connects++; return client; }});
  analytics.trackScreen('free-upscale');
  analytics.trackAction(AnalyticsAction.tap, 'choose_photo', 'free-upscale');
  analytics.flush();
  assert.equal(connects, 0);
  assert.equal(client.calls.length, 0);
  analytics.setConsent(true);
  assert.equal(connects, 1);
  assert.deepEqual(client.calls.map(call => call.type), ['[Amplitude] Screen Viewed', 'tap']);
});

test('rejecting drops held events, never connects, and clears stored identity', () => {
  const client = fakeClient();
  const storage = memory({'uscale-analytics-id-v1': 'web-1', AMP_abc: '{}', 'uscale-theme': 'dark'});
  let connects = 0;
  const analytics = createAnalytics({connect: () => { connects++; return client; }, forget: () => forgetIdentity(storage)});
  analytics.trackEvent(AnalyticsEvent.mediaImportSuccess);
  analytics.setConsent(false);
  analytics.trackEvent(AnalyticsEvent.processingCompleted);
  assert.equal(connects, 0);
  assert.equal(client.calls.length, 0);
  assert.deepEqual(storage.keys(), ['uscale-theme']);
});

test('withdrawing opts the SDK out, and granting again opts back in', () => {
  const client = fakeClient();
  const analytics = createAnalytics({client, consent: true});
  analytics.trackEvent('tap');
  analytics.setConsent(false);
  analytics.trackEvent('dropped');
  analytics.setConsent(true);
  analytics.trackEvent('again');
  assert.deepEqual(client.calls.map(call => call.optOut ?? call.type), ['tap', true, false, 'again']);
});

test('actions and events carry the app shape plus web context', () => {
  const client = fakeClient();
  const analytics = createAnalytics({client, consent: true, context: {environment: 'preview', locale: 'fr'}});
  analytics.trackAction(AnalyticsAction.tap, 'start_processing', 'free-upscale', {mode: 'normal4'});
  analytics.trackEvent(AnalyticsEvent.processingCompleted, {result: 'success'});
  analytics.trackScreen('');
  assert.deepEqual(client.calls[0], {type: 'tap', properties: {platform: 'web', environment: 'preview', locale: 'fr',
    mode: 'normal4', element: 'start_processing', screen: 'free-upscale'}});
  assert.equal(client.calls[1].type, 'processing_completed');
  assert.equal(client.calls[2].properties['[Amplitude] Screen Name'], 'unknown-screen');
});

test('debug logs instead of sending, and a failing client never throws', () => {
  const client = fakeClient();
  const logged = [];
  createAnalytics({client, consent: true, debug: true, log: (...args) => logged.push(args)}).trackEvent('media_import_success');
  assert.equal(client.calls.length, 0);
  assert.equal(logged[0][0], '[analytics] media_import_success');
  const broken = {track() { throw new Error('offline'); }, setTransport() { throw new Error('offline'); }, flush() {}};
  const analytics = createAnalytics({client: broken, consent: true});
  assert.doesNotThrow(() => { analytics.trackEvent('tap'); analytics.flush(); });
  assert.doesNotThrow(() => createAnalytics({connect() { throw new Error('blocked'); }, consent: true}).trackEvent('tap'));
});

test('errors, user properties and exit flush match the app helpers', () => {
  const client = fakeClient();
  const analytics = createAnalytics({client, consent: true});
  analytics.trackError(Object.assign(new Error('Out of memory'), {code: 'gpu'}), 'processing');
  analytics.setUserProperty('first_locale', 'ja');
  analytics.flush();
  assert.deepEqual(client.calls[0].properties, {platform: 'web', msg: 'Out of memory', action: 'processing', error_type: 'gpu'});
  assert.deepEqual(client.calls[1], {type: 'identify', entry: ['first_locale', 'ja']});
  assert.deepEqual(client.calls.slice(2).map(call => call.type), ['transport', 'flush']);
});

test('mode strings match the apps for photo and drawing models', () => {
  assert.equal(modeValue('photo', 2), 'normal2');
  assert.equal(modeValue('photo', 4), 'normal4');
  assert.equal(modeValue('drawing', 4), 'anime4');
});
