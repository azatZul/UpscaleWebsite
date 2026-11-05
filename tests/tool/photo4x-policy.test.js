import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedPhoto4xCandidate, calibratePhoto4xMargin, forecastPhoto4x, gpuSupportsVariant, photo4xConfiguration, photo4xGpuVendor, photo4xOverhead, photoExecutionChoices, selectPhoto4xCandidate, tileGeometry, variantKey,
  PHOTO4X_RELEASE, PHOTO4X_PROFILE_TTL, loadPhoto4xProfile, savePhoto4xProfile, updatePhoto4xProfile, photo4xPath, rememberPhoto4xFailure} from '../../src/tool/photo4x-policy.js';
import {assessPhoto, devicePolicy} from '../../src/tool/capability.js';
import {tileMetricKey} from '../../src/tool/model-selection.js';

const variant = {id: 'nomos', revision: 'abc', tileSize: 256, overlap: 32, precision: 'fp32', requires: {gpuOnly: true, features: [], limits: {maxStorageBufferBindingSize: 256 * 1024 ** 2}}};

test('five-minute boundary is inclusive and missing or invalid evidence fails closed', () => {
  const options = {tileTimes: [100, 200, 100], tileCount: 1000, assemblyMs: 25_000, exportMs: 25_000};
  assert.equal(forecastPhoto4x(options).milliseconds, 300_000);
  assert.equal(forecastPhoto4x(options).allowed, true);
  assert.equal(forecastPhoto4x({...options, exportMs: 25_001}).allowed, false);
  for (const tileTimes of [[], [10, 20], [1, NaN, 2], [1, 0, 2], [1, -1, 2]]) assert.equal(forecastPhoto4x({...options, tileTimes}).allowed, false);
  assert.equal(forecastPhoto4x({...options, assemblyMs: undefined}).allowed, false);
  assert.equal(forecastPhoto4x({...options, margin: 1}).allowed, false);
  assert.equal(forecastPhoto4x({tileTimes: [100_000, 100_000, 100_000], tileCount: 1, assemblyMs: 0, exportMs: 0}).allowed, false);
  assert.equal(forecastPhoto4x({tileTimes: [100], tileCount: 1, assemblyMs: 0, exportMs: 0}).milliseconds, 125);
  assert.equal(forecastPhoto4x({tileTimes: [100, 200], tileCount: 2, assemblyMs: 0, exportMs: 0}).milliseconds, 500);
});

test('tile count changes with overlap and with the smaller memory fallback', () => {
  const input = {width: 4032, height: 3024}, policy = devicePolicy();
  assert.equal(assessPhoto(input, policy, 4).tileCount, 252);
  assert.equal(assessPhoto(input, policy, 4, variant).tileCount, 336);
  assert.equal(assessPhoto(input, policy, 4, {tileSize: 128, overlap: 32}).tileCount, 3024);
  for (const tileSize of [0, NaN, 32]) assert.throws(() => tileGeometry({tileSize, overlap: 32}));
});

test('GPU support checks actual limits and features and rejects software adapters', () => {
  const gpu = {limits: {maxStorageBufferBindingSize: 256 * 1024 ** 2}};
  assert.equal(gpuSupportsVariant(variant, gpu), true);
  assert.equal(gpuSupportsVariant(variant, {limits: {maxStorageBufferBindingSize: 128 * 1024 ** 2}}), false);
  assert.equal(gpuSupportsVariant(variant, {...gpu, isFallbackAdapter: true}), false);
  assert.equal(gpuSupportsVariant({...variant, requires: {features: ['shader-f16']}}, gpu), false);
});

test('diagnostic configuration gates remain explicit; product release requires a supported browser', () => {
  const request = {environment: {userAgent: 'Macintosh', webgpu: true}, modelKind: 'photo', scale: 4, configuration: 'measured'};
  const release = {winner: variant, licenseApproved: true, configurations: ['measured']};
  assert.equal(selectPhoto4xCandidate(request), null);
  assert.equal(selectPhoto4xCandidate(request, release), variant);
  for (const override of [{scale: 2}, {modelKind: 'drawing'}, {configuration: 'unverified'}, {forceCpu: true},
    {environment: {userAgent: 'iPhone', webgpu: true}}, {environment: {userAgent: 'Android', webgpu: true}},
    {environment: {userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5, webgpu: true}},
    {environment: {webgpu: false}}]) assert.equal(selectPhoto4xCandidate({...request, ...override}, release), null);
  assert.equal(selectPhoto4xCandidate(request, {...release, licenseApproved: false}), null);
});

