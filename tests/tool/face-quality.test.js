import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {IOS_FACE_POLICY, FACE_PIXEL_POLICY, decideFaceQuality, measureFaceQuality, faceLuma, resizeFaceLuma2x} from '../../src/tool/face-quality.js';

const evidence = (overrides = {}) => ({canonical: {sourceSignal: 2, retention: 1}, structure: .96,
  native: null, cropPixels: 400, interEyePixels: 60, landmarkShift: .01, ...overrides});
const decide = e => decideFaceQuality(evidence(e));

test('the iOS snapshot, policy and 26 reference decisions are pinned', () => {
  const root = new URL('../fixtures/face-quality/ios-reference/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex'), hash, name);
  assert.deepEqual(IOS_FACE_POLICY, JSON.parse(readFileSync(new URL('policy.json', root))));
  for (const row of JSON.parse(readFileSync(new URL('expected.json', root)))) {
    const actual = decideFaceQuality(row.evidence, IOS_FACE_POLICY);
    assert.equal(actual.status, row.status, row.id); assert.equal(actual.reason, row.reason, row.id);
  }
});

test('pixel policy explicitly excludes landmarks but retains SSIM and small-face review', () => {
  assert.equal(decide({landmarkShift: null}).status, 'pass');
  assert.equal(decide({landmarkShift: Infinity}).status, 'pass');
  assert.equal(decideFaceQuality(evidence({landmarkShift: null}), IOS_FACE_POLICY).reason, 'insufficient-evidence');
  assert.equal(decideFaceQuality(evidence({landmarkShift: .041}), IOS_FACE_POLICY).reason, 'geometry-risk');
  assert.equal(decideFaceQuality(evidence({landmarkShift: .04}), IOS_FACE_POLICY).status, 'pass');
  assert.equal(decide({structure: .879}).reason, 'geometry-risk');
  assert.equal(decide({structure: .88}).status, 'pass');
  assert.equal(decide({interEyePixels: 23.99}).reason, 'insufficient-evidence');
  assert.equal(decide({interEyePixels: 24}).status, 'pass');
  assert.equal(decide({}).policyVersion, FACE_PIXEL_POLICY.version);
  // Landmark handling follows the explicit flag, not the version string.
  assert.equal(decideFaceQuality(evidence({landmarkShift: null}), {...IOS_FACE_POLICY, version: 'custom'}).reason, 'insufficient-evidence');
  assert.equal(decideFaceQuality(evidence({landmarkShift: null}), {...FACE_PIXEL_POLICY, version: 'custom'}).status, 'pass');
});

test('strict detail thresholds, required native evidence, and decision precedence match Swift', () => {
  for (const signal of [.2, 1]) assert.equal(decide({canonical: {sourceSignal: signal, retention: .3}}).status, 'pass');
  assert.equal(decide({canonical: {sourceSignal: 1.001, retention: .899}}).reason, 'correlated-detail-loss');
  assert.equal(decide({canonical: {sourceSignal: 2, retention: .90}}).status, 'pass');
  assert.equal(decide({cropPixels: 512}).status, 'pass');
  assert.equal(decide({cropPixels: 512.01}).reason, 'insufficient-evidence');
  const n = (sourceSignal, retention) => ({cropPixels: 900, native: {sourceSignal, retention}});
  assert.equal(decide(n(.7, .1)).status, 'pass');
  assert.equal(decide(n(.701, .649)).reason, 'native-detail-loss');
  assert.equal(decide(n(2, .65)).status, 'pass');
  assert.equal(decide({...n(2, .4), canonical: {sourceSignal: 2, retention: .3}, structure: .1, interEyePixels: 12}).reason, 'native-detail-loss');
});

test('malformed, non-finite or missing measurements never approve a face', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined]) {
    assert.equal(decide({structure: value}).reason, 'measurement-unavailable');
    assert.equal(decide({canonical: {sourceSignal: 2, retention: value}}).reason, 'measurement-unavailable');
    assert.equal(decide({native: {sourceSignal: value, retention: 1}}).reason, 'measurement-unavailable');
  }
  for (const value of [0, -1]) assert.equal(decide({cropPixels: value}).reason, 'measurement-unavailable');
  assert.equal(decideFaceQuality(null).status, 'review');
  assert.throws(() => measureFaceQuality(new Float32Array(1), new Float32Array(1), 512, 512));
  const a = new Float32Array(64 * 64); a[0] = NaN;
  assert.throws(() => measureFaceQuality(a, a, 64, 64));
});

test('unchanged texture passes; smoothing with added noise still loses correlated detail', () => {
  const before = new Float32Array(512 * 512), blurred = before.slice(), noisy = before.slice();
  let seed = 42;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const p = y * 512 + x, base = 128 + 30 * Math.sin(x * .12);
    before[p] = base + 25 * Math.sin(x * .8) + 20 * Math.sin(y * .9);
    blurred[p] = base + 25 * Math.exp(-.5 * (1.8 * .8) ** 2) * Math.sin(x * .8) + 20 * Math.exp(-.5 * (1.8 * .9) ** 2) * Math.sin(y * .9);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noisy[p] = blurred[p] + seed / 0xffffffff * 24 - 12;
  }
  const unchanged = measureFaceQuality(before, before, 512, 512);
  assert.ok(Math.abs(unchanged.detail.retention - 1) < .001);
  assert.ok(Math.abs(unchanged.structure - 1) < .001);
  for (const after of [blurred, noisy]) {
    const m = measureFaceQuality(before, after, 512, 512);
    assert.equal(decide({canonical: m.detail, structure: m.structure}).reason, 'correlated-detail-loss');
  }
});

test('luma stays gamma encoded and bicubic follows half-pixel sampling', () => {
  assert.ok(Math.abs(faceLuma(new Uint8Array([255, 0, 0, 255]))[0] - 54.213) < .001);
  assert.deepEqual([...resizeFaceLuma2x(new Float32Array([10]), 1, 1)], [10, 10, 10, 10]);
  assert.deepEqual([...resizeFaceLuma2x(new Float32Array([0, 16]), 2, 1)].slice(0, 4), [-1.6875, 3.625, 12.375, 17.6875]);
});
