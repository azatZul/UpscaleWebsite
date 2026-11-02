import {assessPhoto, assessPng, PhotoError, TILE_SIZE} from './capability.js';

export const PNG = 'image/png';
export const JPEG = 'image/jpeg';
export const exportOptions = mime => mime === PNG ? {type: PNG} : {type: JPEG, quality: .96};
export const exportExtension = mime => mime === PNG ? 'png' : 'jpg';

// Admission needs only a boolean. Stop at the first transparent pixel; maxAlpha
// belongs to the later complete read, never to this partial classification.
export async function hasTransparency(bitmap, {onProgress = () => {}} = {}) {
  const {width, height} = bitmap;
  const canvas = new OffscreenCanvas(width, Math.min(256, height));
  try {
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new PhotoError('browser', 'err_surface');
    for (let y = 0; y < height; y += 256) {
      const rows = Math.min(256, height - y);
      context.clearRect(0, 0, width, canvas.height);
      context.drawImage(bitmap, 0, y, width, rows, 0, 0, width, rows);
      const data = context.getImageData(0, 0, width, rows).data;
      for (let p = 3; p < data.length; p += 4) if (data[p] < 255) return true;
      onProgress(y + rows, height);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return false;
  } finally { canvas.width = canvas.height = 1; }
}

export function pngFailureDetails(error, info, policy, scale) {
  const details = {code: error.code || 'runtime', key: error.key || 'err_finish', params: error.params};
  if (!['err_png_size', 'err_png_export'].includes(details.key) || scale !== 4 || !info) return details;
  try { assessPng(assessPhoto(info, policy, 2), policy, {size: info.size}); }
  catch { return details; }
  return {...details, key: `${details.key}_2x`, fallbackScale: 2};
}

// Scan in source coordinates. Canvas may round RGB at small alpha; do not
// repeatedly send these pixels through another transparent canvas per tile.
export async function readTransparency(bitmap, {retainRgb = true, onProgress = () => {}} = {}) {
  const {width, height} = bitmap;
  const rgb = retainRgb ? new Uint8Array(width * height * 3) : null;
  const alpha = retainRgb ? new Uint8Array(width * height) : null;
  const canvas = new OffscreenCanvas(width, Math.min(256, height));
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw new PhotoError('browser', 'err_surface');
  let hasTransparency = false, maxAlpha = 0;
  try {
    for (let y = 0; y < height; y += 256) {
      const rows = Math.min(256, height - y);
      context.clearRect(0, 0, width, canvas.height);
      context.drawImage(bitmap, 0, y, width, rows, 0, 0, width, rows);
      const data = context.getImageData(0, 0, width, rows).data;
      for (let i = 0; i < width * rows; i++) {
        const a = data[i * 4 + 3], p = y * width + i;
        hasTransparency ||= a !== 255;
        maxAlpha = Math.max(maxAlpha, a);
        if (alpha) {
          alpha[p] = a;
          rgb[p * 3] = data[i * 4]; rgb[p * 3 + 1] = data[i * 4 + 1]; rgb[p * 3 + 2] = data[i * 4 + 2];
        }
      }
      onProgress(y + rows, height);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { canvas.width = canvas.height = 1; }
  return {width, height, hasTransparency, maxAlpha,
    rgb: hasTransparency ? rgb : null, alpha: hasTransparency ? alpha : null};
}

// The distance field and donor colours cover the whole source, not individual
// tiles. Only invisible RGB is changed. Visible low-alpha details remain intact.
export function fillTransparentRgb(rgb, alpha, width, height) {
  const count = width * height;
  if (rgb.length !== count * 3 || alpha.length !== count || width < 1 || height < 1 || width + height - 2 >= 65535) {
    throw new PhotoError('size', 'err_too_large');
  }
  let maxAlpha = 0;
  for (const a of alpha) maxAlpha = Math.max(maxAlpha, a);
  if (!maxAlpha) { rgb.fill(0); return false; }
  const threshold = Math.min(128, maxAlpha);
  const distance = new Uint16Array(count);
  distance.fill(65535);
  // A temporary donor RGB field lets paths cross low-alpha pixels without
  // replacing those pixels' own colour. Include this scratch space in admission.
  const donors = new Uint8Array(rgb);
  for (let p = 0; p < count; p++) if (alpha[p] >= threshold) distance[p] = 0;
  const relax = (p, neighbour) => {
    const d = distance[neighbour];
    if (d !== 65535 && d + 1 < distance[p]) {
      distance[p] = d + 1;
      donors[p * 3] = donors[neighbour * 3];
      donors[p * 3 + 1] = donors[neighbour * 3 + 1];
      donors[p * 3 + 2] = donors[neighbour * 3 + 2];
    }
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    if (x) relax(p, p - 1);
    if (y) relax(p, p - width);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const p = y * width + x;
    if (x + 1 < width) relax(p, p + 1);
    if (y + 1 < height) relax(p, p + width);
  }
  for (let p = 0; p < count; p++) if (!alpha[p]) {
    rgb[p * 3] = donors[p * 3]; rgb[p * 3 + 1] = donors[p * 3 + 1]; rgb[p * 3 + 2] = donors[p * 3 + 2];
  }
  return true;
}

// Used only for small face/detector surfaces. Padding outside the actual
// detector image is intentionally excluded and keeps its original black RGB.
export function fillTransparentSurface(context, width, height) {
  const image = context.getImageData(0, 0, width, height);
  const rgb = new Uint8Array(width * height * 3), alpha = new Uint8Array(width * height);
  let hasTransparency = false;
  for (let p = 0; p < alpha.length; p++) {
    alpha[p] = image.data[p * 4 + 3]; hasTransparency ||= alpha[p] < 255;
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = image.data[p * 4 + c];
  }
  const visible = hasTransparency ? fillTransparentRgb(rgb, alpha, width, height) : true;
  for (let p = 0; p < alpha.length; p++) {
    for (let c = 0; c < 3; c++) image.data[p * 4 + c] = rgb[p * 3 + c];
    image.data[p * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return visible;
}

export function sampleRgbTile({rgb, width, height}, x, y) {
  const plane = TILE_SIZE * TILE_SIZE, values = new Float32Array(plane * 3);
  for (let ty = 0; ty < TILE_SIZE; ty++) for (let tx = 0; tx < TILE_SIZE; tx++) {
    const p = (Math.min(height - 1, y + ty) * width + Math.min(width - 1, x + tx)) * 3;
    const i = ty * TILE_SIZE + tx;
    for (let c = 0; c < 3; c++) values[c * plane + i] = rgb[p + c] / 255;
  }
  return values;
}

export function alphaAt(alpha, width, height, x, y, scale) {
  const sx = Math.max(0, Math.min(width - 1, (x + .5) / scale - .5));
  const sy = Math.max(0, Math.min(height - 1, (y + .5) / scale - .5));
  const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  return Math.round((alpha[y0 * width + x0] * (1 - fx) + alpha[y0 * width + x1] * fx) * (1 - fy) +
    (alpha[y1 * width + x0] * (1 - fx) + alpha[y1 * width + x1] * fx) * fy);
}

export function applyBandAlpha(data, source, bandY, bandHeight, scale) {
  const outputWidth = source.width * scale;
  for (let y = 0; y < bandHeight; y++) for (let x = 0; x < outputWidth; x++) {
    data[(y * outputWidth + x) * 4 + 3] = alphaAt(source.alpha, source.width, source.height, x, bandY + y, scale);
  }
}

export function emptyTile(source, x, y) {
  // Check the complete 256px tile plus bilinear support, a conservative superset
  // of its contribution and both blending seams.
  const left = Math.max(0, x - 1), top = Math.max(0, y - 1);
  const right = Math.min(source.width, x + TILE_SIZE + 1), bottom = Math.min(source.height, y + TILE_SIZE + 1);
  for (let row = top; row < bottom; row++) for (let column = left; column < right; column++) {
    if (source.alpha[row * source.width + column]) return false;
  }
  return true;
}
