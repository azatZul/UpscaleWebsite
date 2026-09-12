import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModelAsset, shouldEnhanceFaces, tileMetricKey} from '../../src/tool/model-selection.js';

const models = {
  photo: {
    2: {gpu: 'photo-2-gpu', cpu: 'photo-2-cpu'},
    4: {gpu: 'photo-4-gpu', cpu: 'photo-4-cpu'},
  },
  drawing: {
    2: {gpu: 'drawing-2-gpu', cpu: 'drawing-2-cpu'},
    4: {gpu: 'drawing-4-gpu', cpu: 'drawing-4-cpu'},
  },
};

test('model resolver covers both image types, scales and browser backends', () => {
  for (const modelKind of ['photo', 'drawing']) {
    for (const scale of [2, 4]) {
      assert.equal(resolveModelAsset(models, modelKind, scale, 'webgpu'), `${modelKind}-${scale}-gpu`);
      assert.equal(resolveModelAsset(models, modelKind, scale, 'wasm'), `${modelKind}-${scale}-cpu`);
    }
  }
});

test('model resolver rejects unknown or incomplete selections', () => {
  assert.throws(() => resolveModelAsset(models, 'portrait', 2, 'webgpu'), /Unknown model kind/);
  assert.throws(() => resolveModelAsset(models, 'photo', 3, 'webgpu'), /Unknown upscale scale/);
  assert.throws(() => resolveModelAsset(models, 'photo', 2, 'cpu'), /Unknown model backend/);
  assert.throws(() => resolveModelAsset({photo: {}, drawing: {}}, 'drawing', 4, 'wasm'), /Missing drawing 4x wasm/);
});

test('face enhancement is photo-only and tile timing is isolated per model and scale', () => {
  assert.equal(shouldEnhanceFaces('photo', true), true);
  assert.equal(shouldEnhanceFaces('photo', false), false);
  assert.equal(shouldEnhanceFaces('drawing', true), false);
  assert.equal(tileMetricKey('photo', 2), 'uscale-tile-ms-v2-photo-2');
  assert.equal(tileMetricKey('drawing', 4), 'uscale-tile-ms-v2-drawing-4');
});
