// Port of the iOS FaceRestorationQualityGate (snapshot pinned in tests/fixtures/face-quality/ios-reference).
// Encoded sRGB luma (0…255), top-left row order; never linearize these values.
export const IOS_FACE_POLICY = Object.freeze({version: 'face-guard-v1', retention: .90,
  structure: .88, shift: .04, nativeRetention: .65, nativeSignal: .7,
  sourceSignal: 1, minInterEyePixels: 24});
// Pixel mode keeps SSIM for structure but neither requires nor evaluates landmarks.
export const FACE_PIXEL_POLICY = Object.freeze({...IOS_FACE_POLICY, version: 'face-guard-v1-web-pixel', landmarks: false});

export function unavailableAssessment(policy = FACE_PIXEL_POLICY) {
  return {status: 'review', reason: 'measurement-unavailable', policyVersion: policy.version, evidence: null};
}

// Size/pose admission is the caller's. Policies without `landmarks: false`
// follow Swift and require landmark displacement for a pass.
export function decideFaceQuality(e, policy = FACE_PIXEL_POLICY) {
  const result = (status, reason) => ({status, reason, policyVersion: policy.version, evidence: e});
  const landmarks = policy.landmarks !== false;
  if (!e?.canonical) return unavailableAssessment(policy);
  const values = [e.canonical.sourceSignal, e.canonical.retention, e.structure, e.cropPixels, e.interEyePixels];
  if (e.native != null) values.push(e.native.sourceSignal, e.native.retention);
  if (landmarks && e.landmarkShift != null) values.push(e.landmarkShift);
  if (!values.every(Number.isFinite) || e.cropPixels <= 0 || e.interEyePixels <= 0) return result('review', 'measurement-unavailable');
  if (e.cropPixels > 512) {
    if (!e.native) return result('review', 'insufficient-evidence');
    if (e.native.sourceSignal > policy.nativeSignal && e.native.retention < policy.nativeRetention) return result('skip', 'native-detail-loss');
  }
  if (e.canonical.sourceSignal > policy.sourceSignal && e.canonical.retention < policy.retention) return result('skip', 'correlated-detail-loss');
  if (e.structure < policy.structure || (landmarks && e.landmarkShift != null && e.landmarkShift > policy.shift)) return result('review', 'geometry-risk');
  if (e.interEyePixels < policy.minInterEyePixels || (landmarks && e.landmarkShift == null)) return result('review', 'insufficient-evidence');
  return result('pass', 'no-obvious-risk');
}

export function faceLuma(rgba) {
  if (!rgba?.length || rgba.length % 4) throw new Error('Invalid RGBA plane');
  const pixels = new Float32Array(rgba.length / 4);
  for (let p = 0; p < pixels.length; p++) pixels[p] = .2126 * rgba[p * 4] + .7152 * rgba[p * 4 + 1] + .0722 * rgba[p * 4 + 2];
  return pixels;
}

function gaussian(src, width, height, sigma) {
  const radius = Math.floor(4 * sigma + .5), kernel = new Float32Array(radius * 2 + 1);
  // Swift stores and sums the taps as Float.
  let sum = 0;
  for (let k = 0; k < kernel.length; k++) {
    kernel[k] = Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma));
    sum = Math.fround(sum + kernel[k]);
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = 0;
    for (let k = -radius; k <= radius; k++) value += src[y * width + Math.min(width - 1, Math.max(0, x + k))] * kernel[k + radius];
    tmp[y * width + x] = value;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = 0;
    for (let k = -radius; k <= radius; k++) value += tmp[Math.min(height - 1, Math.max(0, y + k)) * width + x] * kernel[k + radius];
    out[y * width + x] = value;
  }
  return out;
}

function median3(src, width, height) {
  const out = src.slice(), window = new Float32Array(9);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) window[k++] = src[(y + dy) * width + x + dx];
    window.sort(); out[y * width + x] = window[4];
  }
  return out;
}

const quantile = (sorted, fraction) => {
  const p = (sorted.length - 1) * fraction, lo = Math.floor(p), hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
};

