import test from 'node:test';
import assert from 'node:assert/strict';
import {fillTransparentRgb, sampleRgbTile, alphaAt, applyBandAlpha, emptyTile, exportExtension, hasTransparency, pngFailureDetails, readTransparency, PNG} from '../../src/tool/transparency.js';
import {assessPhoto, assessPng, devicePolicy, faceEditFits} from '../../src/tool/capability.js';

test('classification stops early, reads the last band when needed and allocates only stripes', async t => {
  let transparentAt = -1;
  const reads = [], canvases = [];
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
  const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  t.after(() => {
    if (originalCanvas) Object.defineProperty(globalThis, 'OffscreenCanvas', originalCanvas);
    else delete globalThis.OffscreenCanvas;
  });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; canvases.push(this); }
    getContext() {
      let row;
      return {clearRect() {}, drawImage(bitmap, x, y) { row = y; }, getImageData(x, y, width, rows) {
        reads.push({row, rows});
        const data = new Uint8ClampedArray(width * rows * 4).fill(255);
        if (transparentAt >= row && transparentAt < row + rows) data[(transparentAt - row) * width * 4 + 3] = 0;
        return {data};
      }};
    }
  };
  const bitmap = {width: 3, height: 600};
  assert.equal(await hasTransparency(bitmap), false);
  assert.deepEqual(reads.map(r => r.rows), [256, 256, 88]);
  transparentAt = 0; reads.length = 0;
  assert.equal(await hasTransparency(bitmap), true);
  assert.equal(reads.length, 1);
  transparentAt = 599; reads.length = 0;
  assert.equal(await hasTransparency(bitmap), true);
  assert.equal(reads.length, 3);
  const full = await readTransparency(bitmap);
  assert.equal(full.maxAlpha, 255);
  assert.equal(full.alpha.length, 1800);
  assert.equal(full.rgb.length, 5400);
  assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('PNG recovery offers 2x only when both photo and PNG admission pass', () => {
  const policy = devicePolicy();
  for (const key of ['err_png_size', 'err_png_export']) {
    const error = {code: key === 'err_png_size' ? 'size' : 'export', key};
    const info = {width: 800, height: 600, size: 4000};
    assert.deepEqual(pngFailureDetails(error, info, policy, 4), {...error, params: undefined, key: `${key}_2x`, fallbackScale: 2});
    assert.equal(pngFailureDetails(error, info, policy, 2).fallbackScale, undefined);
    assert.equal(pngFailureDetails(error, info, {...policy, maxInputPixels: 1}, 4).fallbackScale, undefined);
    assert.equal(pngFailureDetails(error, info, {...policy, maxPngOutputPixels: 1}, 4).fallbackScale, undefined);
  }
  assert.equal(pngFailureDetails({code: 'download', key: 'err_download'}, {width: 2, height: 2}, policy, 4).fallbackScale, undefined);
});

test('global nearest donors cross tile boundaries and preserve all visible colours', () => {
  const width = 450, alpha = new Uint8Array(width), rgb = new Uint8Array(width * 3);
  alpha[0] = 255; rgb.set([240, 12, 80]);
  alpha[300] = 64; rgb.set([20, 180, 90], 900);
  fillTransparentRgb(rgb, alpha, width, 1);
  assert.deepEqual([...rgb.slice(224 * 3, 224 * 3 + 3)], [240, 12, 80]);
  assert.deepEqual([...rgb.slice(300 * 3, 300 * 3 + 3)], [20, 180, 90]);
  const source = {rgb, alpha, width, height: 1};
  const a = sampleRgbTile(source, 0, 0), b = sampleRgbTile(source, 208, 0);
  for (let x = 208; x < 256; x++) for (let c = 0; c < 3; c++) {
    assert.equal(a[c * 65536 + x], b[c * 65536 + x - 208]);
  }
});

