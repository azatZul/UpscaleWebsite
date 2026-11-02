import test from 'node:test';
import assert from 'node:assert/strict';

test('GPU preflight rejects missing/null/throwing adapters and caches one probe per worker', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    for (const [index, kind] of ['missing', 'null', 'throw', 'ok'].entries()) {
      let calls = 0;
      Object.defineProperty(globalThis, 'navigator', {configurable: true, value: kind === 'missing' ? {} : {
        gpu: {async requestAdapter() { calls++; if (kind === 'throw') throw Error('blocked'); return kind === 'ok' ? {} : null; }},
      }});
      const runtime = await import(`../../src/tool/gpu-backend.js?preflight=${index}`);
      if (kind === 'ok') {
        await Promise.all([runtime.requireGpuAdapter(), runtime.requireGpuAdapter()]);
        assert.equal(await runtime.selectBackend(false), 'webgpu');
      } else {
        await assert.rejects(runtime.requireGpuAdapter(), {code: 'gpu'});
        await assert.rejects(runtime.requireGpuAdapter(), {code: 'gpu'});
        assert.equal(await runtime.selectBackend(false), 'wasm');
      }
      assert.equal(await runtime.selectBackend(true), 'wasm');
      assert.equal(calls, kind === 'missing' ? 0 : 1);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});
