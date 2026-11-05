import {devicePolicy} from './capability.js';
import {tileGeometry} from './tile-geometry.js';
import {PHOTO4X_RELEASE} from './photo4x-release.js';
export {PHOTO4X_RELEASE} from './photo4x-release.js';
export {tileGeometry} from './tile-geometry.js';

export const PHOTO4X_BUDGET_MS = 300_000;
export const PHOTO4X_MARGIN = 1.25;

export const PHOTO4X_PROFILE_TTL = 7 * 24 * 60 * 60 * 1000;
export const PHOTO4X_GPU_FAILURE_TTL = 24 * 60 * 60 * 1000;
export const PHOTO4X_DOWNLOAD_FAILURE_TTL = 15 * 60 * 1000;
export const PHOTO4X_CALIBRATION_MS = 30_000;
const memory = new Map();
const memories = new WeakMap();
function memoryFor(storage) {
  if (!storage || (typeof storage !== 'object' && typeof storage !== 'function')) return memory;
  if (!memories.has(storage)) memories.set(storage, new Map());
  return memories.get(storage);
}
function read(storage, key) {
  try { const value = storage?.getItem(key); if (value != null) return value; } catch { /* In-memory fallback. */ }
  return memoryFor(storage).get(key);
}
function write(storage, key, value) {
  if (!key) return;
  const fallback = memoryFor(storage);
  fallback.set(key, value);
  // Keep private-window/session-only storage bounded as browsers/devices change.
  if (fallback.size > 64) fallback.delete(fallback.keys().next().value);
  try { storage?.setItem(key, value); } catch { /* In-memory fallback. */ }
}

export function photo4xBrowser(environment = {}) {
  const ua = environment.userAgent || '';
  const os = /Windows NT/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'macos' : 'other';
  let name, major;
  if (/Edg\//.test(ua)) { name = 'edge'; major = Number(ua.match(/Edg\/(\d+)/)?.[1]); }
  else if (/(?:Chrome|Chromium)\//.test(ua) && !/OPR\/|SamsungBrowser\//.test(ua)) {
    name = 'chrome'; major = Number(ua.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1]);
  } else if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    name = 'safari'; major = Number(ua.match(/Version\/(\d+)/)?.[1]);
  }
  return {os, name, major};
}

// One coarse GPU family for analytics; never the adapter's model, driver or description.
const GPU_VENDORS = ['apple', 'nvidia', 'amd', 'intel', 'qualcomm', 'arm'];
export function photo4xGpuVendor(info) {
  const vendor = String(info?.vendor || '').toLowerCase();
  if (!vendor) return 'unknown';
  if (vendor === 'ati') return 'amd';
  return GPU_VENDORS.find(name => vendor.includes(name)) || 'other';
}

export function loadPhoto4xProfile(storage, key, now = Date.now()) {
  try {
    const p = JSON.parse(read(storage, key) || 'null');
    return p?.v === 1 && p.compatible === true && Number.isFinite(p.updatedAt) && p.updatedAt <= now && now - p.updatedAt < PHOTO4X_PROFILE_TTL &&
      Number.isFinite(p.tileMs) && p.tileMs > 0 && Number.isFinite(p.margin) && p.margin >= PHOTO4X_MARGIN &&
      Array.isArray(p.overheads) && p.overheads.length <= 16 && p.overheads.every(b => b && typeof b.path === 'string' &&
        b.path.length < 200 && [b.assemblyMs, b.exportMs].every(n => Number.isFinite(n) && n >= 0)) ? p : undefined;
  } catch { return undefined; }
}

export function savePhoto4xProfile(storage, key, profile, now = Date.now()) {
  // Validate worker data too: a corrupt profile must never grant admission.
  const value = JSON.stringify({...profile, updatedAt: now});
  const test = {getItem: () => value};
  if (loadPhoto4xProfile(test, key, now)) write(storage, key, value);
}

export function rememberPhoto4xFailure(storage, variant, error, now = Date.now()) {
  if (!variant?.failureKey || !['gpu', 'runtime', 'timeout', 'download', 'export'].includes(error?.code)) return;
  const ttl = error.code === 'download' ? PHOTO4X_DOWNLOAD_FAILURE_TTL : PHOTO4X_GPU_FAILURE_TTL;
  write(storage, variant.failureKey, String(now + ttl));
}

