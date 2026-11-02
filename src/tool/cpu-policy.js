import {isAppleMobile} from './capability.js';

export const CPU_POLICY_REVISION = 'cpu-v1-png-v1';
export const FAILURE_TTL = 7 * 24 * 60 * 60 * 1000;
// Add a row only with linked full-worker measurements and stability results.
// In particular, desktop results are never evidence for an iPhone or Android.
export const VERIFIED_CPU_POLICIES = [
  {os: 'macos', engine: 'chromium', minVersion: 151, group: 'upscale',
    coreClasses: ['9-16'], memoryClasses: ['high'], threads: 8, stable: true, gain: .8204,
    assetRevision: 'ort-1.23.2|9925a204e41ab72e|1527e3c5453ca491|27917d9ea78a9acc|06247e72c6f210f4',
    evidence: 'benchmarks/browser/mac_chromium_151_product_cpu.json'},
  {os: 'macos', engine: 'chromium', minVersion: 151, group: 'faces',
    coreClasses: ['9-16'], memoryClasses: ['high'], threads: 7, stable: true, gain: .7785,
    assetRevision: 'ort-1.23.2|ebafce4e3c118d65|64184e229b263107|vision-1.0.1|https://upscales.uk/web_models/face_512-7333260230803fbf.onnx',
    evidence: 'benchmarks/browser/cpu-face-detect-chromium-final.json'},
];
export const BLOCKED_CPU_VERSIONS = [];

export function cpuIdentity(env = {}) {
  const ua = env.userAgent || '';
  const appleMobile = isAppleMobile(env);
  const os = appleMobile ? (/iPad/.test(ua) || (/Mac/.test(env.platform || '') && env.maxTouchPoints > 1) ? 'ipados' : 'ios')
    : /Android/.test(ua) ? 'android' : /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'macos'
      : /Linux/.test(ua) ? 'linux' : 'unknown';
  let engine = 'unknown', versionText = '0';
  if (appleMobile) {
    engine = 'webkit'; versionText = ua.match(/Version\/([\d.]+)/)?.[1] || ua.match(/CPU (?:iPhone )?OS ([\d_]+)/)?.[1]?.replaceAll('_', '.') || '0';
  } else if (/Chrome\/|Chromium\//.test(ua)) {
    engine = 'chromium'; versionText = ua.match(/(?:Chrome|Chromium)\/([\d.]+)/)?.[1] || '0';
  } else if (/Firefox\//.test(ua)) {
    engine = 'gecko'; versionText = ua.match(/Firefox\/([\d.]+)/)?.[1] || '0';
  } else if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    engine = 'webkit'; versionText = ua.match(/Version\/([\d.]+)/)?.[1] || '0';
  }
  const cores = Number.isInteger(env.hardwareConcurrency) && env.hardwareConcurrency > 0 ? env.hardwareConcurrency : 0;
  const coreClass = !cores ? 'unknown' : cores <= 2 ? '1-2' : cores <= 4 ? '3-4' : cores <= 8 ? '5-8' : cores <= 16 ? '9-16' : '17+';
  const memoryClass = !Number.isFinite(env.deviceMemory) ? 'unknown' : env.deviceMemory <= 4 ? 'low' : 'high';
  return {os, engine, version: Number(versionText.split('.')[0]), versionText, cores, coreClass, memoryClass, mobile: appleMobile || /Android|Mobile/.test(ua)};
}

