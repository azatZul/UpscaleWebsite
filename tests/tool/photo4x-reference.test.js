import test from 'node:test';
import assert from 'node:assert/strict';
import {compareReferenceStats, decodeReferenceStats, photo4xReferenceBytes, photo4xReferenceInput, photo4xReferenceStats,
  PHOTO4X_REFERENCE_GRID} from '../../src/tool/photo4x-reference.js';
import {PHOTO4X_REFERENCE} from '../../src/tool/photo4x-reference.generated.js';
import {PHOTO4X_RELEASE} from '../../src/tool/photo4x-release.js';
import {createHash} from 'node:crypto';

test('reference input is deterministic, photo-like and matches the generated reference', () => {
  const bytes = photo4xReferenceBytes(256);
  // Pinned: changing the generator requires regenerating the reference.
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '60d3e9a1173a6f0703281a24a5c6328f7aa2b29779d840df73ca82d0a48c544f');
  assert.ok(new Set(bytes).size > 200);
  const input = photo4xReferenceInput(256), plane = 256 * 256;
  assert.equal(input.length, plane * 3);
  assert.equal(input[plane + 5], Math.fround(bytes[5 * 3 + 1] / 255));
  assert.equal(PHOTO4X_REFERENCE.revision, PHOTO4X_RELEASE.winner.revision);
  assert.equal(PHOTO4X_REFERENCE.grid, PHOTO4X_REFERENCE_GRID);
  assert.equal(decodeReferenceStats(PHOTO4X_REFERENCE.stats).length, PHOTO4X_REFERENCE_GRID ** 2 * 3);
});

function output(side, pixel) {
  const pixels = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) pixels.set([...pixel(x, y), 255], (y * side + x) * 4);
  return pixels;
}

test('block means average each channel per grid cell', () => {
  const stats = photo4xReferenceStats(output(64, (x, y) => [x < 32 ? 10 : 200, y < 32 ? 0 : 100, (x + y) % 2 ? 0 : 255]), 64, 2);
  assert.deepEqual([...stats], [10, 0, 128, 200, 0, 128, 10, 100, 128, 200, 100, 128]);
  assert.throws(() => photo4xReferenceStats(new Uint8ClampedArray(10), 64, 2));
  assert.throws(() => photo4xReferenceStats(output(60, () => [0, 0, 0]), 60, 32));
});

test('small FP16 drift passes while black, grey, swapped or truncated output fails', () => {
  const expected = decodeReferenceStats(PHOTO4X_REFERENCE.stats);
  const drift = expected.map((v, i) => Math.max(0, Math.min(255, v + (i % 3) - 1)));
  assert.equal(compareReferenceStats(drift, expected).passed, true);
  assert.equal(compareReferenceStats(expected, expected).maxError, 0);
  const swapped = expected.map((_, i) => expected[i - (i % 3) + 2 - (i % 3)]);
  for (const bad of [new Uint8Array(expected.length), new Uint8Array(expected.length).fill(128), swapped, expected.slice(1)]) {
    assert.equal(compareReferenceStats(bad, expected).passed, false);
  }
  const oneBadBlock = expected.slice(); oneBadBlock[7] = (oneBadBlock[7] + 128) % 256;
  assert.equal(compareReferenceStats(oneBadBlock, expected).passed, false);
  assert.equal(compareReferenceStats(expected, undefined).passed, false);
});
