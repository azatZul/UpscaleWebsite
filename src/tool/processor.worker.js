import {assessPhoto, assessPng, devicePolicy, faceEditFits, PhotoError, SCALE, TILE_SIZE} from './capability.js';
import {inspectFile, parseImageHeader} from './image-info.js';
import {errorDetails} from './diagnostics.js';
import {assembleTiles, makeCanvas, sampleTile, thumbnail} from './tile-pipeline.js';
import {compositePatches} from './face-composite.js';
import {loadRuntime} from './runtime.js';
import {applyBandAlpha, emptyTile, exportOptions, fillTransparentRgb, hasTransparency as classifyTransparency, JPEG, PNG, pngFailureDetails, readTransparency, sampleRgbTile} from './transparency.js';
import {workerReporter} from './worker-status.js';
import {forecastPhoto4x, photo4xOverhead, tileGeometry, variantKey, updatePhoto4xProfile,
  photo4xPath, calibratePhoto4xMargin, smoothPhoto4xCost, PHOTO4X_BUDGET_MS} from './photo4x-policy.js';
import {calibratePhoto4xOutput} from './photo4x-calibration.js';
import {compareReferenceStats, decodeReferenceStats, photo4xReferenceInput, photo4xReferenceStats} from './photo4x-reference.js';
import {PHOTO4X_REFERENCE} from './photo4x-reference.generated.js';
import {createActiveClock} from './active-clock.js';

// Rolling projection: once this many real tiles have run, a run that will
// clearly miss the budget restarts on the regular model now, not at 300 s.
const PROJECTION_TILES = 8;

let busy = false;
let clock;

