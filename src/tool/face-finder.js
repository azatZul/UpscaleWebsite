import {ASSETS} from './assets.generated.js';
import {decodeYuNet, detectionGeometry, faceFinderInput, MAX_FACES} from './face-detect.js';
import {importOrt, selectBackend} from './runtime.js';

// Loads YuNet on the same engine the face model will use, so a face pass keeps
// one wasm heap instead of two. See face-detect.js for why it replaced the
// detector bundled inside face_landmarker.task.
export async function loadFaceFinder(forceCpu) {
  const backend = await selectBackend(forceCpu);
  const ort = await importOrt(backend);
  const session = await ort.InferenceSession.create(ASSETS.faceFinder, {
    executionProviders: [backend], graphOptimizationLevel: 'disabled',
  });
  return {
    backend,
    async find(bitmap, side) {
      const geometry = detectionGeometry(bitmap.width, bitmap.height, side);
      const canvas = new OffscreenCanvas(geometry.padWidth, geometry.padHeight);
      const context = canvas.getContext('2d', {willReadFrequently: true});
      context.drawImage(bitmap, 0, 0, geometry.drawWidth, geometry.drawHeight);
      const rgba = context.getImageData(0, 0, geometry.padWidth, geometry.padHeight).data;
      const values = faceFinderInput(rgba, geometry);
      const input = new ort.Tensor('float32', values, [1, 3, geometry.padHeight, geometry.padWidth]);
      let outputs;
      try {
        outputs = await session.run({[session.inputNames[0]]: input});
        const tensors = {};
        for (const [name, tensor] of Object.entries(outputs)) tensors[name] = await tensor.getData();
        return decodeYuNet(tensors, geometry).slice(0, MAX_FACES);
      } finally {
        input.dispose();
        if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
        canvas.width = canvas.height = 1;
      }
    },
    async release() { await session.release(); },
  };
}
