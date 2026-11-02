import {ASSETS} from './assets.generated.js';
import {errorDetails} from './diagnostics.js';
import {alignmentPoints, alignmentQuality, isAligned, keypointPoints, similarity} from './face-geometry.js';
import {loadRuntime} from './runtime.js';
import {assessPhoto, devicePolicy, faceLimit, isAppleMobile, PhotoError} from './capability.js';
import {cropRegion, detectionSide, headBox} from './face-detect.js';
import {loadFaceFinder} from './face-finder.js';
import {inspectFile} from './image-info.js';
import {fillTransparentSurface, readTransparency} from './transparency.js';
import {workerReporter} from './worker-status.js';
let report;
const status = message => report.status(message);
let busy = false;

// Runs the face model on each transform and returns lossless PNG patches, so
// the page can keep them and hand them to any later worker without detaching.
async function enhance(bitmap, transforms, cpuOnly, onRuntime, hasTransparency, execution) {
  let runtime;
  const canvas = new OffscreenCanvas(512, 512);
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const patches = [];
  try {
    for (let i = 0; i < transforms.length; i++) {
      report.begin('face', {title: 'enhancing_face', detail: 'enhancing_face_detail', params: {current: i + 1, total: transforms.length}, progress: i / transforms.length});
      ctx.resetTransform(); ctx.clearRect(0, 0, 512, 512);
      if (!hasTransparency) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 512, 512); }
      const t = transforms[i]; ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
      ctx.drawImage(bitmap, 0, 0); ctx.resetTransform();
      if (hasTransparency && !fillTransparentSurface(ctx, 512, 512)) { patches.push(null); continue; }
      if (!runtime) {
        runtime = await loadRuntime(cpuOnly, status, true, 2, 'photo', execution); onRuntime(runtime);
      }
      report.begin('face', {title: 'enhancing_face', detail: 'enhancing_face_detail',
        params: {current: i + 1, total: transforms.length}, progress: i / transforms.length});
      const rgba = ctx.getImageData(0, 0, 512, 512).data;
      const plane = 512 * 512;
      const input = new Float32Array(plane * 3);
      // App model includes normalization; input is RGB [0, 1].
      for (let p = 0; p < plane; p++) for (let c = 0; c < 3; c++) input[c * plane + p] = rgba[p * 4 + c] / 255;
      const pixels = await runtime.run(input);
      ctx.putImageData(new ImageData(pixels, 512, 512), 0, 0);
      report.begin('encode', {title: 'enhancing_face', params: {current: i + 1, total: transforms.length}, pixels: 512 * 512});
      patches.push(await canvas.convertToBlob({type: 'image/png'}));
    }
  } finally {
    canvas.width = canvas.height = 1;
  }
  return patches;
}

// Every face YuNet found gets a transform, so the picker can offer it. The
// mesh gives the better one; YuNet's own five points cover a face the mesh
// could not be placed on. Only faces inside the page's limits are "suitable"
// and enhanced without being asked.
async function catalogFaces(bitmap, found, hasTransparency) {
  const {FaceLandmarker, FilesetResolver} = await import(/* @vite-ignore */ `${ASSETS.vision}/vision_bundle.mjs`);
  // MediaPipe's Safari UA check rejects CriOS (no Version/ token), then tries
  // document.createElement inside this worker. An explicit canvas avoids that
  // browser sniff and keeps the landmark graph on the supported worker path.
  const graphCanvas = new OffscreenCanvas(1, 1);
  const landmarker = await FaceLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(`${ASSETS.vision}/wasm`), {
    canvas: graphCanvas,
    baseOptions: {modelAssetPath: ASSETS.faceDetector, delegate: 'CPU'},
    runningMode: 'IMAGE', numFaces: 1,
    minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5,
  });
  const cropCanvas = new OffscreenCanvas(512, 512);
  const cropContext = cropCanvas.getContext('2d', {willReadFrequently: true});
  const faces = [];
  try {
    for (const face of found) {
      const {x, y, side} = cropRegion(face);
      cropContext.clearRect(0, 0, 512, 512);
      if (!hasTransparency) { cropContext.fillStyle = '#000'; cropContext.fillRect(0, 0, 512, 512); }
      // Safari can leave the surface empty when drawImage's source rectangle
      // extends beyond an ImageBitmap. Transform the complete source instead;
      // the destination canvas clips the crop, including its empty padding.
      const ratio = 512 / side;
      cropContext.setTransform(ratio, 0, 0, ratio, -x * ratio, -y * ratio);
      cropContext.drawImage(bitmap, 0, 0);
      cropContext.resetTransform();
      if (hasTransparency && !fillTransparentSurface(cropContext, 512, 512)) continue;
      report.begin('detect', {title: 'finding_faces', completed: faces.length});
      const mesh = landmarker.detect(cropCanvas).faceLandmarks[0];
      let transform = null, suitable = false;
      if (mesh) {
        // Landmarks arrive relative to the crop; the alignment checks and the
        // transform both work in the photo's own normalized coordinates.
        const {points, nose} = alignmentPoints(mesh.map(point => ({
          x: (x + point.x * side) / bitmap.width,
          y: (y + point.y * side) / bitmap.height,
        })), bitmap.width, bitmap.height);
        transform = similarity(points);
        suitable = Boolean(transform) && isAligned(alignmentQuality(points, nose));
      }
      transform ||= similarity(keypointPoints(face.points));
      if (!transform) continue;
      faces.push({box: headBox(face, bitmap.width, bitmap.height), transform, suitable, patch: null});
    }
  } finally {
    landmarker.close();
    graphCanvas.width = graphCanvas.height = 1;
    cropCanvas.width = cropCanvas.height = 1;
  }
  return faces;
}

