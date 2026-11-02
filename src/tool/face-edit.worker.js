import {PhotoError} from './capability.js';
import {compositePatches} from './face-composite.js';
import {parseImageHeader} from './image-info.js';
import {makeCanvas} from './tile-pipeline.js';
import {exportOptions, PNG} from './transparency.js';
import {workerReporter} from './worker-status.js';
import {errorDetails} from './diagnostics.js';

// Rebuilds the result for a new face selection from the faceless base, never
// from the previous result, so the background is re-encoded at most once.
let send;
let busy = false;

async function apply({base, plan, faces}) {
  let output, bitmap;
  try {
    send.begin('composite', {title: 'applying_faces'});
    bitmap = await createImageBitmap(base);
    if (bitmap.width !== plan.outputWidth || bitmap.height !== plan.outputHeight) throw new Error('Wrong base size');
    const {canvas, context} = makeCanvas(plan.outputWidth, plan.outputHeight);
    output = canvas;
    context.drawImage(bitmap, 0, 0);
    // Two full-size surfaces must not outlive the draw.
    bitmap.close(); bitmap = null;
    await compositePatches(context, faces, plan.scale);
    const mime = base.type === PNG ? PNG : 'image/jpeg';
    send.begin('encode', {title: 'applying_faces', pixels: plan.outputWidth * plan.outputHeight});
    const blob = await canvas.convertToBlob(exportOptions(mime));
    if (!blob.size || blob.type !== mime) throw new Error('Wrong export format');
    const result = parseImageHeader(await blob.slice(0, 2 * 1024 * 1024).arrayBuffer());
    if (result.format !== (mime === PNG ? 'png' : 'jpeg') || result.width !== plan.outputWidth || result.height !== plan.outputHeight) throw new Error('Wrong export size or format');
    send({type: 'applied', blob});
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('export', 'err_face_apply', undefined, error);
  } finally {
    bitmap?.close();
    if (output) output.width = output.height = 1;
  }
}

self.onmessage = async ({data}) => {
  if (busy || data.type !== 'apply') return;
  busy = true;
  send = workerReporter(data.execution, 'composite');
  try { await apply(data); }
  catch (error) { send({type: 'error', code: error.code || 'export', key: error.key || 'err_face_apply',
    params: error.params, ...errorDetails(error)}); }
  finally { busy = false; }
};