export function measureFaceQuality(before, after, width, height, includeStructure = true) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 1024 || height > 1024 ||
      before.length !== width * height || after.length !== before.length || !before.every(Number.isFinite) || !after.every(Number.isFinite)) throw new Error('Invalid luma planes');
  const x0 = Math.max(0, Math.floor(144 * width / 512) - 32), y0 = Math.max(0, Math.floor(183 * height / 512) - 32);
  const x1 = Math.min(width, Math.floor(369 * width / 512) + 33), y1 = Math.min(height, Math.floor(424 * height / 512) + 33);
  const w = x1 - x0, h = y1 - y0;
  const crop = src => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) out.set(src.subarray((y + y0) * width + x0, (y + y0) * width + x1), y * w);
    return out;
  };
  const a = crop(before), b = crop(after), mask = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = ((x + x0) * 512 / width - 256) / 112, dy = ((y + y0) * 512 / height - 303) / 120;
    if (dx * dx + dy * dy < 1) mask.push(y * w + x);
  }
  if (!mask.length) throw new Error('Empty face mask');
  const blur = (src, sigma) => gaussian(src, w, h, sigma);
  const broadA = blur(a, 3), broadB = blur(b, 3);
  let meanA = 0, meanB = 0;
  for (const i of mask) { meanA += broadA[i]; meanB += broadB[i]; }
  meanA /= mask.length; meanB /= mask.length;
  let numerator = 0, denominator = 0;
  for (const i of mask) { const x = broadA[i] - meanA; numerator += x * (broadB[i] - meanB); denominator += x * x; }
  const contrast = Math.min(1.5, Math.max(.67, numerator / (denominator + 1e-6)));
  const cleanA = median3(a, w, h), cleanB = median3(b, w, h);
  let retention = 0, sourceSignal = 0;
  for (const sigma of [.7, 1.4]) {
    const a1 = blur(cleanA, sigma), a2 = blur(cleanA, sigma * 2), b1 = blur(cleanB, sigma), b2 = blur(cleanB, sigma * 2);
    // Swift subtracts Float32 samples before accumulating in Double.
    const amplitudes = Float64Array.from(mask, i => Math.abs(Math.fround(a1[i] - a2[i]))).sort();
    const limit = quantile(amplitudes, .97);
    let xy = 0, xx = 0, energy = 0;
    for (const i of mask) {
      const x = Math.fround(a1[i] - a2[i]);
      if (Math.abs(x) <= limit) { xy += x * Math.fround(b1[i] - b2[i]) / contrast; xx += x * x; }
      energy += Math.min(Math.abs(x), limit) ** 2;
    }
    retention += xy / (xx + 1e-6) / 2;
    if (sigma === .7) sourceSignal = Math.sqrt(energy / mask.length);
  }
  let structure = null;
  if (includeStructure) {
    const sa = blur(a, 1.5), sb = blur(b, 1.5), ma = blur(sa, 2), mb = blur(sb, 2);
    const product = (lhs, rhs) => Float32Array.from(lhs, (v, i) => v * rhs[i]);
    const aa = blur(product(sa, sa), 2), bb = blur(product(sb, sb), 2), ab = blur(product(sa, sb), 2);
    let sum = 0;
    for (const i of mask) {
      const x = ma[i], y = mb[i], va = Math.max(0, aa[i] - x * x), vb = Math.max(0, bb[i] - y * y), cov = ab[i] - x * y;
      sum += ((2 * x * y + 2.55 ** 2) * (2 * cov + 7.65 ** 2)) / ((x * x + y * y + 2.55 ** 2) * (va + vb + 7.65 ** 2));
    }
    structure = sum / mask.length;
  }
  return {detail: {sourceSignal, retention}, structure};
}

// Swift/OpenCV bicubic, a=-0.75, half-pixel sampling. Float32 intermediates.
export function resizeFaceLuma2x(src, width = 512, height = 512) {
  if (src.length !== width * height) throw new Error('Invalid resize plane');
  const cubic = value => {
    const x = Math.abs(value), a = -.75;
    return x <= 1 ? (a + 2) * x ** 3 - (a + 3) * x * x + 1 : x < 2 ? a * x ** 3 - 5 * a * x * x + 8 * a * x - 4 * a : 0;
  };
  const tmp = new Float32Array(width * 2 * height), out = new Float32Array(src.length * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 2; x++) {
    const sx = x / 2 - .25, ix = Math.floor(sx);
    let value = 0;
    for (let k = -1; k <= 2; k++) value = Math.fround(value + Math.fround(src[y * width + Math.min(width - 1, Math.max(0, ix + k))] * cubic(sx - ix - k)));
    tmp[y * width * 2 + x] = value;
  }
  for (let y = 0; y < height * 2; y++) for (let x = 0; x < width * 2; x++) {
    const sy = y / 2 - .25, iy = Math.floor(sy);
    let value = 0;
    for (let k = -1; k <= 2; k++) value = Math.fround(value + Math.fround(tmp[Math.min(height - 1, Math.max(0, iy + k)) * width * 2 + x] * cubic(sy - iy - k)));
    out[y * width * 2 + x] = value;
  }
  return out;
}
