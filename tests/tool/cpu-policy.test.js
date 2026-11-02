import test from 'node:test';
import assert from 'node:assert/strict';
import {cpuIdentity, executionChoices, failureKey, failureRemembered, FAILURE_TTL, rememberThreadFailure, threadCandidates, verifiedThreads, selectThreadWinner} from '../../src/tool/cpu-policy.js';

const env = {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/151.0 Safari/537.36',
  hardwareConcurrency: 10, deviceMemory: 8, crossOriginIsolated: true, sharedMemory: true, webgpu: true};
const row = {os: 'macos', engine: 'chromium', minVersion: 150, group: 'upscale',
  coreClasses: ['9-16'], memoryClasses: ['high'], threads: 4, stable: true, evidence: 'report.json', gain: .2};

test('winner requires five stable runs, 15% gain, and prefers fewer threads within 3%', () => {
  const sample = (threads, medianMs, stable = true, runs = 5) => ({threads, medianMs, stable, runs});
  assert.deepEqual(selectThreadWinner([sample(1, 100), sample(2, 86)]), {threads: 1, gain: 0});
  assert.equal(selectThreadWinner([sample(1, 100), sample(2, 70), sample(4, 68)]).threads, 2);
  assert.equal(selectThreadWinner([sample(1, 100), sample(2, 50, false)]).threads, 1);
  assert.equal(selectThreadWinner([sample(1, 100), sample(2, 50, true, 4)]).threads, 1);
});

test('policy survives browser updates and known bad versions take priority', () => {
  assert.equal(verifiedThreads(env, 'upscale', [row]), 4);
  for (const hardwareConcurrency of [9, 10, 12, 14, 16]) {
    assert.equal(verifiedThreads({...env, hardwareConcurrency}, 'upscale', [{...row, threads: 7}]), 7);
  }
  assert.equal(verifiedThreads({...env, userAgent: env.userAgent.replace('151.', '152.')}, 'upscale', [row]), 4);
  assert.equal(verifiedThreads(env, 'upscale', [row], [{os: 'macos', engine: 'chromium', minVersion: 151, maxVersion: 151}]), 1);
  for (const changes of [{crossOriginIsolated: false}, {sharedMemory: false}, {hardwareConcurrency: undefined}, {userAgent: 'unknown'}]) {
    assert.equal(verifiedThreads({...env, ...changes}, 'upscale', [row]), 1);
  }
  assert.equal(verifiedThreads(env, 'faces', [row]), 1);
  assert.equal(verifiedThreads(env, 'upscale', [{...row, gain: .14}]), 1);
  const pinned = {...row, assetRevision: 'ort-a|one|two|three|four'};
  const assets = {runtime: '/ort-a', models: {photo: {2: {cpu: '/one-model.ort'}, 4: {cpu: '/two-model.ort'}},
    drawing: {2: {cpu: '/three-model.ort'}, 4: {cpu: '/four-model.ort'}}}};
  assert.equal(verifiedThreads(env, 'upscale', [pinned], [], assets), 4);
  assert.equal(verifiedThreads(env, 'upscale', [pinned], [], {...assets, runtime: '/ort-b'}), 1);
  assert.equal(verifiedThreads(env, 'upscale', [pinned]), 1);
});

test('desktop candidates include half of ten cores and eight threads; mobile faces skip GPU', () => {
  assert.deepEqual(threadCandidates(env), [1, 2, 4, 5, 8]);
  const iphone = {...env, userAgent: 'iPhone CPU iPhone OS 27_0 like Mac OS X Version/27.0 Mobile Safari/605.1', hardwareConcurrency: 6};
  assert.deepEqual(threadCandidates(iphone), [1, 2]);
  assert.equal(cpuIdentity(iphone).os, 'ios');
  assert.deepEqual(executionChoices(iphone, 'faces'), [{backend: 'wasm', threads: 1}]);
  assert.equal(executionChoices(env, 'faces')[0].backend, 'webgpu');
  assert.equal(cpuIdentity({...iphone, userAgent: 'Macintosh Version/27.0 Safari/605.1', platform: 'MacIntel', maxTouchPoints: 5}).os, 'ipados');
});

test('minimum browser versions retain minor precision and Safari uses Version rather than frozen OS token', () => {
  const safari = {...env, hardwareConcurrency: 4, userAgent: 'iPhone CPU iPhone OS 18_7 like Mac OS X Version/27.2 Mobile Safari/605.1'};
  const policy = {...row, os: 'ios', engine: 'webkit', minVersion: '27.2', coreClasses: ['3-4'], threads: 2};
  assert.equal(cpuIdentity(safari).versionText, '27.2');
  assert.equal(verifiedThreads(safari, 'upscale', [policy]), 2);
  assert.equal(verifiedThreads({...safari, userAgent: safari.userAgent.replace('27.2', '27.1')}, 'upscale', [policy]), 1);
  assert.equal(verifiedThreads({...safari, userAgent: safari.userAgent.replace('27.2', '28.0')}, 'upscale', [policy]), 2);
  assert.equal(verifiedThreads(safari, 'upscale', [policy], [{os: 'ios', engine: 'webkit', minVersion: '27.2', maxVersion: '27.2'}]), 1);
});

test('failed threaded configuration is skipped for seven days and storage is optional', () => {
  const values = new Map(), storage = {getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k)};
  const key = failureKey(env, 'upscale', 4), now = Date.now();
  rememberThreadFailure(storage, key, now);
  assert.ok(failureRemembered(storage, key, now + 100));
  assert.deepEqual(executionChoices(env, 'upscale', {storage, policies: [row]}), [{backend: 'webgpu', threads: 1}, {backend: 'wasm', threads: 1}]);
  assert.equal(failureRemembered(storage, key, now + FAILURE_TTL + 1), false);
  const denied = {getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }};
  assert.equal(failureRemembered(denied, key), false);
  rememberThreadFailure(denied, key);
  assert.equal(executionChoices(env, 'upscale', {policies: [row], storage: denied}).length, 3);
  assert.notEqual(failureKey(env, 'upscale', 4, {runtime: 'ort-a', models: 'a'}), failureKey(env, 'upscale', 4, {runtime: 'ort-b', models: 'a'}));
  assert.notEqual(failureKey(env, 'upscale', 4, {runtime: 'ort-a', models: 'a'}), failureKey(env, 'upscale', 4, {runtime: 'ort-a', models: 'b'}));
});
