import {ASSETS} from './assets.generated.js';
import {PhotoError, SCALE, TILE_SIZE} from './capability.js';
import {resolveModelAsset} from './model-selection.js';
import {tensorPixels} from './tile-pipeline.js';

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
  let model;
  try { model = face ? undefined : resolveModelAsset(ASSETS.models, modelKind, scale, backend); }
  catch { throw new PhotoError('runtime', 'err_engine_start'); }
  const modelTitle = face ? 'loading_faces' : 'loading_upscaler';
  const outputSide = face ? 512 : TILE_SIZE * scale;
  let session;
  let ort;
  try {
    progress({phase: 'initialize', title: 'loading_engine', detail: 'loading_engine_detail'});
    if (backend === 'webgpu') await requireGpuAdapter();
    ort = await importOrt(backend, execution);
    progress({phase: 'download', progress: 0, title: modelTitle, detail: 'loading_cached_detail'});
    // One download indicator: the model takes 90%, the engine the final 10%.
    const report = (fraction, receivedBytes) => progress({phase: 'download',
      progress: fraction === undefined ? undefined : fraction * .9, receivedBytes, title: modelTitle, detail: 'stays_on_device'});
    const modelBytes = face ? await downloadFace(report) : await download(model, report);
    const binary = backend === 'webgpu' ? 'ort-wasm-simd-threaded.asyncify.wasm' : 'ort-wasm-simd-threaded.wasm';
    // Fetch separately to report download progress instead of presenting it as
    // model compilation. ORT reads the identical versioned URL from HTTP cache.
    progress({phase: 'download', progress: .9, title: modelTitle, detail: 'stays_on_device'});
    await download(`${ASSETS.runtime}/${binary}`, (fraction, receivedBytes) => progress({phase: 'download',
      progress: .9 + (fraction ?? 0) * .1, receivedBytes, title: modelTitle, detail: 'stays_on_device'}), false);
    progress({phase: 'initialize', title: 'initializing', detail: 'initializing_detail'});
    session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: [backend], graphOptimizationLevel: 'disabled',
      executionMode: 'sequential', enableCpuMemArena: true, enableMemPattern: true,
    });
    progress({operation: 'initialize', completed: 1, backend, effectiveThreads: ort.env.wasm.numThreads,
      requestedThreads: execution.threads || 1});
  } catch (error) {
    if (error.code === 'download') throw error;
    throw new PhotoError(backend === 'webgpu' ? 'gpu' : 'runtime', 'err_engine_start');
  }
  return {
    backend,
    threads: ort.env.wasm.numThreads,
    async run(values) {
      const input = new ort.Tensor('float32', values, [1, 3, face ? 512 : TILE_SIZE, face ? 512 : TILE_SIZE]);
      let output;
      try {
        const outputs = await session.run({[session.inputNames[0]]: input});
        output = outputs[session.outputNames[0]];
        if (output.dims.join(',') !== `1,3,${outputSide},${outputSide}`) throw new Error('Unexpected output dimensions');
        return tensorPixels(await output.getData(), outputSide);
      } catch {
        throw new PhotoError(backend === 'webgpu' ? 'gpu' : 'runtime', 'err_processing');
      } finally { input.dispose(); output?.dispose(); }
    },
    async release() { await session.release(); },
  };
}

export async function download(url, onProgress = () => {}, retain = true) {
  let response;
  try { response = await fetch(url); } catch { throw new PhotoError('download', 'err_download'); }
  if (!response.ok) throw new PhotoError('download', 'err_unavailable');
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
  } catch { throw new PhotoError('download', 'err_interrupted'); }
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
      if (!response.ok || !response.body) throw new Error('Missing model part');
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
  } catch { throw new PhotoError('download', 'err_face_download'); }
}
