import {createModelSession, getFaceLandmarker, makeTensor} from './runtime.js';

const TILE_SIZE = 256;
const TILE_OVERLAP = 16;
const TILE_CORE = TILE_SIZE - TILE_OVERLAP * 2;
const SCALE = 2;
const FACE_SIZE = 512;
const MAX_OUTPUT_PIXELS = 40_000_000;
const MAX_CANVAS_SIDE = 16_384;

const IDEAL_POINTS = [
  {x: 193, y: 240},
  {x: 319, y: 240},
  {x: 256, y: 314},
  {x: 201, y: 371},
  {x: 311, y: 371},
];

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

const IDEAL_PERIMETER = [IDEAL_POINTS[0], IDEAL_POINTS[1], IDEAL_POINTS[4], IDEAL_POINTS[3], IDEAL_POINTS[0]]
  .slice(0, -1)
  .reduce((sum, point, index) => sum + distance(point, [IDEAL_POINTS[1], IDEAL_POINTS[4], IDEAL_POINTS[3], IDEAL_POINTS[0]][index]), 0);

function canvasFor(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function decodeFile(file) {
  const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
  const canvas = canvasFor(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.drawImage(bitmap, 0, 0);
  return {
    bitmap,
    imageData: context.getImageData(0, 0, bitmap.width, bitmap.height),
    width: bitmap.width,
    height: bitmap.height,
  };
}

function assertSafeOutput(width, height, scale = SCALE) {
  const outputWidth = width * scale;
  const outputHeight = height * scale;
  if (outputWidth > MAX_CANVAS_SIDE || outputHeight > MAX_CANVAS_SIDE || outputWidth * outputHeight > MAX_OUTPUT_PIXELS) {
    throw new Error('This photo would create an output that is too large for a browser tab. Try a photo under 10 megapixels.');
  }
}

export function imageDataToTensor(imageData) {
  const {width, height, data} = imageData;
  const plane = width * height;
  const values = new Float32Array(plane * 3);
  for (let index = 0, pixel = 0; index < plane; index += 1, pixel += 4) {
    values[index] = data[pixel] / 255;
    values[plane + index] = data[pixel + 1] / 255;
    values[plane * 2 + index] = data[pixel + 2] / 255;
  }
  return values;
}

async function runModel(session, imageData) {
  const values = imageDataToTensor(imageData);
  const input = makeTensor(values, [1, 3, imageData.height, imageData.width]);
  const started = performance.now();
  const outputs = await session.run({[session.inputNames[0]]: input});
  const inferenceMs = performance.now() - started;
  const output = outputs[session.outputNames[0]];
  const outputValues = typeof output.getData === 'function' ? await output.getData() : output.data;
  const dimensions = output.dims;
  const result = {
    values: new Float32Array(outputValues),
    width: dimensions[3],
    height: dimensions[2],
    inferenceMs,
  };
  input.dispose?.();
  output.dispose?.();
  return result;
}

function tileOrigins(length) {
  return Array.from({length: Math.ceil(length / TILE_CORE)}, (_, index) => index * TILE_CORE);
}

function fillTile(source, sourceWidth, sourceHeight, tileX, tileY) {
  const plane = TILE_SIZE * TILE_SIZE;
  const values = new Float32Array(plane * 3);
  const pixels = source.data;
  for (let y = 0; y < TILE_SIZE; y += 1) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, tileY + y));
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, tileX + x));
      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
      const targetIndex = y * TILE_SIZE + x;
      values[targetIndex] = pixels[sourceIndex] / 255;
      values[plane + targetIndex] = pixels[sourceIndex + 1] / 255;
      values[plane * 2 + targetIndex] = pixels[sourceIndex + 2] / 255;
    }
  }
  return values;
}

function tensorToRgba(values, side) {
  const plane = side * side;
  const pixels = new Uint8ClampedArray(plane * 4);
  for (let index = 0, pixel = 0; index < plane; index += 1, pixel += 4) {
    pixels[pixel] = Math.round(Math.max(0, Math.min(1, values[index])) * 255);
    pixels[pixel + 1] = Math.round(Math.max(0, Math.min(1, values[plane + index])) * 255);
    pixels[pixel + 2] = Math.round(Math.max(0, Math.min(1, values[plane * 2 + index])) * 255);
    pixels[pixel + 3] = 255;
  }
  return pixels;
}

function blendPixel(destination, destinationIndex, source, sourceIndex, weight) {
  const inverse = 1 - weight;
  destination[destinationIndex] = Math.round(destination[destinationIndex] * inverse + source[sourceIndex] * weight);
  destination[destinationIndex + 1] = Math.round(destination[destinationIndex + 1] * inverse + source[sourceIndex + 1] * weight);
  destination[destinationIndex + 2] = Math.round(destination[destinationIndex + 2] * inverse + source[sourceIndex + 2] * weight);
  destination[destinationIndex + 3] = 255;
}

