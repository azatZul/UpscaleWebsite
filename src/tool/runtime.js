import {ASSETS} from './assets.generated.js';
import {PhotoError, SCALE, TILE_SIZE} from './capability.js';
import {resolveModelAsset} from './model-selection.js';
import {tensorPixels} from './tile-pipeline.js';
import {gpuSupportsVariant, variantKey} from './photo4x-policy.js';

import {requireGpuAdapter, selectBackend} from './gpu-backend.js';
export {requireGpuAdapter, selectBackend} from './gpu-backend.js';

let configured;
export function wasmThreads(requested = 1, env = globalThis) {
  if (!Number.isInteger(requested) || requested < 2 || !env.crossOriginIsolated ||
      typeof env.SharedArrayBuffer !== 'function' || typeof env.Atomics !== 'object') return 1;
  try {
    new env.WebAssembly.Memory({initial: 1, maximum: 1, shared: true});
    return Math.min(8, requested, env.navigator?.hardwareConcurrency || 1);
  } catch { return 1; }
}

export async function importOrt(backend, execution = {}) {
  const ort = await import(/* @vite-ignore */ `${ASSETS.runtime}/${backend === 'webgpu' ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs'}`);
  ort.env.wasm.wasmPaths = `${ASSETS.runtime}/`;
  const threads = backend === 'wasm' ? wasmThreads(execution.threads) : 1;
  if (configured && (configured.backend !== backend || configured.threads !== threads)) {
    throw new Error('A changed WASM configuration requires a fresh worker');
  }
  if (!configured) { ort.env.wasm.numThreads = threads; configured = {backend, threads}; }
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';
  return ort;
}

export async function loadRuntime(forceCpu, progress, face = false, scale = SCALE, modelKind = 'photo', execution = {}) {
  const backend = execution.backend || await selectBackend(forceCpu);
  const variant = !face && execution.variant;
  // The 4× variant also serves Photo 2×: its output is box-downscaled per tile.
  const modelScale = variant?.scale ?? scale;
  if (variant && (forceCpu || backend !== 'webgpu' || modelKind !== 'photo' || ![1, 2].includes(modelScale / scale))) {
    throw new PhotoError('runtime', 'err_engine_start');
  }
  const tileSize = variant?.tileSize || TILE_SIZE;
  const timings = {}, started = performance.now();
  let model;
  try { model = face ? undefined : variant?.url || resolveModelAsset(ASSETS.models, modelKind, scale, backend); }
  catch (error) { throw new PhotoError('runtime', 'err_engine_start', undefined, error); }
  const modelTitle = face ? 'loading_faces' : 'loading_upscaler';
  const outputSide = face ? 512 : tileSize * scale;
  const modelSide = face ? 512 : tileSize * modelScale;
  let session;
  let ort;
  try {
    progress({phase: 'initialize', title: 'loading_engine', detail: 'loading_engine_detail'});
    const adapter = backend === 'webgpu' ? await requireGpuAdapter() : undefined;
    if (variant && !gpuSupportsVariant(variant, {limits: adapter.limits, features: [...adapter.features], isFallbackAdapter: adapter.isFallbackAdapter, info: adapter.info})) {
      throw new PhotoError('gpu', 'err_engine_start');
    }
    ort = await importOrt(backend, execution);
    if (variant) ort.env.webgpu.adapter = adapter;
    if (execution.profile) {
      ort.env.logLevel = 'verbose';
      ort.env.webgpu.profiling = {mode: 'default'};
    }
    progress({phase: 'download', progress: 0, title: modelTitle, detail: 'loading_cached_detail'});
    // One download indicator: the model takes 90%, the engine the final 10%.
    const report = (fraction, receivedBytes) => progress({phase: 'download',
      progress: fraction === undefined ? undefined : fraction * .9, receivedBytes, title: modelTitle, detail: 'stays_on_device'});
    const downloadStarted = performance.now();
    const modelBytes = face ? await downloadFace(report) : await download(model, report);
    timings.modelDownloadMs = performance.now() - downloadStarted;
    if (variant?.sha256) {
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', modelBytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      if (digest !== variant.sha256) throw new PhotoError('download', 'err_unavailable');
    }
    const binary = backend === 'webgpu' ? 'ort-wasm-simd-threaded.asyncify.wasm' : 'ort-wasm-simd-threaded.wasm';
    // Fetch separately to report download progress instead of presenting it as
    // model compilation. ORT reads the identical versioned URL from HTTP cache.
    progress({phase: 'download', progress: .9, title: modelTitle, detail: 'stays_on_device'});
    await download(`${ASSETS.runtime}/${binary}`, (fraction, receivedBytes) => progress({phase: 'download',
      progress: .9 + (fraction ?? 0) * .1, receivedBytes, title: modelTitle, detail: 'stays_on_device'}), false);
    progress({phase: 'initialize', title: 'initializing', detail: 'initializing_detail'});
    const sessionStarted = performance.now();
    session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: [backend], graphOptimizationLevel: 'disabled',
      executionMode: 'sequential', enableCpuMemArena: true, enableMemPattern: true,
      ...(variant?.requires?.gpuOnly ? {extra: {session: {disable_cpu_ep_fallback: '1'}}} : {}),
      ...(execution.profile ? {enableProfiling: true} : {}),
    });
    timings.sessionMs = performance.now() - sessionStarted;
    timings.prepareMs = performance.now() - started;
    if (backend === 'webgpu' && ort.env.webgpu.device) {
      const device = ort.env.webgpu.device;
      if (variant && !gpuSupportsVariant(variant, {limits: device.limits, features: [...device.features]})) {
        throw new PhotoError('gpu', 'err_engine_start');
      }
      timings.gpu = {limits: {maxBufferSize: device.limits.maxBufferSize, maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize},
        features: [...device.features], info: {vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, device: adapter.info?.device}};
    }
    progress({operation: 'initialize', completed: 1, backend, effectiveThreads: ort.env.wasm.numThreads,
      requestedThreads: execution.threads || 1});
  } catch (error) {
    try { await session?.release(); } catch { /* Worker termination also reclaims a lost device. */ }
    if (error.code === 'download') throw error;
    throw new PhotoError(backend === 'webgpu' ? 'gpu' : 'runtime', 'err_engine_start', undefined, error);
  }
  return {
    backend,
    modelKey: variant ? variantKey(variant, backend) : `${modelKind}-${scale}`,
    tileSize, timings,
    threads: ort.env.wasm.numThreads,
    async run(values) {
      const input = new ort.Tensor('float32', values, [1, 3, face ? 512 : tileSize, face ? 512 : tileSize]);
      let output;
      try {
        const outputs = await session.run({[session.inputNames[0]]: input});
        output = outputs[session.outputNames[0]];
        if (output.dims.join(',') !== `1,3,${modelSide},${modelSide}`) throw new Error('Unexpected output dimensions');
        return tensorPixels(await output.getData(), outputSide, modelSide / outputSide);
      } catch (error) {
        throw new PhotoError(backend === 'webgpu' ? 'gpu' : 'runtime', 'err_processing', undefined, error);
      } finally { input.dispose(); output?.dispose(); }
    },
    async release() { if (execution.profile) session.endProfiling(); await session.release(); },
  };
}

