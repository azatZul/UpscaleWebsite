// The photo a cloud mode uploads, sized the way the iOS app sizes it
// (ServerProcessInProgressViewModel.prepareRequestImage):
//   Restore and the colorize modes: under 1 MP, sides divisible by 16, at
//   least 512 px on the short side, centre-cropped to that shape.
//   Increased resolution and Advanced Fix: longest side capped at 4032.
//   Creative upscale: the original, capped at 4096 until the web tiles as the
//   app does.

export const FLUX_MAX_PIXELS = 1024 * 1024;
export const FLUX_MIN_SIDE = 512;
export const FLUX_STEP = 16;
export const RESTORE_MAX_SIDE = 4032;
export const CREATIVE_MAX_SIDE = 4096;

function fitWithin(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), crop: false};
}

export function uploadPlan(width, height, mode, options = {}) {
  if (mode === 'creative') return fitWithin(width, height, CREATIVE_MAX_SIDE);
  if (options.increaseResolution || options.mode === 'advanced_restoration') return fitWithin(width, height, RESTORE_MAX_SIDE);
  let scale = Math.sqrt(FLUX_MAX_PIXELS / (width * height));
  // The short side may not drop under 512; a very long panorama keeps that
  // floor even though it then exceeds a megapixel, as the app's does.
  scale = Math.max(scale, FLUX_MIN_SIDE / Math.min(width, height));
  const snap = value => Math.max(FLUX_STEP, Math.floor(value / FLUX_STEP) * FLUX_STEP);
  return {width: snap(width * scale), height: snap(height * scale), crop: true};
}

/** Draw the photo at its planned size as a JPEG. Negative inverts it first, as
 *  the app does before a negative restoration. */
export async function prepareUpload(file, plan, {negative = false} = {}) {
  const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
  try {
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(plan.width, plan.height)
      : Object.assign(document.createElement('canvas'), {width: plan.width, height: plan.height});
    const context = canvas.getContext('2d');
    const scale = plan.crop
      ? Math.max(plan.width / bitmap.width, plan.height / bitmap.height)
      : Math.min(plan.width / bitmap.width, plan.height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, plan.width, plan.height);
    context.drawImage(bitmap, (plan.width - drawWidth) / 2, (plan.height - drawHeight) / 2, drawWidth, drawHeight);
    if (negative) {
      context.globalCompositeOperation = 'difference';
      context.fillStyle = '#fff';
      context.fillRect(0, 0, plan.width, plan.height);
      context.globalCompositeOperation = 'source-over';
    }
    if (canvas.convertToBlob) return await canvas.convertToBlob({type: 'image/jpeg', quality: 0.92});
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('encode')), 'image/jpeg', 0.92));
  } finally {
    bitmap.close?.();
  }
}