test('only winner is prepended on GPU; cache keys isolate all model configurations', () => {
  const base = [{backend: 'webgpu', threads: 1}, {backend: 'wasm', threads: 1}];
  assert.equal(photoExecutionChoices(base, null), base);
  assert.equal(photoExecutionChoices(base, variant).length, 3);
  assert.equal(photoExecutionChoices(base.slice(1), variant).length, 1);
  const key = tileMetricKey('photo', 4, variant);
  for (const change of [{revision: 'def'}, {precision: 'fp16'}, {tileSize: 128}, {overlap: 16}]) {
    assert.notEqual(key, tileMetricKey('photo', 4, {...variant, ...change}));
  }
  assert.notEqual(variantKey(variant), variantKey(variant, 'wasm'));
});

test('preflight performs no adapter request for a disabled release and isolates remembered GPU failures', async () => {
  let calls = 0;
  const environment = {userAgent: 'Macintosh Chromium/151', platform: 'MacIntel', webgpu: true};
  const adapter = {info: {vendor: 'apple', architecture: 'metal-3'}, features: new Set(), limits: {maxStorageBufferBindingSize: 1024 ** 3}};
  const getAdapter = async () => { calls++; return adapter; };
  const request = {environment, modelKind: 'photo', scale: 4};
  assert.equal(await approvedPhoto4xCandidate(request, getAdapter, {...PHOTO4X_RELEASE, enabled: false}), null);
  assert.equal(calls, 0);
  const release = {winner: variant, licenseApproved: true, configurations: [photo4xConfiguration(environment, adapter.info, adapter)]};
  const approved = await approvedPhoto4xCandidate(request, getAdapter, release);
  assert.equal(approved.id, variant.id);
  const failedStorage = {getItem: key => key === approved.failureKey ? '2000' : null};
  assert.equal(await approvedPhoto4xCandidate({...request, storage: failedStorage, now: 1000}, getAdapter, release), null);
  assert.equal((await approvedPhoto4xCandidate({...request, storage: failedStorage, now: 2001}, getAdapter, release)).id, variant.id);
  assert.equal(await approvedPhoto4xCandidate(request, async () => { throw Error('blocked'); }, release), null);
});

const chrome = {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/151.0.1.2 Safari/537.36',
  platform: 'MacIntel', webgpu: true, hardwareConcurrency: 14, deviceMemory: 32};
const productGpu = {info: {vendor: 'apple', architecture: 'metal-3'}, features: new Set(['shader-f16']),
  limits: {maxBufferSize: 1024 ** 3, maxStorageBufferBindingSize: 1024 ** 3}};
const requestFor = environment => ({environment, modelKind: 'photo', scale: 4});

test('Photo 2× uses the same 4× winner; the release can withdraw it per scale', async () => {
  const request = {...requestFor(chrome), scale: 2};
  assert.equal((await approvedPhoto4xCandidate(request, async () => productGpu)).sha256, PHOTO4X_RELEASE.winner.sha256);
  assert.equal(PHOTO4X_RELEASE.winner.scale, 4);
  assert.equal(await approvedPhoto4xCandidate(request, async () => productGpu, {...PHOTO4X_RELEASE, scales: [4]}), null);
  // Descriptors without scales keep their original Photo 4×-only meaning.
  const {scales, ...legacy} = PHOTO4X_RELEASE;
  assert.equal(await approvedPhoto4xCandidate(request, async () => productGpu, legacy), null);
  assert.ok(await approvedPhoto4xCandidate(requestFor(chrome), async () => productGpu, legacy));
  assert.equal(await approvedPhoto4xCandidate({...request, modelKind: 'drawing'}, async () => productGpu), null);
});

test('product admission is based on GPU capabilities, not a hardware name or a full UA allowlist', async () => {
  for (const userAgent of [chrome.userAgent, 'Mozilla Windows NT 10.0 Chrome/151.0 Safari/537.36 Edg/151.0']) {
    assert.equal((await approvedPhoto4xCandidate(requestFor({...chrome, userAgent}), async () => productGpu)).id, PHOTO4X_RELEASE.winner.id);
  }
  for (const userAgent of ['Linux Chrome/151.0', 'Macintosh Firefox/151.0', 'Android Chrome/151.0',
    'Macintosh Version/27.0 Safari/625.1', 'Macintosh Chrome/151.0 OPR/70.0']) {
    let calls = 0;
    assert.equal(await approvedPhoto4xCandidate(requestFor({...chrome, userAgent}), async () => { calls++; return productGpu; }), null);
    assert.equal(calls, 0);
  }
  for (const gpu of [{...productGpu, features: new Set()}, {...productGpu, isFallbackAdapter: true},
    {...productGpu, info: {vendor: 'google', description: 'SwiftShader software adapter'}},
    {...productGpu, limits: {maxBufferSize: 1024, maxStorageBufferBindingSize: 1024}}]) {
    assert.equal(await approvedPhoto4xCandidate(requestFor(chrome), async () => gpu), null);
  }
});

