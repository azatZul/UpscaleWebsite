export const TILE_SIZE = 256;
export const OVERLAP = 16;
export const STRIDE = TILE_SIZE - OVERLAP * 2;
export const SCALE = 2;
export const SCALES = [2, 4];
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
  // Admission limits, not measurements of free RAM. The mobile numbers come
  // from an iPhone 13 Pro (iOS 27): an 8064x6048 canvas and a JPEG export of
  // it both succeeded, and the tab touched 1536 MB without throwing. A 12 MP
  // camera photo therefore fits; 8192 output side already allows it. Devices
  // reporting 4 GB or less stay conservative because they are unmeasured.
  return {
    maxInputPixels: lowMemory ? 4_000_000 : mobile ? 16_000_000 : 40_000_000,
    maxOutputSide: mobile ? 8192 : 16384,
    memoryBudgetBytes: (lowMemory ? 256 : mobile ? 900 : 2048) * 1024 * 1024,
    mobile,
    lowMemory,
  };
}

// Separate face enhancement works on 512x512 crops, so the source size barely
// changes its working set. It only needs the same admission as the photo.
export function faceLimit(policy = devicePolicy()) {
  return policy.lowMemory ? 4_000_000 : policy.maxInputPixels;
}

// 4x is desktop-only: its output canvas is 4x the linear size of 2x's for the
// same photo (16x the area), and only the desktop canvas/memory headroom
// measured this session covers that. The app also sells 4x as a Pro feature;
// keeping it off mobile here also keeps this preview from undercutting that
// on the devices most likely to be comparing the two.
export function supportsScale(policy, scale) {
  return scale === 2 || (scale === 4 && !policy.mobile);
}

// maxInputPixels is calibrated for 2x. A larger scale must admit fewer input
// pixels so the OUTPUT canvas — the thing actually measured against hardware
// limits — stays the same area: input_cap(scale) = input_cap(2) * 4 / scale^2.
export function maxInputPixelsForScale(policy, scale) {
  return Math.floor(policy.maxInputPixels * 4 / (scale * scale));
}

// Used for the up-front estimate before any engine download. Replaced by a
// measured per-device value once a photo has been processed.
export const DEFAULT_TILE_MS = {mobile: 2000, desktop: 700};

export function assessPhoto({width, height, size = 0}, policy = devicePolicy(), scale = SCALE) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new PhotoError('format', 'We couldn’t read this photo. Try a JPEG, PNG or WebP image.');
  }
  if (size > MAX_FILE_BYTES) throw new PhotoError('size', 'This file exceeds the browser preview’s 50 MB limit. Try it in the app.');
  if (!supportsScale(policy, scale)) throw new PhotoError('size', '4x upscaling needs a desktop browser. Try 2x here, or use the app.');
  const pixels = width * height;
  const outputWidth = width * scale;
  const outputHeight = height * scale;
  const maxInputPixels = maxInputPixelsForScale(policy, scale);
  // Allow for decoder/bitmap, destination canvas, export scratch space, the
  // inference engine, and two row bands. This is deliberately an estimate.
  const estimatedPeakBytes = pixels * 36 + 96 * 1024 * 1024 + outputWidth * 512 * 8;
  if (pixels > maxInputPixels || Math.max(outputWidth, outputHeight) > policy.maxOutputSide ||
      estimatedPeakBytes > policy.memoryBudgetBytes) {
    throw new PhotoError('size', `This photo is too large for this browser preview. Its limit on this device at ${scale}x is ${maxInputPixels / 1_000_000} megapixels, with extra limits for very wide photos. Try the full-size photo in the app.`);
  }
  return {width, height, outputWidth, outputHeight, scale,
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
