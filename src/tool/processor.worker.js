import {assessPhoto, assessPng, devicePolicy, faceEditFits, PhotoError, SCALE, TILE_SIZE} from './capability.js';
import {inspectFile, parseImageHeader} from './image-info.js';
import {errorDetails} from './diagnostics.js';
import {assembleTiles, makeCanvas, sampleTile, thumbnail} from './tile-pipeline.js';
import {compositePatches} from './face-composite.js';
import {loadRuntime} from './runtime.js';
import {applyBandAlpha, emptyTile, exportOptions, fillTransparentRgb, hasTransparency as classifyTransparency, JPEG, PNG, pngFailureDetails, readTransparency, sampleRgbTile} from './transparency.js';
import {workerReporter} from './worker-status.js';

let busy = false;

async function processPhoto({file, environment, execution = {}, forceCpu = false, faceResults, scale = SCALE,
  modelKind = 'photo', benchmark = false}) {
  const report = workerReporter(execution, `${modelKind}-${scale}`);
  const status = report.status;
  let source, runtime, output, prepared, imageInfo;
  const policy = devicePolicy(environment);
  const started = performance.now(), tileTimes = [];
  // Undefined until an engine actually initialized; skipping inference is not
  // evidence that the requested thread configuration was unavailable.
  let effectiveThreads;
  try {
    report.begin('decode', {title: 'preparing', detail: 'preparing_detail'});
    const info = await inspectFile(file);
    let plan = assessPhoto(info, policy, scale);
    try { source = await createImageBitmap(file, {imageOrientation: 'from-image', premultiplyAlpha: 'none'}); }
    catch (error) { throw new PhotoError('format', 'err_open', undefined, error); }
    imageInfo = {width: source.width, height: source.height, size: file.size};
    plan = assessPhoto(imageInfo, policy, scale);
    let hasTransparency = false;
    if (info.format !== 'jpeg') {
      report.begin('scan', {title: 'preparing', detail: 'preparing_detail'});
      hasTransparency = await classifyTransparency(source, {onProgress: (completed, total) =>
        status({completed, progress: completed / total, title: 'preparing', detail: 'preparing_detail'})});
    }
    const mime = hasTransparency || benchmark?.lossless ? PNG : JPEG;
    if (mime === PNG) plan = assessPng(plan, policy, {size: file.size});
    report({type: 'photo', plan, hasTransparency, thumbnail: await thumbnail(source, hasTransparency)});
    if (hasTransparency) {
      report.begin('prepare-rgb', {title: 'preparing', detail: 'preparing_detail'});
      prepared = await readTransparency(source, {onProgress: (completed, total) =>
        status({completed, progress: completed / total, title: 'preparing', detail: 'preparing_detail'})});
      source.close(); source = null;
      report.begin('prepare-rgb', {title: 'preparing', detail: 'preparing_detail'});
      fillTransparentRgb(prepared.rgb, prepared.alpha, plan.width, plan.height);
    } else prepared = null;
    const {canvas, context} = makeCanvas(plan.outputWidth, plan.outputHeight);
    output = canvas;
    let skippedTiles = 0, completedTiles = 0, tileStarted = performance.now();
    const tileStatus = completed => ({
      title: 'upscaling', detail: 'upscaling_cancel_detail', completed,
      progress: completed / plan.tileCount * .94,
      remainingMs: completed > 0
        ? (performance.now() - tileStarted) / completed * (plan.tileCount - completed) : undefined,
    });
    // An invisible image does not need a runtime or face model at all.
    if (!hasTransparency || prepared.maxAlpha > 0) {
      runtime = await loadRuntime(forceCpu, status, false, scale, modelKind, execution);
      effectiveThreads = runtime.threads;
      tileStarted = performance.now();
      await assembleTiles(plan.width, plan.height, async (x, y) => {
        // Keep the last measured progress visible throughout the next inference.
        report.begin('tile', tileStatus(completedTiles));
        if (hasTransparency && emptyTile(prepared, x, y)) {
          skippedTiles++; return new Uint8ClampedArray((TILE_SIZE * scale) ** 2 * 4);
        }
        const start = performance.now();
        const result = await runtime.run(hasTransparency ? sampleRgbTile(prepared, x, y) : sampleTile(source, x, y));
        if (benchmark) tileTimes.push(performance.now() - start);
        return result;
      }, (data, width, height, y) => {
        // Alpha is restored after RGB blending. Do not mutate the band's RGB,
        // which is still used to blend the following band.
        if (hasTransparency) applyBandAlpha(data, prepared, y, height, scale);
        context.putImageData(new ImageData(data, width, height), 0, y);
      }, completed => {
        completedTiles = completed;
        status({operation: 'tile', ...tileStatus(completed)});
      }, scale);
    } else skippedTiles = plan.tileCount;
    const tilesMs = performance.now() - tileStarted;
    source?.close(); source = null; prepared = null;
    await runtime?.release(); runtime = null;
    const faces = faceResults?.faces || [];
    const faceEnabled = Boolean(faceResults);
    let canEdit = faceEnabled && faces.length > 0 && faceEditFits(plan, policy, {mime});
    let baseBlob;
    if (canEdit) {
      report.begin('encode', {title: 'encoding', detail: 'encoding_detail', progress: .95, pixels: plan.outputWidth * plan.outputHeight});
      try { baseBlob = await canvas.convertToBlob(exportOptions(mime)); }
      catch (error) { throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save', undefined, error); }
      if (!baseBlob.size || baseBlob.type !== mime) throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save');
      canEdit = faceEditFits(plan, policy, {mime, baseBytes: baseBlob.size});
      if (!canEdit) baseBlob = undefined;
    }
    report.begin('composite', {title: 'encoding', detail: 'encoding_detail', progress: .96});
    const enhanced = faces.filter(face => face.patch);
    await compositePatches(context, enhanced, scale);
    report.begin('encode', {title: 'encoding', detail: 'encoding_detail', progress: .97, pixels: plan.outputWidth * plan.outputHeight});
    let blob;
    try { blob = await canvas.convertToBlob(exportOptions(mime)); }
    catch (error) { throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save', undefined, error); }
    if (!blob.size || blob.type !== mime) throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save');
    let result;
    try { result = parseImageHeader(await blob.slice(0, 2 * 1024 * 1024).arrayBuffer()); }
    catch (error) { throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save', undefined, error); }
    if (result.format !== (mime === PNG ? 'png' : 'jpeg') || result.width !== plan.outputWidth || result.height !== plan.outputHeight) throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save');
    report({type: 'done', blob, mime, hasTransparency, plan, modelKind, faceCount: enhanced.length,
      detectedCount: faceResults?.detectedCount || 0, faceEnabled, tilesMs, canEdit, baseBlob,
      faces: canEdit ? faces : undefined, skippedTiles, tileTimes, effectiveThreads,
      totalMs: performance.now() - started});
  } catch (error) {
    report({type: 'error', ...pngFailureDetails(error, imageInfo, policy, scale), ...errorDetails(error)});
  } finally {
    source?.close(); prepared = null;
    try { await runtime?.release(); } catch { /* Termination is final cleanup. */ }
    if (output) output.width = output.height = 1;
  }
}

self.onmessage = async ({data}) => {
  if (busy || data.type !== 'prepare') return;
  busy = true;
  try { await processPhoto(data); } finally { busy = false; }
};
