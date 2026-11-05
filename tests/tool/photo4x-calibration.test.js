import test from 'node:test';
import assert from 'node:assert/strict';
import {createActiveClock} from '../../src/tool/active-clock.js';
import {calibratePhoto4xOutput} from '../../src/tool/photo4x-calibration.js';

test('background suspension during calibration does not reject or inflate its measured export cost', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
  Object.defineProperty(globalThis, 'ImageData', {value: class {}, configurable: true});
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'ImageData', original);
    else delete globalThis.ImageData;
  });
  let time = 0;
  const clock = createActiveClock({now: () => time});
  const result = await calibratePhoto4xOutput({
    plan: {width: 2, height: 2, outputWidth: 4, outputHeight: 4, scale: 2, tileCount: 1},
    geometry: {tileSize: 4, overlap: 1}, faces: [], mime: 'image/png', clock,
    canvas: {width: 4, height: 4, async convertToBlob() {
      time += 10; clock.setHidden(true);
      time += 600_000; clock.setHidden(false);
      time += 10;
      return {size: 100, type: 'image/png'};
    }},
    context: {putImageData() { time += 5; }, clearRect() {}},
    report: {begin() {}, status() {}},
  });
  assert.equal(result.calibrationMs, 25);
  assert.equal(result.assemblyMs, 7);
  assert.equal(result.exportMs, 25);
});
