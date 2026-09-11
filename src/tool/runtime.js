import {ASSETS} from './assets.generated.js';
import {PhotoError, SCALE, TILE_SIZE} from './capability.js';
import {tensorPixels} from './tile-pipeline.js';

export async function loadRuntime(forceCpu, progress, face = false, scale = SCALE) {
  let backend = 'wasm';
  if (!forceCpu && navigator.gpu) {
    try { if (await navigator.gpu.requestAdapter()) backend = 'webgpu'; } catch { /* CPU remains available. */ }
  }
  const engine = backend === 'webgpu' ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs';
  const model = face ? undefined : ASSETS.models[scale][backend === 'webgpu' ? 'gpu' : 'cpu'];
  const modelTitle = face ? 'loading_faces' : 'loading_upscaler';
  const outputSide = face ? 512 : TILE_SIZE * scale;
  let session;
  let ort;
  try {
    progress({phase: 'download', title: modelTitle, detail: 'loading_cached_detail'});
    ort = await import(/* @vite-ignore */ `${ASSETS.runtime}/${engine}`);
    ort.env.wasm.wasmPaths = `${ASSETS.runtime}/`;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
    const report = fraction => progress({phase: 'download', progress: fraction * .45, title: modelTitle, detail: 'stays_on_device'});
    const modelBytes = face ? await downloadFace(report) : await download(model, report);
    const binary = backend === 'webgpu' ? 'ort-wasm-simd-threaded.asyncify.wasm' : 'ort-wasm-simd-threaded.wasm';
    // Fetch separately to report download progress instead of presenting it as
    // model compilation. ORT reads the identical versioned URL from HTTP cache.
    await download(`${ASSETS.runtime}/${binary}`, fraction => progress({phase: 'download', progress: .45 + fraction * .55, title: 'loading_engine', detail: 'loading_engine_detail'}), false);
    progress({phase: 'initialize', title: 'initializing', detail: 'initializing_detail'});
    session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: [backend], graphOptimizationLevel: 'disabled',
      executionMode: 'sequential', enableCpuMemArena: true, enableMemPattern: true,
    });
  } catch (error) {
    if (error.code === 'download') throw error;
    throw new PhotoError(backend === 'webgpu' ? 'gpu' : 'runtime', 'err_engine_start');
  }
  return {
    backend,
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

async function download(url, onProgress, retain = true) {
  let response;
  try { response = await fetch(url); } catch { throw new PhotoError('download', 'err_download'); }
  if (!response.ok) throw new PhotoError('download', 'err_unavailable');
  const total = Number(response.headers.get('content-length'));
  if (!response.body) return retain ? new Uint8Array(await response.arrayBuffer()) : undefined;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      received += value.length;
      if (retain) chunks.push(value);
      onProgress(total > 0 ? Math.min(1, received / total) : 0);
    }
  } catch { throw new PhotoError('download', 'err_interrupted'); }
  onProgress(1);
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
        onProgress((offset + received) / bytes.length);
      }
      if (received !== part.bytes) throw new Error('Incomplete model part');
      offset += received;
    }
    return bytes;
  } catch { throw new PhotoError('download', 'err_face_download'); }
}