test('Safari has a separate release gate and requires desktop macOS Safari 26+', async () => {
  const release = {...PHOTO4X_RELEASE, browsers: {...PHOTO4X_RELEASE.browsers, safari: true}};
  for (const version of [26, 27]) {
    assert.ok(await approvedPhoto4xCandidate(requestFor({...chrome, userAgent: `Macintosh Version/${version}.0 Safari/625.1`}), async () => productGpu, release));
  }
  assert.equal(await approvedPhoto4xCandidate(requestFor({...chrome, userAgent: 'Macintosh Version/25.0 Safari/625.1'}), async () => productGpu, release), null);
  assert.equal(await approvedPhoto4xCandidate(requestFor({...chrome, maxTouchPoints: 5}), async () => productGpu, release), null);
});

test('profile identity survives browser patches but changes with major, runtime, GPU or GPU capabilities', () => {
  const key = env => photo4xConfiguration(env, productGpu.info, productGpu);
  assert.equal(key(chrome), key({...chrome, userAgent: chrome.userAgent.replace('151.0.1.2', '151.9.8.7')}));
  assert.notEqual(key(chrome), key({...chrome, userAgent: chrome.userAgent.replace('151.0.1.2', '152.0.0.0')}));
  assert.notEqual(key(chrome), photo4xConfiguration(chrome, {...productGpu.info, device: 'different'}, productGpu));
  assert.notEqual(key(chrome), photo4xConfiguration(chrome, productGpu.info, {...productGpu, features: new Set()}));
  assert.notEqual(key(chrome), photo4xConfiguration(chrome, productGpu.info, productGpu, 'new-runtime'));
});

test('next-day profile is reused, expires after seven days, validates corruption and works without localStorage', () => {
  const now = 10_000, key = 'unit-next-day';
  const profile = updatePhoto4xProfile(undefined, {tileMs: 500, now});
  savePhoto4xProfile(undefined, key, profile, now);
  assert.equal(loadPhoto4xProfile(undefined, key, now + 86_400_000).tileMs, 500);
  assert.equal(loadPhoto4xProfile(undefined, key, now + PHOTO4X_PROFILE_TTL), undefined);
  assert.equal(loadPhoto4xProfile(undefined, key, now - 1), undefined);
  const blocked = {getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }};
  savePhoto4xProfile(blocked, 'unit-private', profile, now);
  assert.equal(loadPhoto4xProfile(blocked, 'unit-private', now + 1).compatible, true);
  for (const value of ['bad json', '{}', JSON.stringify({...profile, tileMs: -1}), JSON.stringify({...profile, margin: 0}),
    JSON.stringify({...profile, overheads: [null]}), JSON.stringify({...profile, updatedAt: String(now)})]) {
    assert.equal(loadPhoto4xProfile({getItem: () => value}, 'corrupt', now), undefined);
  }
});

test('cached overhead is specific to dimensions, output format, alpha and extra base export', () => {
  const plan = {outputWidth: 1000, outputHeight: 2000}, mime = 'image/png';
  const overhead = {path: photo4xPath(plan, mime, {hasTransparency: true, baseExport: true}), assemblyMs: 10, exportMs: 20};
  const profile = updatePhoto4xProfile(undefined, {tileMs: 500, overhead});
  const candidate = {...variant, cachedProfile: profile};
  assert.equal(photo4xOverhead(candidate, plan, mime, {hasTransparency: true, baseExport: true}).exportMs, 20);
  for (const path of [{}, {hasTransparency: true}, {baseExport: true}]) assert.deepEqual(photo4xOverhead(candidate, plan, mime, path), {});
  assert.deepEqual(photo4xOverhead(candidate, {...plan, outputWidth: 1001}, mime, {hasTransparency: true, baseExport: true}), {});
  assert.deepEqual(photo4xOverhead(candidate, plan, 'image/jpeg', {hasTransparency: true, baseExport: true}), {});
  const updated = updatePhoto4xProfile(profile, {tileMs: 400, margin: 1.1});
  assert.equal(updated.tileMs, 475); assert.equal(updated.margin, 1.25);
  assert.equal(updated.overheads[0].exportMs, 20, 'an update without overhead keeps cached overhead');
});