export function photo4xPath(plan, mime, {hasTransparency = false, baseExport = false} = {}) {
  return [plan.outputWidth, plan.outputHeight, mime, Boolean(hasTransparency), Boolean(baseExport)].join('|');
}

// Quick to grow, slow to forgive: a slow run counts at once, but one outlier
// (thermal throttling, a busy GPU) fades over a few normal runs instead of
// permanently shrinking which photos qualify.
export function smoothPhoto4xCost(previous, next) {
  return Number.isFinite(previous) && previous > next ? previous * .75 + next * .25 : next;
}

// Omit tileMs or margin when this update carries no new evidence for it.
export function updatePhoto4xProfile(previous, {tileMs, margin, overhead, now = Date.now()}) {
  const overheads = (previous?.overheads || []).filter(b => b.path !== overhead?.path);
  if (overhead) overheads.push(overhead);
  return {v: 1, compatible: true, updatedAt: now,
    tileMs: tileMs === undefined ? previous?.tileMs : smoothPhoto4xCost(previous?.tileMs, tileMs),
    margin: margin === undefined ? previous?.margin ?? PHOTO4X_MARGIN : Math.max(PHOTO4X_MARGIN, smoothPhoto4xCost(previous?.margin, margin)),
    overheads: overheads.slice(-16)};
}

export function variantKey(variant, backend = 'webgpu') {
  if (!variant) return 'regular';
  const {tileSize, overlap} = tileGeometry(variant);
  return [variant.id, variant.revision, variant.precision, backend, tileSize, overlap].map(encodeURIComponent).join('|');
}

export function forecastPhoto4x({tileTimes, tileCount, assemblyMs, exportMs, margin = PHOTO4X_MARGIN}) {
  // Missing evidence cannot approve a heavy model. Timings include readback;
  // assembly and export are separately measured for this output-size bucket.
  if (!Array.isArray(tileTimes) || tileTimes.length < Math.min(3, tileCount) || tileTimes.some(t => !Number.isFinite(t) || t <= 0) ||
      !Number.isSafeInteger(tileCount) || tileCount < 1 ||
      ![assemblyMs, exportMs, margin].every(Number.isFinite) || assemblyMs < 0 || exportMs < 0 || margin < PHOTO4X_MARGIN) {
    return {allowed: false, milliseconds: null, reason: 'missing-evidence'};
  }
  const milliseconds = Math.ceil(Math.max(...tileTimes) * Math.max(tileCount, tileTimes.length) * margin + assemblyMs + exportMs);
  return {allowed: milliseconds <= PHOTO4X_BUDGET_MS, milliseconds,
    reason: milliseconds <= PHOTO4X_BUDGET_MS ? 'within-budget' : 'over-budget'};
}

export function calibratePhoto4xMargin(measurements) {
  // Measurements compare measured upscale+export with the unscaled inference
  // estimate plus separately measured overhead. A single slow run is retained.
  let margin = PHOTO4X_MARGIN;
  for (const {inferenceEstimateMs, overheadMs, actualMs} of measurements) {
    if (Number.isFinite(inferenceEstimateMs) && inferenceEstimateMs > 0 && Number.isFinite(overheadMs) && overheadMs >= 0 && Number.isFinite(actualMs) && actualMs > 0) {
      margin = Math.max(margin, (actualMs - overheadMs) / inferenceEstimateMs);
    }
  }
  return margin;
}

export function photo4xOverhead(variant, plan, mime, path = {}) {
  const saved = variant.cachedProfile?.overheads?.find(b => b.path === photo4xPath(plan, mime, path));
  if (saved && [saved.assemblyMs, saved.exportMs].every(n => Number.isFinite(n) && n >= 0)) {
    return {assemblyMs: saved.assemblyMs, exportMs: saved.exportMs, margin: variant.cachedProfile.margin};
  }
  const pixels = plan.outputWidth * plan.outputHeight;
  // Never extrapolate encoding a small PNG to a 195 MP JPEG or another device.
  const bucket = variant.costEvidence?.buckets?.filter(b => b.mime === mime && b.maxOutputPixels >= pixels &&
    b.configuration === variant.configuration && b.evidence).sort((a, b) => a.maxOutputPixels - b.maxOutputPixels)[0];
  return bucket ? {assemblyMs: bucket.assemblyMs, exportMs: bucket.exportMs, margin: bucket.margin} : {};
}

