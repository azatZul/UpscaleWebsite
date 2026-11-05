import {TILE_SIZE, SCALE, PhotoError} from './capability.js';
import {tileGeometry} from './tile-geometry.js';

export function makeCanvas(width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw new PhotoError('browser', 'err_surface');
  return {canvas, context};
}

export function sampleTile(bitmap, x = 0, y = 0, tileSize = TILE_SIZE) {
  const width = Math.min(tileSize, bitmap.width - x);
  const height = Math.min(tileSize, bitmap.height - y);
  const {canvas, context} = makeCanvas(width, height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const plane = tileSize * tileSize;
  const values = new Float32Array(plane * 3);
  for (let ty = 0; ty < tileSize; ty++) {
    for (let tx = 0; tx < tileSize; tx++) {
      const source = (Math.min(ty, height - 1) * width + Math.min(tx, width - 1)) * 4;
      const target = ty * tileSize + tx;
      values[target] = pixels[source] / 255;
      values[plane + target] = pixels[source + 1] / 255;
      values[plane * 2 + target] = pixels[source + 2] / 255;
    }
  }
  canvas.width = canvas.height = 1;
  return values;
}

// outputSide is the model's actual output width/height for one tile: for the
// upscaler that is TILE_SIZE * scale, for the fixed-size face model it is 512
// regardless of the photo's overall scale.
// A factor of 2 averages each 2×2 block of the clipped model output before
// rounding: Photo 2× with the 4× model, exactly 4× followed by a box downscale.
export function tensorPixels(values, outputSide = TILE_SIZE * SCALE, factor = 1) {
  if (factor !== 1) return downscaledPixels(values, outputSide, factor);
  const plane = outputSide ** 2;
  if (values.length !== plane * 3) throw new PhotoError('runtime', 'err_output_size');
  const pixels = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      const value = values[c * plane + i];
      if (!Number.isFinite(value)) throw new PhotoError('runtime', 'err_invalid_output');
      pixels[i * 4 + c] = Math.round(Math.max(0, Math.min(1, value)) * 255);
    }
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function downscaledPixels(values, outputSide, factor) {
  const side = outputSide * factor, plane = side ** 2, area = factor * factor;
  if (!Number.isInteger(factor) || factor < 1 || values.length !== plane * 3) throw new PhotoError('runtime', 'err_output_size');
  const pixels = new Uint8ClampedArray(outputSide ** 2 * 4);
  for (let y = 0; y < outputSide; y++) for (let x = 0; x < outputSide; x++) {
    const target = (y * outputSide + x) * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
        const value = values[c * plane + (y * factor + dy) * side + x * factor + dx];
        if (!Number.isFinite(value)) throw new PhotoError('runtime', 'err_invalid_output');
        sum += Math.max(0, Math.min(1, value));
      }
      pixels[target + c] = Math.round(sum / area * 255);
    }
    pixels[target + 3] = 255;
  }
  return pixels;
}

function blend(a, b, weight) { return Math.round(a * (1 - weight) + b * weight); }

// Same horizontal-then-vertical overlap and rounding as the lab tiler, with
// at most two row bands in JS memory instead of a complete output ImageData.
export async function assembleTiles(width, height, runTile, writeBand, onProgress = () => {}, scale = SCALE, geometry) {
  const {tileSize, overlap, stride} = tileGeometry(geometry);
  const outputWidth = width * scale;
  const columns = Math.ceil(width / stride);
  const rows = Math.ceil(height / stride);
  const seam = overlap * scale * 2;
  let previous;
  let completed = 0;
  for (let row = 0; row < rows; row++) {
    const coreY = row * stride;
    const tileY = coreY - (row ? overlap : 0);
    const rowTo = Math.min(coreY + stride + overlap, height);
    const bandHeight = (rowTo - tileY) * scale;
    const band = new Uint8ClampedArray(outputWidth * bandHeight * 4);
    for (let column = 0; column < columns; column++) {
      const coreX = column * stride;
      const tileX = coreX - (column ? overlap : 0);
      const columnTo = Math.min(coreX + stride + overlap, width);
      const regionWidth = (columnTo - tileX) * scale;
      const pixels = await runTile(tileX, tileY);
      for (let y = 0; y < bandHeight; y++) {
        for (let x = 0; x < regionWidth; x++) {
          const source = (y * tileSize * scale + x) * 4;
          const target = (y * outputWidth + tileX * scale + x) * 4;
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
      const previousStart = (tileY * scale - previous.y) * outputWidth * 4;
      for (let y = 0; y < overlapRows; y++) {
        const weight = (y + .5) / seam;
        for (let x = 0; x < outputWidth; x++) {
          const i = (y * outputWidth + x) * 4;
          for (let c = 0; c < 3; c++) band[i + c] = blend(previous.data[previousStart + i + c], band[i + c], weight);
        }
      }
    }
    await writeBand(band, outputWidth, bandHeight, tileY * scale);
    previous = {data: band, y: tileY * scale};
  }
}

export async function thumbnail(bitmap, hasTransparency = false) {
  const ratio = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const {canvas, context} = makeCanvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)));
  if (!hasTransparency) {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  try { return await canvas.convertToBlob(hasTransparency ? {type: 'image/png'} : {type: 'image/jpeg', quality: .85}); }
  finally { canvas.width = canvas.height = 1; }
}
