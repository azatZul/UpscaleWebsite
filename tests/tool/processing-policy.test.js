import test from 'node:test';
import assert from 'node:assert/strict';
import {learnedTileMs, processingFailureProperties} from '../../src/tool/processing-policy.js';
import {tileMetricKey} from '../../src/tool/model-selection.js';

test('ETA learns full assembly time only with enough tiles and no skipped inference', () => {
  const result = {plan: {tileCount: 25}, tilesMs: 2500, skippedTiles: 0};
  assert.equal(learnedTileMs(result), 100);
  for (const skippedTiles of [1, 9, 24, 25]) assert.equal(learnedTileMs({...result, skippedTiles}), undefined);
  assert.equal(learnedTileMs({...result, plan: {tileCount: 15}}), undefined);
  assert.equal(learnedTileMs({...result, tilesMs: NaN}), undefined);
  assert.equal(learnedTileMs({...result, tilesMs: 0}), undefined);
  assert.equal(tileMetricKey('photo', 2), 'uscale-tile-ms-v2-photo-2');
  assert.equal(tileMetricKey('drawing', 4), 'uscale-tile-ms-v2-drawing-4');
});

test('analytics groups face failures but keeps download distinct and exposes the cause', () => {
  assert.deepEqual(processingFailureProperties('network'), {error_type: 'network'});
  for (const code of ['gpu', 'runtime', 'timeout', 'size', 'format', 'download']) {
    assert.deepEqual(processingFailureProperties(code, 'faces'), {
      error_type: code === 'download' ? 'download' : 'face', error_stage: 'faces', error_reason: code,
    });
    assert.deepEqual(processingFailureProperties(code, 'upscale'), {
      error_type: code, error_stage: 'upscale', error_reason: code,
    });
  }
});