export function gpuSupportsVariant(variant, {limits = {}, features = [], isFallbackAdapter = false, info = {}} = {}) {
  const software = /swiftshader|llvmpipe|lavapipe|software|basic render driver/i.test([info.vendor, info.architecture, info.device, info.description].join(' '));
  return !isFallbackAdapter && !software && (variant.requires?.features || []).every(f => features.includes(f)) &&
    Object.entries(variant.requires?.limits || {}).every(([name, minimum]) => Number.isFinite(limits[name]) && limits[name] >= minimum);
}

// Older descriptors without `scales` only ever served Photo 4×.
const releaseScales = release => release.scales || [4];

export function selectPhoto4xCandidate({environment, modelKind, scale, forceCpu, configuration}, release = PHOTO4X_RELEASE) {
  if (!release.licenseApproved || release.enabled === false || !release.winner || modelKind !== 'photo' || !releaseScales(release).includes(scale) || forceCpu ||
      devicePolicy(environment).mobile || !environment.webgpu) return null;
  // Retain explicit configuration gates for old diagnostic releases only.
  if (release.configurations) return release.configurations.includes(configuration) ? release.winner : null;
  const {os, name, major} = photo4xBrowser(environment);
  if (!['macos', 'windows'].includes(os) || !major || !release.browsers?.[name] ||
      (name === 'safari' && (os !== 'macos' || major < 26))) return null;
  return release.winner;
}

export function photo4xConfiguration(environment, info = {}, adapter = {}, runtimeVersion = PHOTO4X_RELEASE.runtimeVersion) {
  const {os, name, major} = photo4xBrowser(environment);
  const osVersion = environment.userAgent?.match(/(?:Windows NT |Mac OS X )([\d._]+)/)?.[1] || '';
  return JSON.stringify([runtimeVersion, os, osVersion, name, major, environment.hardwareConcurrency || 0,
    environment.deviceMemory || 0, info.vendor || '', info.architecture || '', info.device || '',
    [...(adapter.features || [])].sort(),
    ...['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup']
      .map(key => adapter.limits?.[key] || 0)]);
}

export async function approvedPhoto4xCandidate(request, getAdapter, release = PHOTO4X_RELEASE) {
  // Do not even probe the adapter for an unapproved release or unrelated mode.
  if (!release.winner || release.enabled === false || !release.licenseApproved || request.modelKind !== 'photo' || !releaseScales(release).includes(request.scale) || request.forceCpu ||
      devicePolicy(request.environment).mobile || !request.environment.webgpu) return null;
  if (!release.configurations && !selectPhoto4xCandidate(request, release)) return null;
  try {
    let timer;
    request.onDiagnostic?.('adapter');
    let adapter;
    try { adapter = await Promise.race([getAdapter(), new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]); }
    finally { clearTimeout(timer); }
    request.onDiagnostic?.('adapter-result');
    if (!adapter) return null;
    const configuration = photo4xConfiguration(request.environment, adapter.info, adapter, release.runtimeVersion);
    const candidate = selectPhoto4xCandidate({...request, configuration}, release);
    if (!candidate?.requires?.gpuOnly || !gpuSupportsVariant(candidate, {limits: adapter.limits, features: [...adapter.features], isFallbackAdapter: adapter.isFallbackAdapter, info: adapter.info})) return null;
    const failureKey = `uscale-photo4x-failed-v2-${variantKey(candidate)}-${encodeURIComponent(configuration)}`;
    const profileKey = `uscale-photo4x-profile-v1-${variantKey(candidate)}-${encodeURIComponent(configuration)}`;
    const now = request.now ?? Date.now(), until = Number(read(request.storage, failureKey));
    if (until > now && until <= now + PHOTO4X_GPU_FAILURE_TTL) return null;
    return {...candidate, failureKey, profileKey, configuration, cachedProfile: loadPhoto4xProfile(request.storage, profileKey, now)};
  } catch { return null; }
}

export function photoExecutionChoices(choices, variant) {
  if (!variant || !choices.some(c => c.backend === 'webgpu')) return choices;
  // Only the approved winner, followed by the existing model's normal chain.
  return [{backend: 'webgpu', threads: 1, variant, modelFallback: true, failureKey: variant.failureKey}, ...choices];
}
