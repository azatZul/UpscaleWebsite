import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchModel, forgetModel, MODEL_CACHE} from '../../src/tool/model-cache.js';

const BASE = 'https://upscales.app/assets/processor/';

function fakeStorage({failOpen = false, failPut = false, beforePut = async () => {}} = {}) {
  const entries = new Map();
  const opened = [];
  const cache = {
    async match(url) { const body = entries.get(new URL(url, BASE).href); return body && new Response(body); },
    async put(url, response) {
      const body = new Uint8Array(await response.arrayBuffer());
      await beforePut();
      if (failPut) throw new DOMException('quota', 'QuotaExceededError');
      entries.set(new URL(url, BASE).href, body);
    },
    async keys() { return [...entries.keys()].map(url => ({url})); },
    async delete(request) { return entries.delete(typeof request === 'string' ? new URL(request, BASE).href : request.url); },
  };
  // CacheStorage.open() need not return the same Cache object each time.
  return {entries, opened, storage: {async open(name) { opened.push(name); if (failOpen) throw new Error('blocked'); return {...cache}; }}};
}

const network = (calls, status = 200) => async url => { calls.push(url); return new Response(new Uint8Array([1, 2, 3]), {status}); };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};

test('a model is downloaded once and then served from Cache Storage', async () => {
  const {storage, entries, opened} = fakeStorage();
  const calls = [];
  const url = `${BASE}a-model.onnx`;
  const first = await fetchModel(url, {storage, fetcher: network(calls)});
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [1, 2, 3]);
  await settle();
  assert.equal(entries.size, 1);
  const second = await fetchModel(url, {storage, fetcher: network(calls)});
  assert.deepEqual([...new Uint8Array(await second.arrayBuffer())], [1, 2, 3]);
  assert.equal(calls.length, 1);
  assert.deepEqual(new Set(opened), new Set([MODEL_CACHE]));
});

test('storing a new release removes models it no longer uses', async () => {
  const {storage, entries} = fakeStorage();
  const calls = [];
  await (await fetchModel(`${BASE}old.onnx`, {storage, fetcher: network(calls), keep: new Set([`${BASE}old.onnx`])})).arrayBuffer();
  await settle();
  await (await fetchModel(`${BASE}new.onnx`, {storage, fetcher: network(calls), keep: new Set([`${BASE}new.onnx`])})).arrayBuffer();
  await settle();
  assert.deepEqual([...entries.keys()], [`${BASE}new.onnx`]);
});

test('failed responses, blocked storage and a full quota fall back to the network', async () => {
  const calls = [];
  const failed = fakeStorage();
  assert.equal((await fetchModel(`${BASE}missing.onnx`, {storage: failed.storage, fetcher: network(calls, 404)})).status, 404);
  await settle();
  assert.equal(failed.entries.size, 0);

  for (const options of [{failOpen: true}, {failPut: true}]) {
    const {storage, entries} = fakeStorage(options);
    const response = await fetchModel(`${BASE}a.onnx`, {storage, fetcher: network(calls)});
    assert.equal((await response.arrayBuffer()).byteLength, 3);
    await settle();
    assert.equal(entries.size, 0);
  }
  const response = await fetchModel(`${BASE}a.onnx`, {storage: undefined, fetcher: network(calls)});
  assert.equal(response.status, 200);
});

test('a rejected model is forgotten so the next attempt downloads it again', async () => {
  const {storage, entries} = fakeStorage();
  const calls = [];
  await (await fetchModel(`${BASE}a.onnx`, {storage, fetcher: network(calls)})).arrayBuffer();
  await settle();
  await forgetModel(`${BASE}a.onnx`, storage);
  assert.equal(entries.size, 0);
  await forgetModel(`${BASE}a.onnx`, undefined);
});

for (const failPut of [false, true]) {
  test(`forgetting waits for an unfinished cache write (${failPut ? 'failed' : 'successful'} write)`, async () => {
    const writing = deferred(), release = deferred();
    const {storage, entries} = fakeStorage({failPut, beforePut: async () => {
      writing.resolve();
      await release.promise;
    }});
    const calls = [], url = `${BASE}rejected.onnx`;
    const response = await fetchModel(url, {storage, fetcher: network(calls)});
    assert.equal((await response.arrayBuffer()).byteLength, 3);
    await writing.promise;

    let forgotten = false;
    const forgetting = forgetModel(url, storage).then(() => { forgotten = true; });
    await settle();
    const completedBeforeWrite = forgotten;
    release.resolve();
    await forgetting;
    await settle();

    assert.equal(completedBeforeWrite, false);
    assert.equal(entries.size, 0);
    await (await fetchModel(url, {storage, fetcher: network(calls)})).arrayBuffer();
    assert.equal(calls.length, 2);
    await forgetModel(url, storage);
    assert.equal(entries.size, 0);
  });
}

test('forgetting removes every concurrent write for the same model', async () => {
  const writing = deferred(), release = deferred();
  const {storage, entries} = fakeStorage({beforePut: async () => {
    writing.resolve();
    await release.promise;
  }});
  const calls = [], url = `${BASE}concurrent.onnx`;
  const responses = await Promise.all([
    fetchModel(url, {storage, fetcher: network(calls)}),
    fetchModel(url, {storage, fetcher: network(calls)}),
  ]);
  await Promise.all(responses.map(response => response.arrayBuffer()));
  await writing.promise;
  const forgetting = forgetModel(url, storage);
  release.resolve();
  await forgetting;
  await settle();
  assert.equal(entries.size, 0);
});