function blendTile({
  destination,
  destinationStride,
  destinationX,
  destinationY,
  tile,
  outputSide,
  tileX,
  tileY,
  fromX,
  toX,
  fromY,
  toY,
  leftSeam,
}) {
  const originX = fromX * SCALE;
  const originY = fromY * SCALE;
  const regionWidth = (toX - fromX) * SCALE;
  const regionHeight = (toY - fromY) * SCALE;
  const modelOriginX = originX - tileX * SCALE;
  const modelOriginY = originY - tileY * SCALE;
  const blendedColumns = Math.min(leftSeam, regionWidth);

  for (let y = 0; y < regionHeight; y += 1) {
    const modelRow = ((modelOriginY + y) * outputSide + modelOriginX) * 4;
    const destinationRow = (((originY + y - destinationY) * destinationStride) + (originX - destinationX)) * 4;
    for (let x = 0; x < regionWidth; x += 1) {
      const sourceIndex = modelRow + x * 4;
      const destinationIndex = destinationRow + x * 4;
      if (x < blendedColumns) {
        blendPixel(destination, destinationIndex, tile, sourceIndex, (x + 0.5) / leftSeam);
      } else {
        destination[destinationIndex] = tile[sourceIndex];
        destination[destinationIndex + 1] = tile[sourceIndex + 1];
        destination[destinationIndex + 2] = tile[sourceIndex + 2];
        destination[destinationIndex + 3] = 255;
      }
    }
  }
}

