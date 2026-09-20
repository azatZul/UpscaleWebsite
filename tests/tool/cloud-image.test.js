import test from 'node:test';
import assert from 'node:assert/strict';
import {CREATIVE_MAX_SIDE, FLUX_MAX_PIXELS, RESTORE_MAX_SIDE, uploadPlan} from '../../src/tool/cloud-image.js';

test('restore modes upload under a megapixel, snapped to 16, cropped', () => {
  const plan = uploadPlan(4000, 3000, 'restore', {mode: 'restore'});
  assert.equal(plan.crop, true);
  assert.equal(plan.width % 16, 0);
  assert.equal(plan.height % 16, 0);
  assert.ok(plan.width * plan.height <= FLUX_MAX_PIXELS, `${plan.width}x${plan.height}`);
  assert.ok(Math.abs(plan.width / plan.height - 4 / 3) < 0.03);
});

test('a small photo is scaled up to the 512 px short-side floor', () => {
  const plan = uploadPlan(400, 300, 'restore', {mode: 'colorization'});
  assert.ok(Math.min(plan.width, plan.height) >= 512 - 16, `${plan.width}x${plan.height}`);
});

test('increased resolution and advanced fix cap the long side at 4032 without cropping', () => {
  for (const options of [{mode: 'restore', increaseResolution: true}, {mode: 'advanced_restoration'}]) {
    const plan = uploadPlan(6000, 4000, 'restore', options);
    assert.deepEqual(plan, {width: RESTORE_MAX_SIDE, height: 2688, crop: false});
  }
  assert.deepEqual(uploadPlan(1200, 900, 'restore', {mode: 'advanced_restoration'}), {width: 1200, height: 900, crop: false});
});

test('creative upscale keeps the original, capped at 6144', () => {
  assert.deepEqual(uploadPlan(3000, 2000, 'creative'), {width: 3000, height: 2000, crop: false});
  assert.deepEqual(uploadPlan(12288, 6144, 'creative'), {width: CREATIVE_MAX_SIDE, height: 3072, crop: false});
});
