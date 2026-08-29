import {createModelSession, hardwareSummary} from './runtime.js';
import {imageDataToTensor} from './image_pipeline.js';
import {makeTensor} from './runtime.js';

const CORPORA = {
  upscale: '/benchmarks/ios/normal_2x/corpus.json',
  face: '/benchmarks/ios/face/corpus.json',
};

const THRESHOLDS = {
  psnrMin: 42,
  ssimMin: 0.995,
  maeMax: 0.008,
  edgeMaeMax: 0.018,
};

function percentile(values, percentage) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentage;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
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

function tensorToRgb(values, width, height) {
  const plane = width * height;
  const result = new Float32Array(plane * 3);
  for (let index = 0; index < plane; index += 1) {
    result[index * 3] = Math.max(0, Math.min(1, values[index]));
    result[index * 3 + 1] = Math.max(0, Math.min(1, values[plane + index]));
    result[index * 3 + 2] = Math.max(0, Math.min(1, values[plane * 2 + index]));
  }
  return result;
}

function imageDataToRgb(imageData) {
  const result = new Float32Array(imageData.width * imageData.height * 3);
  for (let pixel = 0, output = 0; pixel < imageData.data.length; pixel += 4, output += 3) {
    result[output] = imageData.data[pixel] / 255;
    result[output + 1] = imageData.data[pixel + 1] / 255;
    result[output + 2] = imageData.data[pixel + 2] / 255;
  }
  return result;
}

function blockSsim(reference, candidate, width, height) {
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  const block = 8;
  let total = 0;
  let blocks = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    for (let top = 0; top < height; top += block) {
      for (let left = 0; left < width; left += block) {
        const bottom = Math.min(height, top + block);
        const right = Math.min(width, left + block);
        let sumReference = 0;
        let sumCandidate = 0;
        let count = 0;
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const index = (y * width + x) * 3 + channel;
            sumReference += reference[index];
            sumCandidate += candidate[index];
            count += 1;
          }
        }
        const meanReference = sumReference / count;
        const meanCandidate = sumCandidate / count;
        let varianceReference = 0;
        let varianceCandidate = 0;
        let covariance = 0;
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const index = (y * width + x) * 3 + channel;
            const referenceDelta = reference[index] - meanReference;
            const candidateDelta = candidate[index] - meanCandidate;
            varianceReference += referenceDelta ** 2;
            varianceCandidate += candidateDelta ** 2;
            covariance += referenceDelta * candidateDelta;
          }
        }
        const divisor = Math.max(1, count - 1);
        varianceReference /= divisor;
        varianceCandidate /= divisor;
        covariance /= divisor;
        total += ((2 * meanReference * meanCandidate + c1) * (2 * covariance + c2)) /
          ((meanReference ** 2 + meanCandidate ** 2 + c1) * (varianceReference + varianceCandidate + c2));
        blocks += 1;
      }
    }
  }
  return total / blocks;
}

function measure(reference, candidate, width, height) {
  let absolute = 0;
  let squared = 0;
  let maximum = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const difference = Math.abs(reference[index] - candidate[index]);
    absolute += difference;
    squared += difference * difference;
    maximum = Math.max(maximum, difference);
  }
  let edgeAbsolute = 0;
  let edgeCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const right = Math.min(width - 1, x + 1);
      const bottom = Math.min(height - 1, y + 1);
      for (let channel = 0; channel < 3; channel += 1) {
        const index = (y * width + x) * 3 + channel;
        const rightIndex = (y * width + right) * 3 + channel;
        const bottomIndex = (bottom * width + x) * 3 + channel;
        const referenceEdge = Math.hypot(reference[rightIndex] - reference[index], reference[bottomIndex] - reference[index]);
        const candidateEdge = Math.hypot(candidate[rightIndex] - candidate[index], candidate[bottomIndex] - candidate[index]);
        edgeAbsolute += Math.abs(referenceEdge - candidateEdge);
        edgeCount += 1;
      }
    }
  }
  const mse = squared / reference.length;
  return {
    mae: absolute / reference.length,
    rmse: Math.sqrt(mse),
    maxError: maximum,
    psnr: mse === 0 ? 120 : 10 * Math.log10(1 / mse),
    ssim: blockSsim(reference, candidate, width, height),
    edgeMae: edgeAbsolute / edgeCount,
  };
}

