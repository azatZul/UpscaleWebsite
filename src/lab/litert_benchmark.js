import {Tensor, loadAndCompile, loadLiteRt} from '@litertjs/core';
const MODEL_URL = '/models/normal_2x_litert.tflite';
const CORPUS_URL = '/benchmarks/ios/normal_2x/corpus.json';

let liteRtPromise;

async function ensureLiteRt() {
  if (!liteRtPromise) liteRtPromise = loadLiteRt('/assets/lab/litert/');
  return liteRtPromise;
}

async function loadImageData(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load benchmark image ${url}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.drawImage(bitmap, 0, 0);
  const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  return imageData;
}

function measure(reference, candidate) {
  let absolute = 0;
  let squared = 0;
  let maximum = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const difference = Math.abs(reference[index] - Math.max(0, Math.min(1, candidate[index])));
    absolute += difference;
    squared += difference * difference;
    maximum = Math.max(maximum, difference);
  }
  const mae = absolute / reference.length;
  const mse = squared / reference.length;
  const psnr = mse === 0 ? 120 : 10 * Math.log10(1 / mse);
  return {mae, maxError: maximum, psnr, passed: mae <= 0.008 && psnr >= 42};
}

function imageDataToNhwc(imageData) {
  const values = new Float32Array(imageData.width * imageData.height * 3);
  for (let source = 0, target = 0; source < imageData.data.length; source += 4, target += 3) {
    values[target] = imageData.data[source] / 255;
    values[target + 1] = imageData.data[source + 1] / 255;
    values[target + 2] = imageData.data[source + 2] / 255;
  }
  return values;
}

async function runOnce(model, inputImage) {
  const input = new Tensor(imageDataToNhwc(inputImage), [1, inputImage.height, inputImage.width, 3]);
  const started = performance.now();
  const outputs = await model.run(input);
  const output = outputs[0];
  const values = new Float32Array(await output.data());
  const latencyMs = performance.now() - started;
  const dimensions = [...output.type.layout.dimensions];
  input.delete();
  output.delete();
  return {values, dimensions, latencyMs};
}

export async function runLiteRtBenchmark(accelerator = 'webgpu', options = {}) {
  const onProgress = options.onProgress || (() => {});
  const caseLimit = Math.max(1, Math.min(17, options.caseLimit || 1));
  const corpus = await (await fetch(CORPUS_URL)).json();
  const base = CORPUS_URL.slice(0, CORPUS_URL.lastIndexOf('/') + 1);
  onProgress('Loading the Safari-oriented LiteRT runtime…');
  await ensureLiteRt();
  const compileStarted = performance.now();
  const model = await loadAndCompile(MODEL_URL, {accelerator});
  const compileMs = performance.now() - compileStarted;
  const selectedBackend = model.options.accelerator;
  const fullyAccelerated = model.isFullyAccelerated;
  const cases = [];
  try {
    const benchmarkCases = corpus.cases.slice(0, caseLimit);
    const warmup = await loadImageData(base + benchmarkCases[0].input);
    onProgress('Warming up LiteRT…');
    await runOnce(model, warmup);
    for (let index = 0; index < benchmarkCases.length; index += 1) {
      const entry = benchmarkCases[index];
      onProgress(`LiteRT case ${index + 1} of ${benchmarkCases.length}: ${entry.name}`);
      const [input, referenceImage] = await Promise.all([
        loadImageData(base + entry.input),
        loadImageData(base + entry.reference),
      ]);
      const output = await runOnce(model, input);
      const expectedDimensions = [1, referenceImage.height, referenceImage.width, 3];
      if (output.dimensions.some((value, dimension) => value !== expectedDimensions[dimension])) {
        throw new Error(`Unexpected LiteRT output shape ${output.dimensions.join('×')}`);
      }
      const metrics = measure(imageDataToNhwc(referenceImage), output.values);
      cases.push({name: entry.name, latencyMs: output.latencyMs, metrics, passed: metrics.passed});
    }
  } finally {
    model.delete();
  }
  const latencies = cases.map((entry) => entry.latencyMs).sort((a, b) => a - b);
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    model: 'upscale',
    runtime: 'litert',
    requestedBackend: accelerator,
    selectedBackend,
    fullyAccelerated,
    modelCompileMs: compileMs,
    reference: 'iOS Core ML PNG corpus',
    coreMlSha256: corpus.coreml_sha256,
    passed: cases.every((entry) => entry.passed),
    aggregate: {
      caseCount: cases.length,
      latencyMsP50: latencies[Math.floor(latencies.length / 2)],
      minimumPsnr: Math.min(...cases.map((entry) => entry.metrics.psnr)),
      maximumMae: Math.max(...cases.map((entry) => entry.metrics.mae)),
    },
    cases,
    environment: {
      userAgent: navigator.userAgent,
      webgpu: Boolean(navigator.gpu),
      crossOriginIsolated,
    },
  };
}