async function processPhoto({file, environment, execution = {}, forceCpu = false, faceResults, scale = SCALE,
  modelKind = 'photo', benchmark = false}, clock) {
  const {now} = clock;
  const variant = execution.variant;
  const geometry = tileGeometry(variant);
  const {tileSize, stride, overlap} = geometry;
  const report = workerReporter(execution, variant ? variantKey(variant, execution.backend) : `${modelKind}-${scale}`);
  const status = report.status;
  let source, runtime, output, prepared, imageInfo;
  const policy = devicePolicy(environment);
  if (variant && policy.mobile) {
    report({type: 'error', code: 'runtime', key: 'err_engine_start'});
    return;
  }
  const started = now(), tileTimes = [];
  // Undefined until an engine actually initialized; skipping inference is not
  // evidence that the requested thread configuration was unavailable.
  let effectiveThreads;
  try {
    await clock.waitUntilVisible();
    report.begin('decode', {title: 'preparing', detail: 'preparing_detail'});
    const info = await inspectFile(file);
    let plan = assessPhoto(info, policy, scale, geometry);
    try { source = await createImageBitmap(file, {imageOrientation: 'from-image', premultiplyAlpha: 'none'}); }
    catch (error) { throw new PhotoError('format', 'err_open', undefined, error); }
    imageInfo = {width: source.width, height: source.height, size: file.size};
    plan = assessPhoto(imageInfo, policy, scale, geometry);
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
    const automatic = Boolean(variant?.profileKey && execution.modelFallback);
    let profile = variant?.cachedProfile, calibrationMs = 0;
    const faces = faceResults?.faces || [];
    const enhanced = faces.filter(face => face.patch);
    const faceEnabled = Boolean(faceResults);
    const baseExport = faceEnabled && faces.length > 0 && faceEditFits(plan, policy, {mime});
    const path = {hasTransparency, baseExport};
    let overhead = variant ? photo4xOverhead(variant, plan, mime, path) : {};
    const cachedForecast = profile && forecastPhoto4x({tileTimes: Array(Math.min(3, plan.tileCount)).fill(profile.tileMs),
      tileCount: plan.tileCount, assemblyMs: overhead.assemblyMs ?? 0, exportMs: overhead.exportMs ?? 0, margin: profile.margin});
    if (automatic && cachedForecast && !cachedForecast.allowed) {
      report({type: 'forecast', forecast: cachedForecast, cached: true});
      throw new PhotoError('budget', 'err_speed');
    }
    let skippedTiles = 0, completedTiles = 0, tileStarted = now();
    let runtimeTimings, forecast, probeTimes = [], probeMs = 0, warmupMs = 0, inferenceMs = 0, budgetStarted;
    const probed = new Map();
    // The product budget decides whether to start another tile. After the last
    // one, finishing is cheaper than restarting on the regular model; lab
    // screening keeps its hard limit through export.
    const checkBudget = (finished = false) => {
      const limit = automatic ? (finished ? 0 : PHOTO4X_BUDGET_MS) : benchmark?.budgetMs;
      if (limit && budgetStarted !== undefined && now() - budgetStarted + probeMs > limit) throw new PhotoError('budget', 'err_speed');
    };
    const tileStatus = completed => {
      const measured = completed + probed.size;
      return {
        title: 'upscaling', detail: 'upscaling_cancel_detail', completed,
        progress: completed / plan.tileCount * .94,
        remainingMs: measured > 0
          ? (now() - tileStarted + probeMs) / measured * Math.max(0, plan.tileCount - measured) : undefined,
      };
    };
    // An invisible image does not need a runtime or face model at all.
    const sample = (x, y) => hasTransparency ? sampleRgbTile(prepared, x, y, tileSize) : sampleTile(source, x, y, tileSize);
    if (!hasTransparency || prepared.maxAlpha > 0) {
      runtime = await loadRuntime(forceCpu, status, false, scale, modelKind, execution);
      runtimeTimings = runtime.timings;
      effectiveThreads = runtime.threads;
      if (variant) {
        await clock.waitUntilVisible();
        report.begin('probe', {title: 'initializing', detail: 'max_quality_checking_detail'});
        // Always warm up: a cached profile must not learn shader compilation as tile speed.
        // The warm-up tile is the fixed reference, so it also proves this GPU's output.
        let probeStart = now();
        const warmup = await runtime.run(photo4xReferenceInput(tileSize));
        warmupMs = now() - probeStart;
        // Lab screening of other graphs has no reference; the product never runs unverified.
        const reference = PHOTO4X_REFERENCE.revision === variant.revision
          ? compareReferenceStats(photo4xReferenceStats(warmup, tileSize * scale, PHOTO4X_REFERENCE.grid), decodeReferenceStats(PHOTO4X_REFERENCE.stats))
          : undefined;
        if (reference) report({type: 'photo4x-reference', ...reference});
        if (reference ? !reference.passed : automatic) throw new PhotoError('gpu', 'err_invalid_output');
        const columns = Math.ceil(plan.width / stride);
        const probeCount = automatic && profile ? Math.min(3, plan.tileCount) : 3;
        for (let i = 0; i < probeCount; i++) {
          await clock.waitUntilVisible();
          const index = Math.min(i, plan.tileCount - 1), column = index % columns, row = Math.floor(index / columns);
          const x = column * stride - (column ? overlap : 0), y = row * stride - (row ? overlap : 0);
          probeStart = now();
          const pixels = await runtime.run(sample(x, y));
          probeTimes.push(now() - probeStart);
          probed.set(`${x},${y}`, pixels);
          status({operation: 'probe', completed: i + 1, total: probeCount});
        }
        probeMs = probeTimes.reduce((a, b) => a + b, 0);
        if (automatic) {
          const inferenceOnly = forecastPhoto4x({tileTimes: probeTimes, tileCount: plan.tileCount,
            assemblyMs: 0, exportMs: 0, margin: profile?.margin});
          if (!inferenceOnly.allowed) {
            report({type: 'forecast', forecast: inferenceOnly, probeTimes, runtimeTimings, warmupMs});
            // Persist useful speed evidence, not a blanket rejection of smaller images.
            profile = updatePhoto4xProfile(profile, {tileMs: Math.max(...probeTimes)});
            report({type: 'photo4x-profile', profileKey: variant.profileKey, profile});
            throw new PhotoError('budget', 'err_speed');
          }
          if (!Number.isFinite(overhead.assemblyMs) || !Number.isFinite(overhead.exportMs)) {
            const measured = await calibratePhoto4xOutput({plan, geometry, canvas, context, mime, prepared,
              faces: enhanced, baseExport, report, clock});
            calibrationMs = measured.calibrationMs;
            profile = updatePhoto4xProfile(profile, {tileMs: Math.max(...probeTimes), overhead: measured});
            overhead = {assemblyMs: measured.assemblyMs, exportMs: measured.exportMs, margin: profile.margin};
          } else profile = updatePhoto4xProfile(profile, {tileMs: Math.max(...probeTimes)});
          report({type: 'photo4x-profile', profileKey: variant.profileKey, profile});
        }
        forecast = forecastPhoto4x({tileTimes: automatic ? probeTimes.map(t => Math.max(t, profile.tileMs)) : probeTimes,
          tileCount: plan.tileCount, ...overhead});
        report({type: 'forecast', forecast, probeTimes, runtimeTimings, warmupMs});
        if (execution.modelFallback && !forecast.allowed) throw new PhotoError('budget', 'err_speed');
        if (automatic) report({type: 'photo4x-budget', elapsedMs: probeMs});
      }
      tileStarted = now();
      budgetStarted ??= tileStarted;
      // Wall time per real tile, including assembly; probed and empty tiles are instant.
      const recent = [], recentInference = [];
      let lastTileEnd;
      const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
      const checkProjection = () => {
        if (!automatic || recent.length < PROJECTION_TILES) return;
        const projectedMs = now() - budgetStarted + probeMs + mean(recent) * (plan.tileCount - completedTiles) +
          (overhead.exportMs ?? 0);
        if (projectedMs <= PHOTO4X_BUDGET_MS) return;
        report({type: 'photo4x-projection', projectedMs: Math.ceil(projectedMs), completed: completedTiles, total: plan.tileCount});
        // Raise the saved speed so the next photo is forecast with what this device really sustains.
        profile = updatePhoto4xProfile(profile, {tileMs: mean(recentInference)});
        report({type: 'photo4x-profile', profileKey: variant.profileKey, profile});
        throw new PhotoError('budget', 'err_speed');
      };
      await assembleTiles(plan.width, plan.height, async (x, y) => {
        await clock.waitUntilVisible();
        checkBudget();
        checkProjection();
        // Keep the last measured progress visible throughout the next inference.
        report.begin('tile', tileStatus(completedTiles));
        if (hasTransparency && emptyTile(prepared, x, y, tileSize)) {
          skippedTiles++; return new Uint8ClampedArray((tileSize * scale) ** 2 * 4);
        }
        const start = now();
        const key = `${x},${y}`, cached = probed.get(key);
        const result = cached || await runtime.run(sample(x, y));
        probed.delete(key);
        const end = now(), elapsed = end - start;
        if (!cached && lastTileEnd !== undefined) {
          recent.push(end - lastTileEnd); recentInference.push(elapsed);
          if (recent.length > PROJECTION_TILES) { recent.shift(); recentInference.shift(); }
        }
        lastTileEnd = end;
        inferenceMs += elapsed;
        if (benchmark) tileTimes.push(elapsed);
        return result;
      }, (data, width, height, y) => {
        // Alpha is restored after RGB blending. Do not mutate the band's RGB,
        // which is still used to blend the following band.
        if (hasTransparency) applyBandAlpha(data, prepared, y, height, scale);
        context.putImageData(new ImageData(data, width, height), 0, y);
      }, completed => {
        completedTiles = completed;
        status({operation: 'tile', ...tileStatus(completed)});
      }, scale, geometry);
      if (automatic) report({type: 'photo4x-budget', done: true});
    } else skippedTiles = plan.tileCount;
    const tilesMs = now() - tileStarted;
    const compositeStarted = now();
    checkBudget(true);
    source?.close(); source = null; prepared = null;
    await runtime?.release(); runtime = null;
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
    await compositePatches(context, enhanced, scale);
    report.begin('encode', {title: 'encoding', detail: 'encoding_detail', progress: .97, pixels: plan.outputWidth * plan.outputHeight});
    const compositeMs = now() - compositeStarted;
    const encodeStarted = now();
    let blob;
    try { blob = await canvas.convertToBlob(exportOptions(mime)); }
    catch (error) { throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save', undefined, error); }
    if (!blob.size || blob.type !== mime) throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save');
    let result;
    try { result = parseImageHeader(await blob.slice(0, 2 * 1024 * 1024).arrayBuffer()); }
    catch (error) { throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save', undefined, error); }
    if (result.format !== (mime === PNG ? 'png' : 'jpeg') || result.width !== plan.outputWidth || result.height !== plan.outputHeight) throw new PhotoError('export', mime === PNG ? 'err_png_export' : 'err_save');
    const exportMs = now() - encodeStarted;
    checkBudget(true);
    if (automatic && profile && runtimeTimings) {
      const actualMs = probeMs + tilesMs + compositeMs + exportMs;
      const inferenceEstimateMs = Math.max(...probeTimes) * Math.max(plan.tileCount, probeTimes.length);
      const margin = calibratePhoto4xMargin([{inferenceEstimateMs, overheadMs: overhead.assemblyMs + overhead.exportMs, actualMs}]);
      // This run's probe speed was already recorded before tiling.
      profile = updatePhoto4xProfile(profile, {margin, overhead: {
        path: photo4xPath(plan, mime, path), measuredAt: Date.now(),
        assemblyMs: smoothPhoto4xCost(overhead.assemblyMs, Math.ceil((Math.max(0, tilesMs - inferenceMs) + compositeMs) * 1.25)),
        exportMs: smoothPhoto4xCost(overhead.exportMs, Math.ceil(exportMs * 1.25)),
      }});
      report({type: 'photo4x-profile', profileKey: variant.profileKey, profile});
    }
    report({type: 'done', blob, mime, hasTransparency, plan, modelKind, variant, geometry, runtimeTimings, forecast,
      warmupMs, calibrationMs, profileReused: Boolean(automatic && variant.cachedProfile), probeMs, probeTimes, inferenceMs, assemblyMs: Math.max(0, tilesMs - inferenceMs), compositeMs, exportMs,
      upscaleExportMs: probeMs + tilesMs + compositeMs + exportMs, faceCount: enhanced.length,
      detectedCount: faceResults?.detectedCount || 0, faceEnabled, tilesMs, canEdit, baseBlob,
      faces: canEdit ? faces : undefined, skippedTiles, tileTimes, effectiveThreads,
      totalMs: now() - started});
  } catch (error) {
    report({type: 'error', ...pngFailureDetails(error, imageInfo, policy, scale), ...errorDetails(error)});
  } finally {
    source?.close(); prepared = null;
    try { await runtime?.release(); } catch { /* Termination is final cleanup. */ }
    if (output) output.width = output.height = 1;
  }
}

self.onmessage = async ({data}) => {
  if (data.type === 'visibility') { clock?.setHidden(Boolean(data.hidden)); return; }
  if (busy || data.type !== 'prepare') return;
  busy = true;
  // Only variant workers receive the visibility protocol from the controller.
  clock = createActiveClock({hidden: Boolean(data.execution?.variant && data.hidden)});
  try { await processPhoto(data, clock); } finally { busy = false; clock = undefined; }
};