export async function download(url, onProgress = () => {}, retain = true) {
  let response;
  try { response = await fetch(url); } catch (error) { throw new PhotoError('download', 'err_download', undefined, error); }
  if (!response.ok) throw new PhotoError('download', 'err_unavailable', undefined, new Error(`Model download HTTP ${response.status}`));
  // A compressed response's Content-Length counts wire bytes, while fetch
  // exposes decoded bytes. Without a comparable total, show an indeterminate
  // download until it really completes instead of inventing a percentage.
  const encoding = response.headers.get('content-encoding');
  const total = encoding && encoding !== 'identity' ? 0 : Number(response.headers.get('content-length'));
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress(1, bytes.length);
    return retain ? bytes : undefined;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      received += value.length;
      if (retain) chunks.push(value);
      onProgress(total > 0 ? Math.min(1, received / total) : undefined, received);
    }
  } catch (error) { throw new PhotoError('download', 'err_interrupted', undefined, error); }
  onProgress(1, received);
  if (!retain) return;
  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function downloadFace(onProgress) {
  const bytes = new Uint8Array(ASSETS.faceModel.bytes);
  let offset = 0;
  try {
    for (const part of ASSETS.faceModel.parts) {
      const response = await fetch(part.url);
      if (!response.ok || !response.body) throw new Error(`Model part download HTTP ${response.status}; body ${Boolean(response.body)}`);
      const reader = response.body.getReader();
      let received = 0;
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (received + value.length > part.bytes) throw new Error('Oversized model part');
        bytes.set(value, offset + received);
        received += value.length;
        onProgress((offset + received) / bytes.length, offset + received);
      }
      if (received !== part.bytes) throw new Error('Incomplete model part');
      offset += received;
    }
    onProgress(1, offset);
    return bytes;
  } catch (error) { throw new PhotoError('download', 'err_face_download', undefined, error); }
}
