export const TILE_SIZE = 256;
export const OVERLAP = 16;
export const STRIDE = TILE_SIZE - OVERLAP * 2;
export const SCALE = 2;
export const SCALES = [2, 4];
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// `key` names the message in the page's string table (see i18n.js); workers
// pass it back to the page, which words it in the visitor's language.
export class PhotoError extends Error {
  constructor(code, key, params) {
    super(key);
    this.name = 'PhotoError';
    this.code = code;
    this.key = key;
    this.params = params;
  }
}

export function isAppleMobile(env = {}) {
  return /iPhone|iPad|iPod/.test(env.userAgent || '') ||
    (/Mac/.test(env.platform || '') && env.maxTouchPoints > 1);
}

// iPad specifically: the "iPad" UA token (classic Safari UA), or the "Mac +
// touch" signature Safari reports in its default desktop-site request mode.
// That second form is indistinguishable from "MacBook with a touchscreen",
// which does not exist, so it safely means iPad.
export function isIPad(env = {}) {
  return /iPad/.test(env.userAgent || '') ||
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
  // iPad keeps these same conservative numbers -- only supportsScale() below
  // treats it differently, since nothing here has been measured on iPad.
  return {
    maxInputPixels: lowMemory ? 4_000_000 : mobile ? 16_000_000 : 40_000_000,
    // 4x's own ceiling, not derived from the 2x number above: a real 4032x3024
    // (12.19 MP) camera photo at 4x is a 195 MP / 578 MB canvas, which is 73%
    // of the 268 MP Mac canvas measured safe this session and 28% of the
    // memory budget below -- real margin, not just area-parity with 2x.
    // Mobile/iPad have no such measurement, so they fall back to the
    // conservative area-parity figure in maxInputPixelsForScale().
    maxInputPixels4x: mobile ? undefined : 13_000_000,
    maxOutputSide: mobile ? 8192 : 16384,
    memoryBudgetBytes: (lowMemory ? 256 : mobile ? 900 : 2048) * 1024 * 1024,
    mobile,
    lowMemory,
    iPad: isIPad(env),
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
// keeping it off phones here also keeps this preview from undercutting that
// on the device most likely to be comparing the two. iPad is carved out of
// that phone-shaped restriction -- its screen and RAM sit closer to a laptop
// -- while still using the same conservative (iPhone-measured) input/memory
// numbers above, since those specifically haven't been measured on iPad.
export function supportsScale(policy, scale) {
  return scale === 2 || (scale === 4 && (!policy.mobile || policy.iPad));
}

// maxInputPixels is calibrated for 2x. Where a scale has no directly measured
// figure of its own (policy.maxInputPixels4x, desktop-only), fall back to an
// output-area-parity estimate: input_cap(scale) = input_cap(2) * 4 / scale^2.
export function maxInputPixelsForScale(policy, scale) {
  if (scale === 4 && policy.maxInputPixels4x) return policy.maxInputPixels4x;
  return Math.floor(policy.maxInputPixels * 4 / (scale * scale));
}

// Used for the up-front estimate before any engine download. Replaced by a
// measured per-device value once a photo has been processed.
export const DEFAULT_TILE_MS = {mobile: 2000, desktop: 700};

export function assessPhoto({width, height, size = 0}, policy = devicePolicy(), scale = SCALE) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new PhotoError('format', 'err_unreadable');
  }
  if (size > MAX_FILE_BYTES) throw new PhotoError('size', 'err_file_size');
  if (!supportsScale(policy, scale)) throw new PhotoError('size', 'err_4x_device');
  const pixels = width * height;
  const outputWidth = width * scale;
  const outputHeight = height * scale;
  const maxInputPixels = maxInputPixelsForScale(policy, scale);
  // Allow for decoder/bitmap, destination canvas, export scratch space, the
  // inference engine, and two row bands. This is deliberately an estimate.
  const estimatedPeakBytes = pixels * 36 + 96 * 1024 * 1024 + outputWidth * 512 * 8;
  if (pixels > maxInputPixels || Math.max(outputWidth, outputHeight) > policy.maxOutputSide ||
      estimatedPeakBytes > policy.memoryBudgetBytes) {
    throw new PhotoError('size', 'err_too_large', {scale, mp: maxInputPixels / 1_000_000});
  }
  return {width, height, outputWidth, outputHeight, scale,
    tileCount: Math.ceil(width / STRIDE) * Math.ceil(height / STRIDE), estimatedPeakBytes};
}

export function estimateDuration(tileMs, tileCount) {
  if (!Number.isFinite(tileMs) || tileMs <= 0 || !Number.isSafeInteger(tileCount) || tileCount < 1) {
    throw new PhotoError('runtime', 'err_speed');
  }
  const milliseconds = Math.ceil(tileMs * tileCount * 1.25 + 3000);
  return {milliseconds, slow: milliseconds >= 60_000};
}

export function checkBrowser(env) {
  if (!env.secure) throw new PhotoError('browser', 'err_https');
  if (!env.worker || !env.wasm || !env.bitmap || !env.offscreen) {
    throw new PhotoError('browser', 'err_browser');
  }
}