export async function upscaleTiled(source, session, onProgress = () => {}) {
  assertSafeOutput(source.width, source.height);
  const outputWidth = source.width * SCALE;
  const outputHeight = source.height * SCALE;
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  const xOrigins = tileOrigins(source.width);
  const yOrigins = tileOrigins(source.height);
  const tileCount = xOrigins.length * yOrigins.length;
  const seam = TILE_OVERLAP * 2 * SCALE;
  let completed = 0;
  let inferenceMs = 0;

  for (let rowIndex = 0; rowIndex < yOrigins.length; rowIndex += 1) {
    const coreY = yOrigins[rowIndex];
    const coreHeight = Math.min(TILE_CORE, source.height - coreY);
    const topContext = rowIndex === 0 ? 0 : TILE_OVERLAP;
    const tileY = coreY - topContext;
    const rowFrom = tileY;
    const stagedTo = rowIndex === 0 ? rowFrom : Math.min(coreY + TILE_OVERLAP, source.height);
    const rowTo = Math.min(coreY + coreHeight + TILE_OVERLAP, source.height);
    const seamRow = stagedTo > rowFrom ? new Uint8ClampedArray(outputWidth * seam * 4) : null;

    for (let columnIndex = 0; columnIndex < xOrigins.length; columnIndex += 1) {
      const coreX = xOrigins[columnIndex];
      const coreWidth = Math.min(TILE_CORE, source.width - coreX);
      const leftContext = columnIndex === 0 ? 0 : TILE_OVERLAP;
      const tileX = coreX - leftContext;
      const inputValues = fillTile(source.imageData, source.width, source.height, tileX, tileY);
      const input = makeTensor(inputValues, [1, 3, TILE_SIZE, TILE_SIZE]);
      const started = performance.now();
      const outputs = await session.run({[session.inputNames[0]]: input});
      inferenceMs += performance.now() - started;
      const result = outputs[session.outputNames[0]];
      const resultValues = typeof result.getData === 'function' ? await result.getData() : result.data;
      const outputSide = result.dims[2];
      const converted = tensorToRgba(resultValues, outputSide);
      input.dispose?.();
      result.dispose?.();

      const columnFrom = tileX;
      const columnTo = Math.min(coreX + coreWidth + TILE_OVERLAP, source.width);
      const leftSeam = columnIndex === 0 ? 0 : seam;
      if (stagedTo > rowFrom) {
        blendTile({
          destination: seamRow,
          destinationStride: outputWidth,
          destinationX: 0,
          destinationY: rowFrom * SCALE,
          tile: converted,
          outputSide,
          tileX,
          tileY,
          fromX: columnFrom,
          toX: columnTo,
          fromY: rowFrom,
          toY: stagedTo,
          leftSeam,
        });
      }
      if (rowTo > stagedTo) {
        blendTile({
          destination: output,
          destinationStride: outputWidth,
          destinationX: 0,
          destinationY: 0,
          tile: converted,
          outputSide,
          tileX,
          tileY,
          fromX: columnFrom,
          toX: columnTo,
          fromY: stagedTo,
          toY: rowTo,
          leftSeam,
        });
      }
      completed += 1;
      onProgress(completed / tileCount, {completed, tileCount, inferenceMs});
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (seamRow) {
      const bandTop = rowFrom * SCALE;
      const bandRows = (stagedTo - rowFrom) * SCALE;
      for (let row = 0; row < bandRows; row += 1) {
        const weight = (row + 0.5) / seam;
        for (let column = 0; column < outputWidth; column += 1) {
          const index = ((bandTop + row) * outputWidth + column) * 4;
          const seamIndex = (row * outputWidth + column) * 4;
          blendPixel(output, index, seamRow, seamIndex, weight);
        }
      }
    }
  }
  return {imageData: new ImageData(output, outputWidth, outputHeight), inferenceMs, tileCount};
}

function pointAverage(landmarks, indices, width, height) {
  return {
    x: indices.reduce((sum, index) => sum + landmarks[index].x, 0) / indices.length * width,
    y: indices.reduce((sum, index) => sum + landmarks[index].y, 0) / indices.length * height,
  };
}

function faceGeometry(landmarks, width, height) {
  const eyes = [
    pointAverage(landmarks, [33, 133], width, height),
    pointAverage(landmarks, [362, 263], width, height),
  ].sort((a, b) => a.x - b.x);
  const mouths = [
    pointAverage(landmarks, [61], width, height),
    pointAverage(landmarks, [291], width, height),
  ].sort((a, b) => a.x - b.x);
  const points = [eyes[0], eyes[1], pointAverage(landmarks, [1], width, height), mouths[0], mouths[1]];
  const perimeter = distance(points[0], points[1]) + distance(points[1], points[4]) + distance(points[4], points[3]) + distance(points[3], points[0]);
  const eyeCenter = {x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2};
  const mouthCenter = {x: (points[3].x + points[4].x) / 2, y: (points[3].y + points[4].y) / 2};
  const dx = mouthCenter.x - eyeCenter.x;
  const dy = mouthCenter.y - eyeCenter.y;
  const lineLength = Math.max(0.001, Math.hypot(dx, dy));
  const noseDistance = Math.abs(
    dy * points[2].x - dx * points[2].y + mouthCenter.x * eyeCenter.y - mouthCenter.y * eyeCenter.x,
  ) / lineLength;
  const cross = dx * (points[2].y - eyeCenter.y) - dy * (points[2].x - eyeCenter.x);
  const noseOffset = noseDistance * (cross > 0 ? -1 : 1) * FACE_SIZE * 5 / perimeter;
  if (distance(points[0], points[1]) <= 8 || perimeter >= 1500 || Math.abs(noseOffset) >= 140) return null;

  const sourceCenter = centroid(points);
  const targetCenter = centroid(IDEAL_POINTS);
  const scale = IDEAL_PERIMETER / perimeter;
  const sourceAngle = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
  const targetAngle = Math.atan2(IDEAL_POINTS[1].y - IDEAL_POINTS[0].y, IDEAL_POINTS[1].x - IDEAL_POINTS[0].x);
  const rotation = targetAngle - sourceAngle;
  const a = scale * Math.cos(rotation);
  const b = scale * Math.sin(rotation);
  const c = -b;
  const d = a;
  const e = targetCenter.x - a * sourceCenter.x + b * sourceCenter.y;
  const f = targetCenter.y - b * sourceCenter.x - a * sourceCenter.y;
  return {a, b, c, d, e, f};
}

function alignedFace(bitmap, transform) {
  const canvas = canvasFor(FACE_SIZE, FACE_SIZE);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.fillStyle = '#000';
  context.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  context.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  context.drawImage(bitmap, 0, 0);
  context.resetTransform();
  return context.getImageData(0, 0, FACE_SIZE, FACE_SIZE);
}

function inverseTransform(transform, scale) {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  return {
    a: transform.d / determinant * scale,
    b: -transform.b / determinant * scale,
    c: -transform.c / determinant * scale,
    d: transform.a / determinant * scale,
    e: (transform.c * transform.f - transform.d * transform.e) / determinant * scale,
    f: (transform.b * transform.e - transform.a * transform.f) / determinant * scale,
  };
}

function featheredFace(imageData) {
  const canvas = canvasFor(FACE_SIZE, FACE_SIZE);
  const context = canvas.getContext('2d');
  context.putImageData(imageData, 0, 0);
  context.globalCompositeOperation = 'destination-in';
  const mask = context.createRadialGradient(256, 256, 220, 256, 256, 255);
  mask.addColorStop(0, 'rgba(255,255,255,1)');
  mask.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = mask;
  context.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  context.globalCompositeOperation = 'source-over';
  return canvas;
}

function tensorResultToImageData(result) {
  const pixels = tensorToRgba(result.values, result.width);
  return new ImageData(pixels, result.width, result.height);
}

async function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode the result.')), 'image/jpeg', 0.96);
  });
}

