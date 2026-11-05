import {assembleTiles} from './tile-pipeline.js';
import {compositePatches} from './face-composite.js';
import {applyBandAlpha, exportOptions} from './transparency.js';
import {PhotoError} from './capability.js';
import {PHOTO4X_CALIBRATION_MS, photo4xPath} from './photo4x-policy.js';
import {createActiveClock} from './active-clock.js';

// Exercise the real tiler, alpha path, canvas and encoder, without another full
// output buffer. High-entropy RGB avoids a deceptively cheap solid-colour PNG.
export async function calibratePhoto4xOutput({plan, geometry, canvas, context, mime, prepared, faces, baseExport, report, clock = createActiveClock()}) {
  const {now} = clock;
  await clock.waitUntilVisible();
  const started = now();
  const check = () => { if (now() - started >= PHOTO4X_CALIBRATION_MS) throw new PhotoError('budget', 'err_speed'); };
  report.begin('calibrate', {title: 'initializing', detail: 'initializing_detail'});
  const pixels = new Uint8ClampedArray((geometry.tileSize * plan.scale) ** 2 * 4);
  let seed = 0x624f3a19;
  for (let i = 0; i < pixels.length; i += 4) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    pixels[i] = seed & 255; pixels[i + 1] = (seed >>> 8) & 255; pixels[i + 2] = (seed >>> 16) & 255; pixels[i + 3] = 255;
  }
  const assemblyStart = now();
  await assembleTiles(plan.width, plan.height, async () => { await clock.waitUntilVisible(); check(); return pixels; }, async (data, width, height, y) => {
    check();
    if (prepared) applyBandAlpha(data, prepared, y, height, plan.scale);
    context.putImageData(new ImageData(data, width, height), 0, y);
    // Yield at row boundaries so cancellation and the calibration watchdog run.
    await new Promise(resolve => setTimeout(resolve, 0));
  }, completed => report.status({operation: 'calibrate', completed, total: plan.tileCount}), plan.scale, geometry);
  let assemblyMs = now() - assemblyStart, exportMs = 0;
  const encode = async () => {
    await clock.waitUntilVisible();
    check(); const t = now();
    let blob = await canvas.convertToBlob(exportOptions(mime));
    if (!blob.size || blob.type !== mime) throw new PhotoError('export', 'err_save');
    exportMs += now() - t;
    blob = null;
    check();
  };
  if (baseExport) await encode();
  const compositeStart = now();
  await compositePatches(context, faces, plan.scale);
  assemblyMs += now() - compositeStart;
  await encode();
  context.clearRect(0, 0, canvas.width, canvas.height);
  return {path: photo4xPath(plan, mime, {hasTransparency: Boolean(prepared), baseExport}),
    assemblyMs: Math.ceil(assemblyMs * 1.25), exportMs: Math.ceil(exportMs * 1.25),
    measuredAt: Date.now(), calibrationMs: now() - started};
}
