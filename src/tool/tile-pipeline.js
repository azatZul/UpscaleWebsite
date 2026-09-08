import {TILE_SIZE, STRIDE, OVERLAP, SCALE, PhotoError} from './capability.js';

export function makeCanvas(width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw new PhotoError('browser', 'This browser couldn’t create an image surface. Try the app.');
  return {canvas, context};
}

export function sampleTile(bitmap, x = 0, y = 0) {
  const width = Math.min(TILE_SIZE, bitmap.width - x);
  const height = Math.min(TILE_SIZE, bitmap.height - y);
  const {canvas, context} = makeCanvas(width, height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const plane = TILE_SIZE * TILE_SIZE;
  const values = new Float32Array(plane * 3);
  for (let ty = 0; ty < TILE_SIZE; ty++) {
    for (let tx = 0; tx < TILE_SIZE; tx++) {
      const source = (Math.min(ty, height - 1) * width + Math.min(tx, width - 1)) * 4;
      const target = ty * TILE_SIZE + tx;
      values[target] = pixels[source] / 255;
      values[plane + target] = pixels[source + 1] / 255;
      values[plane * 2 + target] = pixels[source + 2] / 255;
    }
  }
  canvas.width = canvas.height = 1;
  return values;
}

export function tensorPixels(values) {
  const plane = (TILE_SIZE * SCALE) ** 2;
  if (values.length !== plane * 3) throw new PhotoError('runtime', 'The upscaler returned an unexpected image size.');
  const pixels = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      const value = values[c * plane + i];
      if (!Number.isFinite(value)) throw new PhotoError('runtime', 'The browser returned an invalid image.');
      pixels[i * 4 + c] = Math.round(Math.max(0, Math.min(1, value)) * 255);
    }
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function blend(a, b, weight) { return Math.round(a * (1 - weight) + b * weight); }

// Same horizontal-then-vertical overlap and rounding as the lab tiler, with
// at most two row bands in JS memory instead of a complete output ImageData.
export async function assembleTiles(width, height, runTile, writeBand, onProgress = () => {}) {
  const outputWidth = width * SCALE;
  const columns = Math.ceil(width / STRIDE);
  const rows = Math.ceil(height / STRIDE);
  const seam = OVERLAP * SCALE * 2;
  let previous;
  let completed = 0;
  for (let row = 0; row < rows; row++) {
    const coreY = row * STRIDE;
    const tileY = coreY - (row ? OVERLAP : 0);
    const rowTo = Math.min(coreY + STRIDE + OVERLAP, height);
    const bandHeight = (rowTo - tileY) * SCALE;
    const band = new Uint8ClampedArray(outputWidth * bandHeight * 4);
    for (let column = 0; column < columns; column++) {
      const coreX = column * STRIDE;
      const tileX = coreX - (column ? OVERLAP : 0);
      const columnTo = Math.min(coreX + STRIDE + OVERLAP, width);
      const regionWidth = (columnTo - tileX) * SCALE;
      const pixels = await runTile(tileX, tileY);
      for (let y = 0; y < bandHeight; y++) {
        for (let x = 0; x < regionWidth; x++) {
          const source = (y * TILE_SIZE * SCALE + x) * 4;
          const target = (y * outputWidth + tileX * SCALE + x) * 4;
          for (let c = 0; c < 3; c++) {
            band[target + c] = column && x < seam
              ? blend(band[target + c], pixels[source + c], (x + .5) / seam)
              : pixels[source + c];
          }
          band[target + 3] = 255;
        }
      }
      onProgress(++completed, columns * rows);
    }
    if (previous) {
      const overlapRows = Math.min(seam, bandHeight);
      const previousStart = (tileY * SCALE - previous.y) * outputWidth * 4;
      for (let y = 0; y < overlapRows; y++) {
        const weight = (y + .5) / seam;
        for (let x = 0; x < outputWidth; x++) {
          const i = (y * outputWidth + x) * 4;
          for (let c = 0; c < 3; c++) band[i + c] = blend(previous.data[previousStart + i + c], band[i + c], weight);
        }
      }
    }
    await writeBand(band, outputWidth, bandHeight, tileY * SCALE);
    previous = {data: band, y: tileY * SCALE};
  }
}

export async function thumbnail(bitmap) {
  const ratio = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const {canvas, context} = makeCanvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)));
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  try { return await canvas.convertToBlob({type: 'image/jpeg', quality: .85}); }
  finally { canvas.width = canvas.height = 1; }
}
