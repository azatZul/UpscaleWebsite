import * as ort from 'onnxruntime-web/all';
import {FaceLandmarker, FilesetResolver} from '@mediapipe/tasks-vision';
import {isAppleMobile} from '../tool/capability.js';

const MODEL_URLS = {
  upscale: {
    // The CPU-ready file starts much faster in WASM, while the plain graph is
    // portable to WebGPU. Keeping both avoids baking CPU-only layout changes
    // into the GPU path.
    wasm: '/models/normal_2x_web.ort',
    webgpu: '/models/normal_2x_web.onnx',
    webgl: '/models/normal_2x_webgl.onnx',
  },
  face: '/models/face_512.onnx',
};

let configured = false;
let faceLandmarkerPromise;

export function configureRuntime() {
  if (configured) return;
  configured = true;
  ort.env.wasm.wasmPaths = '/assets/lab/ort/';
  ort.env.wasm.proxy = false;
  // A single WASM worker is the safest baseline across Safari and embedded
  // Chromium browsers. Multi-threading is an optional speed-up once a browser
  // proves it can start the runtime reliably.
  const requestedThreads = Number(new URLSearchParams(location.search).get('threads'));
  ort.env.wasm.numThreads = crossOriginIsolated && requestedThreads > 1
    ? Math.max(1, Math.min(4, requestedThreads, navigator.hardwareConcurrency || 2))
    : 1;
  ort.env.logLevel = 'warning';
}

export function hardwareSummary() {
  return {
    webgpu: Boolean(navigator.gpu),
    crossOriginIsolated,
    threads: ort.env.wasm.numThreads,
    logicalCores: navigator.hardwareConcurrency || null,
    deviceMemoryGb: navigator.deviceMemory || null,
  };
}

async function fetchModel(url, onProgress = () => {}) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url} (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress(1, buffer.byteLength, buffer.byteLength);
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(total ? received / total : 0, received, total);
  }
  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress(1, received, total || received);
  return result;
}

function providerOrder(requested, kind) {
  // Avoid the observed iPhone face/WebGPU crash before session creation.
  // Explicit benchmark overrides still allow testing future runtime fixes.
  if (requested === 'auto' && kind === 'face' && isAppleMobile(navigator)) return ['wasm'];
  if (requested === 'wasm') return ['wasm'];
  if (requested === 'webgl') return ['webgl'];
  if (requested === 'webgpu') {
    if (!navigator.gpu) throw new Error('This browser does not make its GPU available to web pages.');
    return ['webgpu'];
  }
  return navigator.gpu ? ['webgpu'] : ['wasm'];
}

export async function createModelSession(kind, requestedBackend = 'auto', onProgress = () => {}) {
  configureRuntime();
  // Lets a benchmark run compare ORT graph optimization levels without a rebuild.
  const optLevel = new URLSearchParams(location.search).get('opt') || 'disabled';
  const modelUrls = MODEL_URLS[kind];
  if (!modelUrls) throw new Error(`Unknown model ${kind}`);
  const providers = providerOrder(requestedBackend, kind);
  const url = typeof modelUrls === 'string' ? modelUrls : modelUrls[providers[0]];

  const downloadStarted = performance.now();
  const bytes = await fetchModel(url, onProgress);
  const downloadMs = performance.now() - downloadStarted;
  // `warmup=1` creates and discards a session first, so the timing below
  // measures a second session in the same page rather than ORT's one-time init.
  if (new URLSearchParams(location.search).get('warmup') === '1') {
    const throwaway = await ort.InferenceSession.create(bytes, {
      executionProviders: providers,
      graphOptimizationLevel: optLevel,
      executionMode: 'sequential',
      enableCpuMemArena: true,
      enableMemPattern: true,
    });
    throwaway.release();
  }
  const compileStarted = performance.now();
  let session;
  let backend = providers[0];
  try {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: providers,
      graphOptimizationLevel: optLevel,
      executionMode: 'sequential',
      enableCpuMemArena: true,
      enableMemPattern: true,
    });
  } catch (error) {
    if (requestedBackend !== 'auto' || providers[0] === 'wasm') throw error;
    backend = 'wasm';
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: optLevel,
      executionMode: 'sequential',
      enableCpuMemArena: true,
      enableMemPattern: true,
    });
  }
  const compileMs = performance.now() - compileStarted;
  return {
    session,
    backend,
    modelBytes: bytes.byteLength,
    downloadMs,
    compileMs,
    release() {
      session.release();
    },
  };
}

export function makeTensor(values, dimensions) {
  return new ort.Tensor('float32', values, dimensions);
}

export async function getFaceLandmarker(useGpu = true) {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks('/assets/lab/mediapipe');
      const common = {
        baseOptions: {
          modelAssetPath: '/models/face_landmarker.task',
          delegate: useGpu ? 'GPU' : 'CPU',
        },
        runningMode: 'IMAGE',
        numFaces: 8,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      };
      try {
        return await FaceLandmarker.createFromOptions(vision, common);
      } catch (error) {
        if (!useGpu) throw error;
        return FaceLandmarker.createFromOptions(vision, {
          ...common,
          baseOptions: {...common.baseOptions, delegate: 'CPU'},
        });
      }
    })();
  }
  return faceLandmarkerPromise;
}
