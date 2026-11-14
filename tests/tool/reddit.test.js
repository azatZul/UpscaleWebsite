import test from 'node:test';
import assert from 'node:assert/strict';
import {createRedditTracking, readAdConsent, ATTRIBUTION_KEY} from '../../assets/reddit.js';

function setup({consent, hostname = 'upscales.app', pixel, post: responder} = {}) {
  const values = new Map(consent ? [['uscale-consent', JSON.stringify(consent)]] : []);
  const calls = [];
  let id = 0;
  const storage = {getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k)};
  const tracker = createRedditTracking({storage, pixel,
    location: {hostname, protocol: 'https:', pathname: '/free-upscale/', search: '?rdt_cid=reddit-click&utm_campaign=launch&oobCode=private'},
    random: () => `event-${++id}`,
    post: async (path, body) => { calls.push({path, body}); return responder ? responder(path, body) : {accepted: true}; },
  });
  return {tracker, calls, values, storage};
}

test('old analytics consent cannot enable Reddit or persist click attribution', async () => {
  for (const consent of [undefined, {v: 1, analytics: true}, {v: 2, analytics: true, advertising: false}]) {
    const {tracker, calls, values, storage} = setup({consent});
    assert.equal(readAdConsent(storage), false);
    tracker.start();
    assert.equal(await tracker.track('UpscaleCompleted'), false);
    await tracker.ready();
    assert.equal(calls.some(c => c.path === '/api/ads/event'), false);
    assert.equal(values.has(ATTRIBUTION_KEY), false);
  }
});

test('upscales are consented, deduplicated, and cannot be relabeled as purchases', async () => {
  const {tracker, calls} = setup({consent: {v: 2, analytics: false, advertising: true}});
  assert.equal(await tracker.track('UpscaleCompleted', 'run-1'), true);
  assert.equal(await tracker.track('UpscaleCompleted', 'run-1'), false);
  assert.equal(await tracker.track('Purchase', 'order-1'), false);
  assert.deepEqual(calls.map(c => c.path), ['/api/ads/consent', '/api/ads/event']);
  assert.equal(calls[0].body.clickId, 'reddit-click');
  assert.equal(JSON.stringify(calls).includes('private'), false);
});

test('preview hosts send no events even if production consent is copied', async () => {
  const {tracker, calls} = setup({hostname: 'uscale-site-staging.example.workers.dev', consent: {v: 2, advertising: true}});
  tracker.start();
  assert.equal(await tracker.track('UpscaleCompleted'), false);
  await tracker.ready();
  assert.equal(calls.length, 0);
});

test('blocked pixel falls back to one relay event and successful pixel does not duplicate it', async () => {
  for (const loaded of [true, false]) {
    const {tracker, calls} = setup({pixel: async () => loaded, consent: {v: 2, advertising: true}});
    assert.equal(await tracker.track('PageVisit', 'page-1'), true);
    assert.equal(calls.filter(c => c.path === '/api/ads/event').length, loaded ? 0 : 1);
  }
});

test('withdrawing during registration revokes after the cookie response and suppresses pending events', async () => {
  let release;
  const {tracker, calls, values} = setup({consent: {v: 2, advertising: true}, post: (_path, body) =>
    body.advertising === true ? new Promise(resolve => { release = resolve; }) : {accepted: false}});
  const event = tracker.track('UpscaleCompleted');
  await new Promise(resolve => setImmediate(resolve));
  tracker.setConsent(false);
  release({accepted: true});
  assert.equal(await event, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(values.has(ATTRIBUTION_KEY), false);
  assert.deepEqual(calls.map(c => c.body.advertising), [true, false]);
  assert.equal(await tracker.track('UpscaleCompleted'), false);
});

test('server-disabled tracking does not load the pixel', async () => {
  let loads = 0;
  const {tracker} = setup({consent: {v: 2, advertising: true}, pixel: async () => { loads++; return true; },
    post: async () => ({accepted: false})});
  assert.equal(await tracker.track('PageVisit'), false);
  assert.equal(loads, 0);
});
