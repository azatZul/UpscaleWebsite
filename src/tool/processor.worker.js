import {assessPhoto, devicePolicy, estimateDuration, faceEditFits, PhotoError, SCALE, TILE_SIZE} from './capability.js';
import {inspectFile, parseImageHeader} from './image-info.js';
import {assembleTiles, makeCanvas, sampleTile, thumbnail} from './tile-pipeline.js';
import {compositePatches} from './face-composite.js';
import {loadRuntime} from './runtime.js';

const send = message => self.postMessage(message);
const status = message => send({type: 'status', ...message});
let source;
let runtime;
let plan;
let policy;
let busy = false;
let ready = false;
let faces = [];
let detectedCount = 0;
let faceEnabled = false;
let modelKind = 'photo';

async function release() {
  source?.close(); source = null;
  const active = runtime; runtime = null;
  try { await active?.release(); } catch { /* Worker termination is the final cleanup. */ }
}

async function prepare({file, environment, forceCpu = false, autoStart = false, faceResults, scale = SCALE,
  modelKind: requestedModelKind = 'photo'}) {
  ready = false;
  modelKind = requestedModelKind;
  faces = faceResults?.faces || [];
  detectedCount = faceResults?.detectedCount || 0;
  faceEnabled = Boolean(faceResults);
  await release();
  policy = devicePolicy(environment);
  plan = assessPhoto(await inspectFile(file), policy, scale);
  try { source = await createImageBitmap(file, {imageOrientation: 'from-image'}); }
  catch { throw new PhotoError('format', 'err_open'); }
  // Decoders apply EXIF orientation. Trust actual decoded dimensions only
  // after checking the header, and enforce the same policy again.
  plan = assessPhoto({width: source.width, height: source.height, size: file.size}, policy, scale);
  send({type: 'photo', plan, thumbnail: await thumbnail(source)});
  runtime = await loadRuntime(forceCpu, status, false, scale, modelKind);
  if (autoStart) { ready = true; await process(); return; }
  status({phase: 'probe', title: 'measuring', detail: 'measuring_detail'});
  const x = Math.max(0, Math.floor((source.width - TILE_SIZE) / 2));
  const y = Math.max(0, Math.floor((source.height - TILE_SIZE) / 2));
  const values = sampleTile(source, x, y);
  await runtime.run(values); // First inference includes shader setup.
  const started = performance.now();
  const pixels = await runtime.run(values);
  const tileMs = performance.now() - started;
  const {canvas, context} = makeCanvas(512, 512);
  try {
    context.putImageData(new ImageData(pixels, 512, 512), 0, 0);
    const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: .96});
    if (!blob.size) throw new Error('No output');
  } catch { throw new PhotoError('export', 'err_export_probe'); }
  finally { canvas.width = canvas.height = 1; }
  ready = true;
  send({type: 'ready', plan, backend: runtime.backend, tileMs, ...estimateDuration(tileMs, plan.tileCount)});
}

async function process() {
  if (!ready || !source || !runtime) throw new PhotoError('runtime', 'err_check_again');
  ready = false;
  let output;
  const started = performance.now();
  try {
    status({phase: 'process', progress: 0, title: 'upscaling', detail: 'upscaling_detail'});
    const {canvas, context} = makeCanvas(plan.outputWidth, plan.outputHeight);
    output = canvas;
    await assembleTiles(source.width, source.height,
      async (x, y) => runtime.run(sampleTile(source, x, y)),
      (data, width, height, y) => context.putImageData(new ImageData(data, width, height), 0, y),
      (completed, total) => status({phase: 'process', progress: completed / total * .94,
        title: 'upscaling', remainingMs: (performance.now() - started) / completed * (total - completed),
        detail: 'upscaling_cancel_detail'}), plan.scale);
    // Tile time alone drives the next photo's estimate. Face compositing and
    // the export are excluded so a small photo does not inflate the figure.
    const tilesMs = performance.now() - started;
    source.close(); source = null;
    // Release model memory before asking the encoder for a full-size export.
    await runtime.release(); runtime = null;
    // The face picker rebuilds the result from this faceless copy, so no model
    // runs again for a new selection. Only kept where decoding it next to a
    // second full-size canvas fits the device (see faceEditFits).
    const canEdit = faceEnabled && faces.length > 0 && faceEditFits(plan, policy);
    let baseBlob;
    if (canEdit) {
      status({phase: 'encode', progress: .95, title: 'encoding', detail: 'encoding_detail'});
      baseBlob = await canvas.convertToBlob({type: 'image/jpeg', quality: .96});
      if (!baseBlob.size) throw new Error('No base was encoded');
    }
    const enhanced = faces.filter(face => face.patch);
    await compositePatches(context, enhanced, plan.scale);
    const faceCount = enhanced.length;
    status({phase: 'encode' , progress: .97, title: 'encoding', detail: 'encoding_detail'});
    const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: .96});
    if (!blob.size) throw new Error('No image was encoded');
    // Verify that export preserved the requested dimensions.
    const result = parseImageHeader(await blob.slice(0, 2 * 1024 * 1024).arrayBuffer());
    if (result.width !== plan.outputWidth || result.height !== plan.outputHeight) throw new Error('Wrong export size');
    send({type: 'done', blob, plan, modelKind, faceCount, detectedCount, faceEnabled, tilesMs, canEdit, baseBlob,
      faces: canEdit ? faces : undefined,
      totalMs: performance.now() - started});
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('export', 'err_save');
  } finally {
    faces = [];
    if (output) output.width = output.height = 1;
    await release();
  }
}

self.onmessage = async ({data}) => {
  if (busy || !['prepare', 'process'].includes(data.type)) return;
  busy = true;
  try { data.type === 'prepare' ? await prepare(data) : await process(); }
  catch (error) {
    ready = false;
    send({type: 'error', code: error.code || 'runtime', key: error.key || 'err_finish', params: error.params});
    await release();
  } finally { busy = false; }
};
