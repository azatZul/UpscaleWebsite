import {ASSETS} from './assets.generated.js';
import {faceGeometry} from './face-geometry.js';
import {loadRuntime} from './runtime.js';
import {assessPhoto, devicePolicy, faceLimit, isAppleMobile, PhotoError} from './capability.js';
import {cropRegion, detectionSide} from './face-detect.js';
import {loadFaceFinder} from './face-finder.js';
import {inspectFile} from './image-info.js';
const status = message => self.postMessage({type: 'status', ...message});
let busy = false;
self.onmessage = async ({data: {file, environment, forceCpu}}) => {
  if (busy) return;
  busy = true;
  let bitmap, finder, landmarker, runtime;
  try {
    const info = await inspectFile(file);
    const policy = devicePolicy(environment);
    assessPhoto(info, policy);
    // Face work happens on 512x512 crops, so the source size barely changes its
    // working set. It only needs the same admission as the photo itself.
    const limit = faceLimit(policy);
    if (info.width * info.height > limit) throw new PhotoError('face', 'err_face_limit', {mp: limit / 1_000_000});
    bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
    status({title: 'finding_faces', detail: 'finding_faces_check'});
    // Apple devices use CPU for the models here: the exact GFPGAN graph crashed
    // WebGPU in physical-device tests. A separate worker releases this heap
    // before 2x.
    const cpuOnly = forceCpu || isAppleMobile(environment);
    finder = await loadFaceFinder(cpuOnly);
    const found = await finder.find(bitmap, detectionSide(policy));
    const detectedCount = found.length;
    // Free the detector's arena before GFPGAN, which reuses the same engine.
    await finder.release(); finder = null;
    const transforms = [];
    if (found.length) {
      const {FaceLandmarker, FilesetResolver} = await import(/* @vite-ignore */ `${ASSETS.vision}/vision_bundle.mjs`);
      landmarker = await FaceLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(`${ASSETS.vision}/wasm`), {
        baseOptions: {modelAssetPath: ASSETS.faceDetector, delegate: 'CPU'},
        runningMode: 'IMAGE', numFaces: 1,
        minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5,
      });
      const cropCanvas = new OffscreenCanvas(512, 512);
      const cropContext = cropCanvas.getContext('2d', {willReadFrequently: true});
      for (const face of found) {
        const {x, y, side} = cropRegion(face);
        cropContext.fillStyle = '#000'; cropContext.fillRect(0, 0, 512, 512);
        cropContext.drawImage(bitmap, x, y, side, side, 0, 0, 512, 512);
        const points = landmarker.detect(cropCanvas).faceLandmarks[0];
        if (!points) continue;
        // Landmarks arrive relative to the crop; the alignment checks and the
        // transform both work in the photo's own normalized coordinates.
        const transform = faceGeometry(points.map(point => ({
          x: (x + point.x * side) / bitmap.width,
          y: (y + point.y * side) / bitmap.height,
        })), bitmap.width, bitmap.height);
        if (transform) transforms.push(transform);
      }
      landmarker.close(); landmarker = null;
      cropCanvas.width = cropCanvas.height = 1;
    }
    const faces = [];
    if (transforms.length) {
      runtime = await loadRuntime(cpuOnly, status, true);
      const canvas = new OffscreenCanvas(512, 512);
      const ctx = canvas.getContext('2d', {willReadFrequently: true});
      for (let i = 0; i < transforms.length; i++) {
        status({title: 'enhancing_face', detail: 'enhancing_face_detail', params: {current: i + 1, total: transforms.length}, progress: i / transforms.length});
        ctx.resetTransform(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 512, 512);
        const t = transforms[i]; ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
        ctx.drawImage(bitmap, 0, 0); ctx.resetTransform();
        const rgba = ctx.getImageData(0, 0, 512, 512).data;
        const plane = 512 * 512;
        const input = new Float32Array(plane * 3);
        // App model includes normalization; input is RGB [0, 1].
        for (let p = 0; p < plane; p++) for (let c = 0; c < 3; c++) input[c * plane + p] = rgba[p * 4 + c] / 255;
        faces.push({pixels: await runtime.run(input), transform: t});
      }
      canvas.width = canvas.height = 1;
      await runtime.release(); runtime = null;
    }
    self.postMessage({type: 'faces', faces, detectedCount}, faces.map(face => face.pixels.buffer));
  } catch (error) {
    const own = ['download', 'face'].includes(error.code);
    self.postMessage({type: 'error', code: error.code || 'face', key: own ? error.key : 'err_face', params: own ? error.params : undefined});
  } finally {
    bitmap?.close(); landmarker?.close();
    await finder?.release().catch(() => {});
    await runtime?.release().catch(() => {});
  }
};
