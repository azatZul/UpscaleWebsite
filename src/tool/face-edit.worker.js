import {PhotoError} from './capability.js';
import {compositePatches} from './face-composite.js';
import {parseImageHeader} from './image-info.js';
import {makeCanvas} from './tile-pipeline.js';

// Rebuilds the result for a new face selection from the faceless base, never
// from the previous result, so the background is re-encoded at most once.
const send = message => self.postMessage(message);
let busy = false;

async function apply({base, plan, faces}) {
  let output, bitmap;
  try {
    send({type: 'status', title: 'applying_faces'});
    bitmap = await createImageBitmap(base);
    if (bitmap.width !== plan.outputWidth || bitmap.height !== plan.outputHeight) throw new Error('Wrong base size');
    const {canvas, context} = makeCanvas(plan.outputWidth, plan.outputHeight);
    output = canvas;
    context.drawImage(bitmap, 0, 0);
    // Two full-size surfaces must not outlive the draw.
    bitmap.close(); bitmap = null;
    await compositePatches(context, faces, plan.scale);
    const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: .96});
    if (!blob.size) throw new Error('No image was encoded');
    const result = parseImageHeader(await blob.slice(0, 2 * 1024 * 1024).arrayBuffer());
    if (result.width !== plan.outputWidth || result.height !== plan.outputHeight) throw new Error('Wrong export size');
    send({type: 'applied', blob});
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('export', 'err_face_apply');
  } finally {
    bitmap?.close();
    if (output) output.width = output.height = 1;
  }
}

self.onmessage = async ({data}) => {
  if (busy || data.type !== 'apply') return;
  busy = true;
  try { await apply(data); }
  catch (error) { send({type: 'error', code: error.code || 'export', key: error.key || 'err_face_apply', params: error.params}); }
  finally { busy = false; }
};
