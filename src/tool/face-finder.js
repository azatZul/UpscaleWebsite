import {ASSETS} from './assets.generated.js';
import {PhotoError} from './capability.js';
import {decodeYuNet, detectionGeometry, faceFinderInput, MAX_FACES} from './face-detect.js';
import {download, importOrt, requireGpuAdapter, selectBackend} from './runtime.js';
import {fillTransparentSurface} from './transparency.js';

const backendError = (backend, cause) => new PhotoError(backend === 'webgpu' ? 'gpu' : 'runtime', undefined, undefined, cause);

// Loads YuNet on the same engine the face model will use, so a face pass keeps
// one wasm heap instead of two. See face-detect.js for why it replaced the
// detector bundled inside face_landmarker.task.
export async function loadFaceFinder(forceCpu, execution = {}, status = () => {}) {
  const backend = execution.backend || await selectBackend(forceCpu);
  let ort, session;
  try {
    status({phase: 'initialize', title: 'finding_faces', detail: 'finding_faces_check'});
    if (backend === 'webgpu') await requireGpuAdapter();
    status({phase: 'download', title: 'finding_faces', detail: 'finding_faces_check'});
    const bytes = await download(ASSETS.faceFinder, (progress, receivedBytes) => status({phase: 'download', progress, receivedBytes, title: 'finding_faces'}));
    status({phase: 'initialize', title: 'finding_faces', detail: 'finding_faces_check'});
    ort = await importOrt(backend, execution);
    status({phase: 'initialize', title: 'finding_faces', detail: 'finding_faces_check'});
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: [backend], graphOptimizationLevel: 'disabled',
    });
    status({operation: 'initialize', completed: 1, effectiveThreads: ort.env.wasm.numThreads, backend});
  } catch (error) {
    if (error.code === 'download') throw error;
    throw backendError(backend, error);
  }
  return {
    backend,
    threads: ort.env.wasm.numThreads,
    async find(bitmap, side, hasTransparency = false) {
      const geometry = detectionGeometry(bitmap.width, bitmap.height, side);
      const canvas = new OffscreenCanvas(geometry.padWidth, geometry.padHeight);
      const context = canvas.getContext('2d', {willReadFrequently: true});
      context.drawImage(bitmap, 0, 0, geometry.drawWidth, geometry.drawHeight);
      if (hasTransparency && !fillTransparentSurface(context, geometry.drawWidth, geometry.drawHeight)) {
        canvas.width = canvas.height = 1;
        return [];
      }
      const rgba = context.getImageData(0, 0, geometry.padWidth, geometry.padHeight).data;
      const values = faceFinderInput(rgba, geometry);
      let input, outputs;
      try {
        input = new ort.Tensor('float32', values, [1, 3, geometry.padHeight, geometry.padWidth]);
        outputs = await session.run({[session.inputNames[0]]: input});
        const tensors = {};
        for (const [name, tensor] of Object.entries(outputs)) tensors[name] = await tensor.getData();
        return decodeYuNet(tensors, geometry).slice(0, MAX_FACES);
      } catch (error) {
        throw backendError(backend, error);
      } finally {
        input?.dispose();
        if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
        canvas.width = canvas.height = 1;
      }
    },
    async release() { await session.release(); },
  };
}
