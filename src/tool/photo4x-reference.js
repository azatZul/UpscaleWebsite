// A timing probe proves a GPU is fast, not that its FP16 arithmetic is right.
// The warm-up therefore runs one fixed synthetic tile and compares coarse block
// means with the FP32 graph's CPU output. This catches broken drivers (black,
// saturated, channel-swapped or garbage tiles), not subtle texture changes.
export const PHOTO4X_REFERENCE_GRID = 32;
export const PHOTO4X_REFERENCE_LIMITS = Object.freeze({meanError: 2, maxError: 12});

function hash(x, y, c) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(c, 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return (h ^ (h >>> 16)) >>> 0;
}

// Integer-only RGB so the identical input can be dumped for the Python reference:
// gradients, hard stripe edges, a disc and pixel noise give InstanceNorm and the
// convolutions photo-like statistics.
export function photo4xReferenceBytes(tileSize = 256) {
  const bytes = new Uint8Array(tileSize * tileSize * 3), last = tileSize - 1;
  for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
    const diagonal = Math.floor((x + y) * 255 / (2 * last));
    const stripe = ((x >> 4) ^ (y >> 3)) & 1 ? 40 : 0;
    const disc = (x - (tileSize >> 1)) ** 2 + (y - (tileSize >> 2) - 32) ** 2 < (tileSize >> 2) ** 2;
    for (let c = 0; c < 3; c++) {
      const tint = disc ? [60, 0, -30][c] : 0;
      const value = ((diagonal * (3 + c)) >> 2) + stripe + tint + (hash(x, y, c) % 21) - 10;
      bytes[(y * tileSize + x) * 3 + c] = Math.max(0, Math.min(255, value));
    }
  }
  return bytes;
}

export function photo4xReferenceInput(tileSize = 256) {
  const bytes = photo4xReferenceBytes(tileSize), plane = tileSize * tileSize, values = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) values[c * plane + i] = bytes[i * 3 + c] / 255;
  return values;
}

// RGBA output → rounded per-block RGB means, row-major, grid × grid × 3 bytes.
export function photo4xReferenceStats(pixels, outputSide, grid = PHOTO4X_REFERENCE_GRID) {
  if (!Number.isSafeInteger(outputSide) || outputSide % grid || pixels.length !== outputSide ** 2 * 4) throw new Error('Invalid reference output');
  const block = outputSide / grid, sums = new Float64Array(grid * grid * 3);
  for (let y = 0; y < outputSide; y++) for (let x = 0; x < outputSide; x++) {
    const target = (Math.floor(y / block) * grid + Math.floor(x / block)) * 3, source = (y * outputSide + x) * 4;
    for (let c = 0; c < 3; c++) sums[target + c] += pixels[source + c];
  }
  return Uint8Array.from(sums, sum => Math.round(sum / block ** 2));
}

export function decodeReferenceStats(base64) {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

export function compareReferenceStats(actual, expected, limits = PHOTO4X_REFERENCE_LIMITS) {
  if (!expected?.length || actual.length !== expected.length) return {passed: false, meanError: Infinity, maxError: Infinity};
  let total = 0, maxError = 0;
  for (let i = 0; i < actual.length; i++) {
    const error = Math.abs(actual[i] - expected[i]);
    total += error; maxError = Math.max(maxError, error);
  }
  const meanError = total / actual.length;
  return {passed: meanError <= limits.meanError && maxError <= limits.maxError, meanError, maxError};
}