function passes(metrics) {
  return metrics.psnr >= THRESHOLDS.psnrMin &&
    metrics.ssim >= THRESHOLDS.ssimMin &&
    metrics.mae <= THRESHOLDS.maeMax &&
    metrics.edgeMae <= THRESHOLDS.edgeMaeMax;
}

async function runOnce(session, inputImage) {
  const input = makeTensor(imageDataToTensor(inputImage), [1, 3, inputImage.height, inputImage.width]);
  const started = performance.now();
  const outputs = await session.run({[session.inputNames[0]]: input});
  const latencyMs = performance.now() - started;
  const output = outputs[session.outputNames[0]];
  const values = typeof output.getData === 'function' ? await output.getData() : output.data;
  const result = {values: new Float32Array(values), width: output.dims[3], height: output.dims[2], latencyMs};
  input.dispose?.();
  output.dispose?.();
  return result;
}

export async function runBenchmark(kind, backend = 'auto', options = {}) {
  const onProgress = options.onProgress || (() => {});
  const benchmarkRuns = options.runs || 1;
  const corpusUrl = CORPORA[kind];
  if (!corpusUrl) throw new Error(`Unknown benchmark ${kind}`);
  const corpus = await (await fetch(corpusUrl)).json();
  const base = corpusUrl.slice(0, corpusUrl.lastIndexOf('/') + 1);
  onProgress(`Loading ${kind === 'face' ? 'GFPGAN' : 'Regular 2×'}…`);
  const runtime = await createModelSession(kind, backend, (progress, received, total) => {
    const text = total ? `${(received / 1_000_000).toFixed(1)} / ${(total / 1_000_000).toFixed(1)} MB` : `${(received / 1_000_000).toFixed(1)} MB`;
    onProgress(`Downloading model: ${text}`);
  });
  const cases = [];
  const latencies = [];
  try {
    const warmupImage = await loadImageData(base + corpus.cases[0].input);
    onProgress('Warming up the browser engine…');
    await runOnce(runtime.session, warmupImage);

    for (let caseIndex = 0; caseIndex < corpus.cases.length; caseIndex += 1) {
      const entry = corpus.cases[caseIndex];
      onProgress(`Case ${caseIndex + 1} of ${corpus.cases.length}: ${entry.name}`);
      const [input, referenceImage] = await Promise.all([
        loadImageData(base + entry.input),
        loadImageData(base + entry.reference),
      ]);
      let output;
      const caseLatencies = [];
      for (let run = 0; run < benchmarkRuns; run += 1) {
        output = await runOnce(runtime.session, input);
        caseLatencies.push(output.latencyMs);
        latencies.push(output.latencyMs);
      }
      if (output.width !== referenceImage.width || output.height !== referenceImage.height) {
        throw new Error(`Output shape mismatch for ${entry.name}`);
      }
      const metrics = measure(
        imageDataToRgb(referenceImage),
        tensorToRgb(output.values, output.width, output.height),
        output.width,
        output.height,
      );
      cases.push({
        name: entry.name,
        latencyMsMedian: percentile(caseLatencies, 0.5),
        metrics,
        passed: passes(metrics),
      });
    }
  } finally {
    runtime.release();
  }

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    model: kind,
    requestedBackend: backend,
    selectedBackend: runtime.backend,
    modelBytes: runtime.modelBytes,
    modelDownloadMs: runtime.downloadMs,
    modelCompileMs: runtime.compileMs,
    benchmarkRunsPerCase: benchmarkRuns,
    reference: 'iOS Core ML PNG corpus',
    coreMlSha256: corpus.coreml_sha256,
    thresholds: THRESHOLDS,
    passed: cases.every((entry) => entry.passed),
    aggregate: {
      caseCount: cases.length,
      latencyMsP50: percentile(latencies, 0.5),
      latencyMsP95: percentile(latencies, 0.95),
      minimumPsnr: Math.min(...cases.map((entry) => entry.metrics.psnr)),
      minimumSsim: Math.min(...cases.map((entry) => entry.metrics.ssim)),
      maximumMae: Math.max(...cases.map((entry) => entry.metrics.mae)),
      maximumEdgeMae: Math.max(...cases.map((entry) => entry.metrics.edgeMae)),
    },
    cases,
    environment: {
      userAgent: navigator.userAgent,
      hardware: hardwareSummary(),
    },
  };
}