test('distance transform agrees with brute-force distances, including donors across weak alpha', () => {
  const width = 11, height = 9, alpha = new Uint8Array(width * height), rgb = new Uint8Array(alpha.length * 3);
  const seeds = [2, 31, 85];
  for (const p of seeds) { alpha[p] = 255; rgb.set([p, 40, 120], p * 3); }
  alpha[50] = 1; rgb.set([9, 7, 3], 150);
  fillTransparentRgb(rgb, alpha, width, height);
  for (let p = 0; p < alpha.length; p++) if (!alpha[p]) {
    const dist = q => Math.abs(p % width - q % width) + Math.abs(Math.floor(p / width) - Math.floor(q / width));
    assert.equal(dist(rgb[p * 3]), Math.min(...seeds.map(dist)));
  }
  assert.deepEqual([...rgb.slice(150, 153)], [9, 7, 3]);
});

test('a wholly faint object supplies its strongest colour; empty images need no donor', () => {
  const rgb = new Uint8Array([0, 0, 0, 60, 80, 100, 2, 4, 6]);
  fillTransparentRgb(rgb, new Uint8Array([0, 12, 3]), 3, 1);
  assert.deepEqual([...rgb], [60, 80, 100, 60, 80, 100, 2, 4, 6]);
  const empty = new Uint8Array([4, 5, 6]);
  assert.equal(fillTransparentRgb(empty, new Uint8Array(1), 1, 1), false);
  assert.deepEqual([...empty], [0, 0, 0]);
  assert.throws(() => fillTransparentRgb(new Uint8Array(3), new Uint8Array(1), 65536, 1));
});

test('bilinear alpha uses global pixel centres without band seams or thresholding', () => {
  const source = {width: 3, height: 2, alpha: new Uint8Array([0, 254, 255, 10, 40, 180])};
  for (const scale of [2, 4]) {
    const width = source.width * scale, height = source.height * scale;
    const full = new Uint8ClampedArray(width * height * 4).fill(66);
    applyBandAlpha(full, source, 0, height, scale);
    for (let y = 0; y < height; y++) {
      const band = new Uint8ClampedArray(width * 4).fill(66);
      applyBandAlpha(band, source, y, 1, scale);
      assert.deepEqual(band, full.slice(y * width * 4, (y + 1) * width * 4));
    }
    assert.equal(full[0], 66);
    assert.equal(full[3], 0);
    assert.equal(alphaAt(new Uint8Array([254]), 1, 1, 3, 3, scale), 254);
  }
});

test('empty tile shortcut includes overlap and bilinear support', () => {
  const source = {width: 600, height: 2, alpha: new Uint8Array(1200)};
  source.alpha[256] = 1;
  assert.equal(emptyTile(source, 0, 0), false);
  assert.equal(emptyTile(source, 400, 0), true);
});

test('PNG admission counts enlarged encoder surfaces and face-base memory', () => {
  const policy = devicePolicy({userAgent: 'iPhone'});
  const small = assessPhoto({width: 512, height: 512}, policy);
  assert.ok(assessPng(small, policy).estimatedPeakBytes > 0);
  const big = assessPhoto({width: 4000, height: 4000}, policy);
  // An existing JPEG admission is not evidence for PNG at the same size.
  assert.throws(() => assessPng(big, policy), {key: 'err_png_size'});
  const p = {outputWidth: 7000, outputHeight: 7000};
  assert.ok(faceEditFits(p, policy));
  assert.equal(faceEditFits(p, policy, {mime: PNG, baseBytes: 200_000_000}), false);
  assert.equal(exportExtension(PNG), 'png');
  const exercised = assessPhoto({width: 4096, height: 1728}, policy);
  assert.doesNotThrow(() => assessPng(exercised, policy, {size: 25_000_000}));
  assert.throws(() => assessPng(assessPhoto({width: 4096, height: 1729}, policy), policy), {key: 'err_png_size'});
  assert.throws(() => assessPng(assessPhoto({width: 4096, height: 3173}, policy), policy), {key: 'err_png_size'});
});