export async function processPhoto(source, mode, backend, onStatus = () => {}) {
  assertSafeOutput(source.width, source.height);
  const totalStarted = performance.now();
  const faces = [];
  let faceInferenceMs = 0;
  let faceModelLoadMs = 0;

  if (mode === 'face') {
    onStatus({phase: 'faces', progress: 0.02, title: 'Finding faces', detail: 'Face detection also runs on this device.'});
    const detector = await getFaceLandmarker(backend !== 'wasm');
    const detection = detector.detect(source.bitmap);
    const transforms = detection.faceLandmarks
      .map((landmarks) => faceGeometry(landmarks, source.width, source.height))
      .filter(Boolean);
    if (transforms.length) {
      onStatus({phase: 'face-model', progress: 0.05, title: 'Loading face enhancement', detail: 'The 86 MB GFPGAN model is cached after its first download.'});
      const faceRuntime = await createModelSession('face', backend, (progress, received, total) => {
        const megabytes = (received / 1_000_000).toFixed(1);
        const totalText = total ? ` of ${(total / 1_000_000).toFixed(1)} MB` : ' MB';
        onStatus({phase: 'face-model', progress: 0.05 + progress * 0.2, title: 'Loading face enhancement', detail: `${megabytes}${totalText}`});
      });
      faceModelLoadMs = faceRuntime.downloadMs + faceRuntime.compileMs;
      try {
        for (let index = 0; index < transforms.length; index += 1) {
          onStatus({phase: 'face-run', progress: 0.25 + (index / transforms.length) * 0.2, title: `Enhancing face ${index + 1} of ${transforms.length}`, detail: `Using ${faceRuntime.backend === 'webgpu' ? 'the GPU' : 'the CPU'}.`});
          const result = await runModel(faceRuntime.session, alignedFace(source.bitmap, transforms[index]));
          faceInferenceMs += result.inferenceMs;
          faces.push({imageData: tensorResultToImageData(result), transform: transforms[index]});
        }
      } finally {
        faceRuntime.release();
      }
    }
  }

  onStatus({phase: 'upscale-model', progress: mode === 'face' ? 0.48 : 0.02, title: 'Loading Regular 2×', detail: 'The small upscaling model is downloaded once and cached.'});
  const upscaleRuntime = await createModelSession('upscale', backend, (progress, received, total) => {
    const start = mode === 'face' ? 0.48 : 0.02;
    const span = mode === 'face' ? 0.08 : 0.12;
    const megabytes = (received / 1_000_000).toFixed(1);
    const totalText = total ? ` of ${(total / 1_000_000).toFixed(1)} MB` : ' MB';
    onStatus({phase: 'upscale-model', progress: start + progress * span, title: 'Loading Regular 2×', detail: `${megabytes}${totalText}`});
  });

  let upscaled;
  try {
    upscaled = await upscaleTiled(source, upscaleRuntime.session, (progress, details) => {
      const start = mode === 'face' ? 0.56 : 0.14;
      const span = mode === 'face' ? 0.4 : 0.82;
      onStatus({phase: 'upscale', progress: start + progress * span, title: `Upscaling tile ${details.completed} of ${details.tileCount}`, detail: `Using ${upscaleRuntime.backend === 'webgpu' ? 'the GPU' : 'the CPU'} with overlapping tiles.`});
    });
  } finally {
    upscaleRuntime.release();
  }

  const canvas = canvasFor(upscaled.imageData.width, upscaled.imageData.height);
  const context = canvas.getContext('2d');
  context.putImageData(upscaled.imageData, 0, 0);
  for (const face of faces) {
    const transform = inverseTransform(face.transform, SCALE);
    context.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
    context.drawImage(featheredFace(face.imageData), 0, 0);
    context.resetTransform();
  }
  onStatus({phase: 'encode', progress: 0.98, title: 'Preparing the download', detail: 'Encoding the finished image locally.'});
  const blob = await canvasToBlob(canvas);
  onStatus({phase: 'complete', progress: 1, title: 'Finished', detail: 'The photo was never uploaded.'});
  return {
    blob,
    canvas,
    width: canvas.width,
    height: canvas.height,
    backend: upscaleRuntime.backend,
    faceCount: faces.length,
    tileCount: upscaled.tileCount,
    inferenceMs: upscaled.inferenceMs + faceInferenceMs,
    totalMs: performance.now() - totalStarted,
    modelLoadMs: upscaleRuntime.downloadMs + upscaleRuntime.compileMs + faceModelLoadMs,
  };
}

export const internals = {
  runModel,
  tensorResultToImageData,
};