self.onmessage = async ({data: {mode = 'detect', file, environment, forceCpu, execution = {}, faces: requested = []}}) => {
  if (busy) return;
  busy = true;
  let bitmap, finder, runtime, effectiveThreads;
  const started = performance.now();
  report = workerReporter(execution, 'faces');
  try {
    report.begin('decode', {title: 'finding_faces', detail: 'finding_faces_check'});
    const info = await inspectFile(file);
    const policy = devicePolicy(environment);
    assessPhoto(info, policy);
    // Face work happens on 512x512 crops, so the source size barely changes its
    // working set. It only needs the same admission as the photo itself.
    const limit = faceLimit(policy);
    if (info.width * info.height > limit) throw new PhotoError('face', 'err_face_limit', {mp: limit / 1_000_000});
    try { bitmap = await createImageBitmap(file, {imageOrientation: 'from-image', premultiplyAlpha: 'none'}); }
    catch (error) { throw new PhotoError('format', 'err_open', undefined, error); }
    let transparency = {hasTransparency: false, maxAlpha: 255};
    if (info.format !== 'jpeg') {
      report.begin('scan', {title: 'finding_faces', detail: 'finding_faces_check'});
      transparency = await readTransparency(bitmap, {retainRgb: false, onProgress: (completed, total) =>
        status({title: 'finding_faces', completed, progress: completed / total})});
    }
    const {hasTransparency, maxAlpha} = transparency;
    if (!maxAlpha) {
      report(mode === 'enhance' ? {type: 'enhanced', faces: requested.map(face => ({index: face.index, patch: null}))}
        : {type: 'faces', faces: [], detectedCount: 0, hasTransparency});
      return;
    }
    // iPhone/iPad use CPU for the models here: the exact GFPGAN graph crashed
    // WebGPU in physical-device tests. A separate worker releases this heap
    // before 2x.
    const cpuOnly = forceCpu || isAppleMobile(environment);
    const keep = active => { runtime = active; effectiveThreads = active.threads; };
    if (mode === 'enhance') {
      // The picker asked for faces that were never enhanced; detection already ran.
      const patches = await enhance(bitmap, requested.map(face => face.transform), cpuOnly, keep, hasTransparency, execution);
      report({type: 'enhanced', faces: requested.map((face, i) => ({index: face.index, patch: patches[i]})),
        effectiveThreads, totalMs: performance.now() - started});
      return;
    }
    finder = await loadFaceFinder(cpuOnly, execution, status);
    effectiveThreads = finder.threads;
    report.begin('detect', {title: 'finding_faces', detail: 'finding_faces_check'});
    const found = await finder.find(bitmap, detectionSide(policy), hasTransparency);
    const detectedCount = found.length;
    // Free the detector's arena before GFPGAN, which reuses the same engine.
    await finder.release(); finder = null;
    const faces = found.length ? await catalogFaces(bitmap, found, hasTransparency) : [];
    const suitable = faces.filter(face => face.suitable);
    if (suitable.length) {
      const patches = await enhance(bitmap, suitable.map(face => face.transform), cpuOnly, keep, hasTransparency, execution);
      suitable.forEach((face, i) => { face.patch = patches[i]; });
    }
    report({type: 'faces', faces, detectedCount, hasTransparency, effectiveThreads, totalMs: performance.now() - started});
  } catch (error) {
    const own = ['download', 'face', 'size', 'format', 'browser'].includes(error.code);
    report({type: 'error', code: error.code || 'face', key: own ? error.key : 'err_face',
      params: own ? error.params : undefined, ...errorDetails(error)});
  } finally {
    bitmap?.close();
    await finder?.release().catch(() => {});
    await runtime?.release().catch(() => {});
    busy = false;
  }
};
