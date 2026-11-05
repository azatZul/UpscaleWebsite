export function tileGeometry({tileSize = 256, overlap = 16} = {}) {
  if (!Number.isSafeInteger(tileSize) || tileSize < 2 || !Number.isSafeInteger(overlap) || overlap < 1 || overlap * 2 >= tileSize) {
    throw new Error('Invalid tile geometry');
  }
  return {tileSize, overlap, stride: tileSize - overlap * 2};
}
