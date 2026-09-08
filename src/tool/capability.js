export const TILE_SIZE = 256;
export const OVERLAP = 16;
export const STRIDE = TILE_SIZE - OVERLAP * 2;
export const SCALE = 2;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export class PhotoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhotoError';
    this.code = code;
  }
}

export function isAppleMobile(env = {}) {
  return /iPhone|iPad|iPod/.test(env.userAgent || '') ||
    (/Mac/.test(env.platform || '') && env.maxTouchPoints > 1);
}

export function devicePolicy(env = {}) {
  const mobile = isAppleMobile(env) || /Android|Mobile/.test(env.userAgent || '');
  const lowMemory = Number.isFinite(env.deviceMemory) && env.deviceMemory <= 4;
  // Admission limits, not measurements of free RAM. Keep the first mobile
  // preview below large camera-photo sizes until end-to-end device testing.
  return {
    maxInputPixels: lowMemory ? 4_000_000 : mobile ? 8_000_000 : 20_000_000,
    maxOutputSide: mobile ? 8192 : 16384,
    memoryBudgetBytes: (lowMemory ? 256 : mobile ? 384 : 1024) * 1024 * 1024,
    mobile,
  };
}

export function assessPhoto({width, height, size = 0}, policy = devicePolicy()) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new PhotoError('format', 'We couldn’t read this photo. Try a JPEG, PNG or WebP image.');
  }
  if (size > MAX_FILE_BYTES) throw new PhotoError('size', 'This file exceeds the browser preview’s 50 MB limit. Try it in the app.');
  const pixels = width * height;
  const outputWidth = width * SCALE;
  const outputHeight = height * SCALE;
  // Allow for decoder/bitmap, destination canvas, export scratch space, the
  // inference engine, and two row bands. This is deliberately an estimate.
  const estimatedPeakBytes = pixels * 36 + 96 * 1024 * 1024 + outputWidth * 512 * 8;
  if (pixels > policy.maxInputPixels || Math.max(outputWidth, outputHeight) > policy.maxOutputSide ||
      estimatedPeakBytes > policy.memoryBudgetBytes) {
    throw new PhotoError('size', `This photo is too large for this browser preview. Its limit on this device is ${policy.maxInputPixels / 1_000_000} megapixels, with extra limits for very wide photos. Try the full-size photo in the app.`);
  }
  return {width, height, outputWidth, outputHeight,
    tileCount: Math.ceil(width / STRIDE) * Math.ceil(height / STRIDE), estimatedPeakBytes};
}

export function estimateDuration(tileMs, tileCount) {
  if (!Number.isFinite(tileMs) || tileMs <= 0 || !Number.isSafeInteger(tileCount) || tileCount < 1) {
    throw new PhotoError('runtime', 'The browser speed check did not finish. Please try again.');
  }
  const milliseconds = Math.ceil(tileMs * tileCount * 1.25 + 3000);
  return {milliseconds, slow: milliseconds >= 60_000};
}

export function durationLabel(ms) {
  if (ms < 60_000) return `about ${Math.max(5, Math.ceil(ms / 5000) * 5)} seconds`;
  const minutes = Math.ceil(ms / 60_000);
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export function checkBrowser(env) {
  if (!env.secure) throw new PhotoError('browser', 'Open this page over HTTPS to use browser processing.');
  if (!env.worker || !env.wasm || !env.bitmap || !env.offscreen) {
    throw new PhotoError('browser', 'This browser doesn’t support the features needed to upscale photos here. Try a current browser or get the app.');
  }
}
