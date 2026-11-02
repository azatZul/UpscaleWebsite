import {PhotoError} from './capability.js';

let adapterCheck;
export function requireGpuAdapter() {
  // YuNet and GFPGAN share one worker. Probe before any engine/model downloads,
  // and retain the result for the rest of that worker's lifetime.
  return adapterCheck ||= Promise.resolve().then(async () => {
    try { if (await globalThis.navigator?.gpu?.requestAdapter()) return; } catch { /* Report a backend failure below. */ }
    throw new PhotoError('gpu', 'err_engine_start');
  });
}

// The face finder shares this choice, so both ONNX models in a face pass load
// the same engine build instead of two separate wasm heaps.
export async function selectBackend(forceCpu) {
  if (!forceCpu) {
    try { await requireGpuAdapter(); return 'webgpu'; } catch { /* CPU remains available. */ }
  }
  return 'wasm';
}