test('a slow run counts at once, then fades over normal runs; updates without evidence keep values', () => {
  let profile = updatePhoto4xProfile(undefined, {tileMs: 400, margin: 1.3});
  profile = updatePhoto4xProfile(profile, {tileMs: 1200, margin: 2});
  assert.equal(profile.tileMs, 1200); assert.equal(profile.margin, 2);
  const unchanged = updatePhoto4xProfile(profile, {overhead: {path: 'p', assemblyMs: 1, exportMs: 1}});
  assert.equal(unchanged.tileMs, 1200); assert.equal(unchanged.margin, 2);
  for (let run = 0; run < 12; run++) profile = updatePhoto4xProfile(profile, {tileMs: 400, margin: 1.3});
  assert.ok(profile.tileMs < 440 && profile.tileMs > 400, `${profile.tileMs}`);
  assert.ok(profile.margin < 1.35 && profile.margin > 1.3, `${profile.margin}`);
  assert.equal(updatePhoto4xProfile(profile, {margin: 1}).margin >= 1.25, true);
});

test('GPU and download failures have distinct TTLs; an over-budget photo never blocks the model', async () => {
  for (const [code, ttl] of [['gpu', 86_400_000], ['timeout', 86_400_000], ['download', 900_000]]) {
    const store = new Map(), storage = {getItem: k => store.get(k), setItem: (k, v) => store.set(k, v)};
    const request = {...requestFor(chrome), storage, now: 1_000};
    const candidate = await approvedPhoto4xCandidate(request, async () => productGpu);
    rememberPhoto4xFailure(storage, candidate, {code}, 1_000);
    assert.equal(store.get(candidate.failureKey), String(1_000 + ttl));
    assert.equal(await approvedPhoto4xCandidate(request, async () => productGpu), null);
    assert.ok(await approvedPhoto4xCandidate({...request, now: 1_000 + ttl}, async () => productGpu));
  }
  const store = new Map(), storage = {getItem: k => store.get(k), setItem: (k, v) => store.set(k, v)};
  const candidate = await approvedPhoto4xCandidate({...requestFor(chrome), now: 100_000_000}, async () => productGpu);
  rememberPhoto4xFailure(storage, candidate, {code: 'budget'});
  assert.equal(store.size, 0);
});

test('forecast calibration never lowers the safety margin and retains worst observed slowdown', () => {
  assert.equal(calibratePhoto4xMargin([]), 1.25);
  assert.equal(calibratePhoto4xMargin([{inferenceEstimateMs: 100, overheadMs: 20, actualMs: 180}]), 1.6);
  assert.equal(calibratePhoto4xMargin([{inferenceEstimateMs: NaN, overheadMs: 20, actualMs: 180}]), 1.25);
});

test('overhead evidence must match device, output format and cover the output size', () => {
  const candidate = {...variant, configuration: 'measured', costEvidence: {buckets: [
    {configuration: 'measured', evidence: 'report.json', maxOutputPixels: 10_000_000, mime: 'image/png', assemblyMs: 100, exportMs: 500, margin: 1.25},
  ]}};
  assert.equal(photo4xOverhead(candidate, {outputWidth: 2000, outputHeight: 2000}, 'image/png').exportMs, 500);
  assert.deepEqual(photo4xOverhead(candidate, {outputWidth: 16000, outputHeight: 12000}, 'image/png'), {});
  assert.deepEqual(photo4xOverhead(candidate, {outputWidth: 2000, outputHeight: 2000}, 'image/jpeg'), {});
  assert.deepEqual(photo4xOverhead({...candidate, configuration: 'other'}, {outputWidth: 2000, outputHeight: 2000}, 'image/png'), {});
});

test('analytics GPU vendor is one coarse family, never the model or driver text', () => {
  assert.equal(photo4xGpuVendor({vendor: 'nvidia', architecture: 'ampere', device: 'RTX 3060'}), 'nvidia');
  assert.equal(photo4xGpuVendor({vendor: 'Intel'}), 'intel');
  assert.equal(photo4xGpuVendor({vendor: 'ati'}), 'amd');
  assert.equal(photo4xGpuVendor({vendor: 'apple'}), 'apple');
  assert.equal(photo4xGpuVendor({vendor: 'mesa-something'}), 'other');
  assert.equal(photo4xGpuVendor({vendor: ''}), 'unknown');
  assert.equal(photo4xGpuVendor(undefined), 'unknown');
});
