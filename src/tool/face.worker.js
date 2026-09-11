import {ASSETS} from './assets.generated.js';
import {faceGeometry} from './face-geometry.js';
import {loadRuntime} from './runtime.js';
import {assessPhoto, devicePolicy, faceLimit, isAppleMobile, PhotoError} from './capability.js';
import {inspectFile} from './image-info.js';
const status = message => self.postMessage({type: 'status', ...message});
let busy = false;
self.onmessage = async ({data: {file, environment, forceCpu}}) => {
  if (busy) return;
  busy = true;
  let bitmap, detector, runtime;
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
    const {FaceLandmarker, FilesetResolver} = await import(/* @vite-ignore */ `${ASSETS.vision}/vision_bundle.mjs`);
    detector = await FaceLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(`${ASSETS.vision}/wasm`), {
      baseOptions: {modelAssetPath: ASSETS.faceDetector, delegate: 'CPU'},
      runningMode: 'IMAGE', numFaces: 8,
      minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5,
    });
    const ratio = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const detectionImage = new OffscreenCanvas(Math.round(bitmap.width * ratio), Math.round(bitmap.height * ratio));
    detectionImage.getContext('2d').drawImage(bitmap, 0, 0, detectionImage.width, detectionImage.height);
    const detection = detector.detect(detectionImage);
    const transforms = detection.faceLandmarks.map(points => faceGeometry(points, bitmap.width, bitmap.height)).filter(Boolean);
    const detectedCount = detection.faceLandmarks.length;
    detector.close(); detector = null;
    detectionImage.width = detectionImage.height = 1;
    const faces = [];
    if (transforms.length) {
      // Apple devices use CPU here: the exact GFPGAN graph crashed WebGPU in
      // physical-device tests. A separate worker releases this heap before 2×.
      runtime = await loadRuntime(forceCpu || isAppleMobile(environment), status, true);
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
  } finally { bitmap?.close(); detector?.close(); await runtime?.release().catch(() => {}); }
};
