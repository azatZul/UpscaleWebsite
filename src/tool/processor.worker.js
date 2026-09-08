import {assessPhoto, devicePolicy, estimateDuration, PhotoError, TILE_SIZE} from './capability.js';
import {inspectFile, parseImageHeader} from './image-info.js';
import {assembleTiles, makeCanvas, sampleTile, thumbnail} from './tile-pipeline.js';
import {inverseTransform} from './face-geometry.js';
import {loadRuntime} from './runtime.js';

const send = message => self.postMessage(message);
const status = message => send({type: 'status', ...message});
let source;
let runtime;
let plan;
let busy = false;
let ready = false;
let faces = [];
let detectedCount = 0;
let faceEnabled = false;

async function release() {
  source?.close(); source = null;
  const active = runtime; runtime = null;
  try { await active?.release(); } catch { /* Worker termination is the final cleanup. */ }
}

async function prepare({file, environment, forceCpu = false, autoStart = false, faceResults}) {
  ready = false;
  faces = faceResults?.faces || [];
  detectedCount = faceResults?.detectedCount || 0;
  faceEnabled = Boolean(faceResults);
  await release();
  const policy = devicePolicy(environment);
  plan = assessPhoto(await inspectFile(file), policy);
  try { source = await createImageBitmap(file, {imageOrientation: 'from-image'}); }
  catch { throw new PhotoError('format', 'This browser couldn’t open the photo. Try another image or get the app.'); }
  // Decoders apply EXIF orientation. Trust actual decoded dimensions only
  // after checking the header, and enforce the same policy again.
  plan = assessPhoto({width: source.width, height: source.height, size: file.size}, policy);
  send({type: 'photo', plan, thumbnail: await thumbnail(source)});
  runtime = await loadRuntime(forceCpu, status);
  if (autoStart) { ready = true; await process(); return; }
  status({phase: 'probe', title: 'Measuring processing speed', detail: 'Trying a small part of your photo before starting the full image.'});
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
  } catch { throw new PhotoError('export', 'This browser couldn’t prepare an image download. Try the app.'); }
  finally { canvas.width = canvas.height = 1; }
  ready = true;
  send({type: 'ready', plan, backend: runtime.backend, tileMs, ...estimateDuration(tileMs, plan.tileCount)});
}

async function process() {
  if (!ready || !source || !runtime) throw new PhotoError('runtime', 'Choose a photo and check it again.');
  ready = false;
  let output;
  const started = performance.now();
  try {
    status({phase: 'process', progress: 0, title: 'Upscaling your photo', detail: 'Keep this page open while it processes.'});
    const {canvas, context} = makeCanvas(plan.outputWidth, plan.outputHeight);
    output = canvas;
    await assembleTiles(source.width, source.height,
      async (x, y) => runtime.run(sampleTile(source, x, y)),
      (data, width, height, y) => context.putImageData(new ImageData(data, width, height), 0, y),
      (completed, total) => status({phase: 'process', progress: completed / total * .94,
        title: 'Upscaling your photo', remainingMs: (performance.now() - started) / completed * (total - completed),
        detail: 'Keep this page open. You can cancel at any time.'}));
    // Tile time alone drives the next photo's estimate. Face compositing and
    // the export are excluded so a small photo does not inflate the figure.
    const tilesMs = performance.now() - started;
    source.close(); source = null;
    // Release model memory before asking the encoder for a full-size export.
    await runtime.release(); runtime = null;
    for (const face of faces) {
      const patch = new OffscreenCanvas(512, 512);
      const ctx = patch.getContext('2d');
      ctx.putImageData(new ImageData(face.pixels, 512, 512), 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      const mask = ctx.createRadialGradient(256, 256, 220, 256, 256, 255);
      mask.addColorStop(0, '#fff'); mask.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = mask; ctx.fillRect(0, 0, 512, 512);
      const t = inverseTransform(face.transform, 2);
      context.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
      context.drawImage(patch, 0, 0); context.resetTransform();
      patch.width = patch.height = 1;
    }
    const faceCount = faces.length; faces = [];
    status({phase: 'encode' , progress: .97, title: 'Preparing your download', detail: 'Saving the finished photo on this device.'});
    const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: .96});
    if (!blob.size) throw new Error('No image was encoded');
    // Verify that export preserved the requested dimensions.
    const result = parseImageHeader(await blob.slice(0, 2 * 1024 * 1024).arrayBuffer());
    if (result.width !== plan.outputWidth || result.height !== plan.outputHeight) throw new Error('Wrong export size');
    send({type: 'done', blob, plan, faceCount, detectedCount, faceEnabled, tilesMs, totalMs: performance.now() - started});
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('export', 'This browser couldn’t save the full-size result. Try a smaller photo or use the app.');
  } finally {
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
    send({type: 'error', code: error.code || 'runtime', message: error.message || 'This browser couldn’t finish the photo.'});
    await release();
  } finally { busy = false; }
};