function compareVersion(a, b) {
  const left = String(a).split('.').map(Number), right = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

// An integer upper bound blocks the entire major release; a dotted bound is
// inclusive at its specified version. Minimums always retain patch precision.
function blockedVersion(version, rule) {
  if (compareVersion(version, rule.minVersion) < 0) return false;
  return /^\d+$/.test(String(rule.maxVersion))
    ? Number(version.split('.')[0]) <= Number(rule.maxVersion)
    : compareVersion(version, rule.maxVersion) <= 0;
}

export function threadCandidates(env) {
  const {cores, mobile} = cpuIdentity(env);
  return [...new Set((mobile ? [1, 2] : [1, 2, 4, 8, Math.min(8, Math.floor(cores / 2))])
    .filter(n => n >= 1 && n <= Math.max(1, cores)))].sort((a, b) => a - b);
}

export function verifiedThreads(env, group, policies = VERIFIED_CPU_POLICIES, blocked = BLOCKED_CPU_VERSIONS, assets) {
  const id = cpuIdentity(env);
  if (!id.cores || !id.version || id.os === 'unknown' || id.engine === 'unknown' ||
      !env.crossOriginIsolated || !env.sharedMemory) return 1;
  if (blocked.some(p => p.os === id.os && p.engine === id.engine && blockedVersion(id.versionText, p))) return 1;
  const row = policies.find(p => p.os === id.os && p.engine === id.engine && p.group === group &&
    compareVersion(id.versionText, p.minVersion) >= 0 && p.coreClasses.includes(id.coreClass) && p.memoryClasses.includes(id.memoryClass));
  if (row?.assetRevision) {
    const hash = path => path?.split('/').at(-1)?.split('-')[0];
    const models = group === 'upscale' ? ['photo', 'drawing'].flatMap(kind =>
      [2, 4].map(scale => hash(assets?.models?.[kind]?.[scale]?.cpu)))
      : [hash(assets?.faceFinder), hash(assets?.faceDetector), assets?.vision?.split('/').at(-1),
        ...(assets?.faceModel?.parts || []).map(part => part.url)];
    const revision = [assets?.runtime?.split('/').at(-1), ...models].join('|');
    if (revision !== row.assetRevision) return 1;
  }
  // Benchmark candidates depend on the measured machine's half-core count.
  // A fixed verified row (e.g. 7 on the 9–16 class) remains valid across that
  // class even when another machine's candidate list would contain 5 or 6.
  return row && row.gain >= .15 && row.stable && row.evidence && Number.isInteger(row.threads) &&
    row.threads > 1 && row.threads <= Math.min(id.mobile ? 2 : 8, id.cores) ? row.threads : 1;
}

export function failureKey(env, group, threads, assets = {}) {
  const {os, engine, version, coreClass, memoryClass} = cpuIdentity(env);
  const models = group === 'faces' ? [assets.faceFinder, assets.faceDetector, assets.vision, assets.faceModel?.parts] : assets.models;
  return `uscale-cpu-failure:${JSON.stringify([CPU_POLICY_REVISION, assets.runtime, models, os, engine, version, coreClass, memoryClass, group, threads])}`;
}

export function failureRemembered(storage, key, now = Date.now()) {
  try {
    const until = Number(storage?.getItem(key));
    if (until > now && until <= now + FAILURE_TTL) return true;
    storage?.removeItem(key);
  } catch { /* Storage is optional, including property access in the caller. */ }
  return false;
}

export function rememberThreadFailure(storage, key, now = Date.now()) {
  try { storage?.setItem(key, String(now + FAILURE_TTL)); } catch { /* Private browsing still works. */ }
}

export function executionChoices(env, group, {forceCpu = false, storage, policies, blocked, assets} = {}) {
  let threads = verifiedThreads(env, group, policies, blocked, assets);
  const key = failureKey(env, group, threads, assets);
  if (threads > 1 && failureRemembered(storage, key)) threads = 1;
  const gpu = env.webgpu && !forceCpu && !(group === 'faces' && isAppleMobile(env));
  return [...(gpu ? [{backend: 'webgpu', threads: 1}] : []),
    ...(threads > 1 ? [{backend: 'wasm', threads, failureKey: key}] : []), {backend: 'wasm', threads: 1}];
}

export const median = values => { const sorted = [...values].sort((a, b) => a - b); const m = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; };
export function selectThreadWinner(results) {
  const baseline = results.find(r => r.threads === 1);
  if (!baseline || !baseline.stable || baseline.runs < 5) return {threads: 1, gain: 0};
  const valid = results.filter(r => r.stable && r.runs >= 5 && 1 - r.medianMs / baseline.medianMs >= .15);
  if (!valid.length) return {threads: 1, gain: 0};
  const fastest = Math.min(...valid.map(r => r.medianMs));
  const winner = valid.filter(r => r.medianMs <= fastest * 1.03).sort((a, b) => a.threads - b.threads)[0];
  return {threads: winner.threads, gain: 1 - winner.medianMs / baseline.medianMs};
}

