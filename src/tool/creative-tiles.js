// Splitting a big photo for creative upscale, and putting it back together.
//
// The same geometry as the iOS app's CreativeTiler, so a photo comes back the
// same shape whichever surface ran it: a 2x2 grid above 2160 square, two tiles
// above 1280 square, one tile below that, with a 32px overlap the seams are
// blended across. Each tile is upscaled on its own, so three or four of them
// already make a very large photo -- that is why 8K drops to 4K past two.

export const TILE_OVERLAP = 32;
export const TWO_TILE_PIXELS = 1280 * 1280;
export const FOUR_TILE_PIXELS = 2160 * 2160;
export const MAX_TILES = 4;

export function tileGrid(width, height) {
  const area = width * height;
  if (area > FOUR_TILE_PIXELS) return {x: 2, y: 2};
  if (area > TWO_TILE_PIXELS) return width >= height ? {x: 2, y: 1} : {x: 1, y: 2};
  return {x: 1, y: 1};
}

// Two parts that meet in the middle and each reach half the overlap past it.
function axisParts(length, parts, overlap) {
  if (parts <= 1) return [{origin: 0, length}];
  const middle = length / 2;
  const half = overlap / 2;
  const firstEnd = Math.min(length, middle + half);
  const secondStart = Math.max(0, middle - half);
  return [{origin: 0, length: firstEnd}, {origin: secondStart, length: length - secondStart}];
}

export function tileRects(width, height, grid = tileGrid(width, height), overlap = TILE_OVERLAP) {
  const columns = axisParts(width, grid.x, overlap);
  const rows = axisParts(height, grid.y, overlap);
  const rects = [];
  for (const row of rows) {
    for (const column of columns) {
      // Round the edges rather than the origin and the length separately, so an
      // odd-sized photo cannot end up with a tile a pixel past its edge.
      const left = Math.round(column.origin);
      const top = Math.round(row.origin);
      rects.push({
        x: left, y: top,
        width: Math.round(column.origin + column.length) - left,
        height: Math.round(row.origin + row.length) - top,
      });
    }
  }
  return rects;
}

/** The resolution to ask the provider for, per tile. */
export function tiledResolution(resolution, tileCount) {
  return tileCount > 2 && resolution === '8k' ? '4k' : resolution;
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), {width, height});
}

async function toJpeg(canvas, quality) {
  if (canvas.convertToBlob) return await canvas.convertToBlob({type: 'image/jpeg', quality});
  return await new Promise((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('encode')), 'image/jpeg', quality));
}

/** Cut the prepared photo into its tiles, in reading order. */
export async function splitPhoto(blob, rects) {
  const bitmap = await createImageBitmap(blob);
  try {
    const tiles = [];
    for (const rect of rects) {
      const canvas = makeCanvas(rect.width, rect.height);
      canvas.getContext('2d').drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      tiles.push(await toJpeg(canvas, 0.92));
    }
    return tiles;
  } finally {
    bitmap.close?.();
  }
}

/** Put the upscaled tiles back into one photo.
 *
 *  Each tile is drawn at the scale the provider returned it at, and the edges
 *  that meet a tile already drawn fade in across the overlap, so neither a hard
 *  seam nor a doubled strip survives. */
export async function mergeTiles(blobs, rects, size, grid, quality = 0.92) {
  if (blobs.length !== rects.length) throw new Error('tile count mismatch');
  const bitmaps = await Promise.all(blobs.map(blob => createImageBitmap(blob)));
  try {
    const scaleX = bitmaps[0].width / rects[0].width;
    const scaleY = bitmaps[0].height / rects[0].height;
    const canvas = makeCanvas(Math.round(size.width * scaleX), Math.round(size.height * scaleY));
    const context = canvas.getContext('2d');
    const fadeX = Math.max(1, Math.round(TILE_OVERLAP * scaleX));
    const fadeY = Math.max(1, Math.round(TILE_OVERLAP * scaleY));
    for (const [index, bitmap] of bitmaps.entries()) {
      const rect = rects[index];
      const column = index % grid.x;
      const row = Math.floor(index / grid.x);
      const width = Math.round(rect.width * scaleX);
      const height = Math.round(rect.height * scaleY);
      const tile = makeCanvas(width, height);
      const tileContext = tile.getContext('2d');
      tileContext.drawImage(bitmap, 0, 0, width, height);
      // Fade only the edges that overlap something already on the canvas: the
      // left edge for a second column, the top edge for a second row.
      tileContext.globalCompositeOperation = 'destination-in';
      for (const [needed, horizontal, fade] of [[column > 0, true, fadeX], [row > 0, false, fadeY]]) {
        if (!needed) continue;
        const gradient = horizontal
          ? tileContext.createLinearGradient(0, 0, fade, 0)
          : tileContext.createLinearGradient(0, 0, 0, fade);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,1)');
        tileContext.fillStyle = gradient;
        tileContext.fillRect(0, 0, width, height);
      }
      tileContext.globalCompositeOperation = 'source-over';
      context.drawImage(tile, Math.round(rect.x * scaleX), Math.round(rect.y * scaleY));
    }
    return await toJpeg(canvas, quality);
  } finally {
    for (const bitmap of bitmaps) bitmap.close?.();
  }
}
