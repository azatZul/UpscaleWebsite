import test from 'node:test';
import assert from 'node:assert/strict';
import {cropRegion, decodeYuNet, detectionGeometry, detectionSide, faceFinderInput, mergeFaces, sameFace} from '../../src/tool/face-detect.js';
import {devicePolicy} from '../../src/tool/capability.js';

// Zeroed tensors for every stride, so only the cells a test fills can score.
function tensors(padWidth, padHeight) {
  const out = {};
  for (const stride of [8, 16, 32]) {
    const cells = (padWidth / stride) * (padHeight / stride);
    out[`cls_${stride}`] = new Float32Array(cells);
    out[`obj_${stride}`] = new Float32Array(cells);
    out[`bbox_${stride}`] = new Float32Array(cells * 4);
    out[`kps_${stride}`] = new Float32Array(cells * 10);
  }
  return out;
}

function place(out, {stride, columns, column, row, score, size, offset = .5}) {
  const cell = row * columns + column;
  out[`cls_${stride}`][cell] = score;
  out[`obj_${stride}`][cell] = score;
  out[`bbox_${stride}`].set([offset, offset, Math.log(size / stride), Math.log(size / stride)], cell * 4);
  // Five alignment points, all a fifth of a cell past its corner.
  out[`kps_${stride}`].set(Array.from({length: 10}, () => .2), cell * 10);
  return cell;
}

test('detection side follows the device policy', () => {
  assert.equal(detectionSide(devicePolicy({userAgent: 'iPhone'})), 640);
  assert.equal(detectionSide(devicePolicy({userAgent: 'Android Mobile'})), 640);
  assert.equal(detectionSide(devicePolicy()), 1280);
});

test('detection input never upscales and pads to whole blocks of 32', () => {
  const wide = detectionGeometry(1000, 500, 640);
  assert.deepEqual([wide.drawWidth, wide.drawHeight], [640, 320]);
  assert.deepEqual([wide.padWidth, wide.padHeight], [640, 320]);
  const photo = detectionGeometry(3024, 1934, 1280);
  assert.deepEqual([photo.drawWidth, photo.drawHeight], [1280, 819]);
  assert.deepEqual([photo.padWidth, photo.padHeight], [1280, 832]);
  const small = detectionGeometry(300, 200, 1280);
  assert.equal(small.scale, 1);
  assert.deepEqual([small.padWidth, small.padHeight], [320, 224]);
});

test('decoding maps a cell back to the photo, with its five alignment points', () => {
  const geometry = detectionGeometry(1000, 500, 640);
  const out = tensors(geometry.padWidth, geometry.padHeight);
  place(out, {stride: 16, columns: 40, column: 10, row: 5, score: 1, size: 64});
  const [face] = decodeYuNet(out, geometry);
  // Cell (10,5) at stride 16 centres a 64 px box at (168,88) in the padded
  // input; the photo was drawn at 0.64, so it lands here in source pixels.
  [face.x1, face.y1, face.x2, face.y2].forEach((value, index) => {
    assert.ok(Math.abs(value - [212.5, 87.5, 312.5, 187.5][index]) < .01);
  });
  assert.equal(face.points.length, 5);
  assert.ok(Math.abs(face.points[0].x - 255) < .01);
  assert.ok(Math.abs(face.points[0].y - 130) < .01);
  assert.ok(Math.abs(face.score - 1) < 1e-6);
});

test('weak cells are dropped and the same face found on two strides is merged once', () => {
  const geometry = detectionGeometry(1000, 500, 640);
  const out = tensors(geometry.padWidth, geometry.padHeight);
  place(out, {stride: 16, columns: 40, column: 10, row: 5, score: 1, size: 64});
  // The same face seen by the next stride, slightly offset and less certain.
  place(out, {stride: 32, columns: 20, column: 5, row: 2, score: .8, size: 64, offset: .75});
  // Below the confidence threshold, far from the others.
  place(out, {stride: 16, columns: 40, column: 30, row: 15, score: .5, size: 64});
  const faces = decodeYuNet(out, geometry);
  assert.equal(faces.length, 1);
  assert.ok(Math.abs(faces[0].score - 1) < 1e-6);
});

test('overlap treats a box mostly inside another as the same face', () => {
  const big = {x1: 0, y1: 0, x2: 100, y2: 100};
  const inside = {x1: 10, y1: 10, x2: 60, y2: 60};
  const apart = {x1: 200, y1: 200, x2: 300, y2: 300};
  assert.ok(sameFace(big, inside));
  assert.ok(!sameFace(big, apart));
  assert.equal(mergeFaces([{...big, score: .7}, {...inside, score: .9}, {...apart, score: .8}]).length, 2);
});

test('the landmark crop is a square around the head, and can reach past the edge', () => {
  const centred = cropRegion({x1: 400, y1: 300, x2: 500, y2: 440});
  assert.equal(centred.side, 308);
  assert.equal(centred.x, 450 - 154);
  assert.equal(centred.y, 370 - 154);
  const corner = cropRegion({x1: 0, y1: 0, x2: 40, y2: 40});
  assert.ok(corner.x < 0 && corner.y < 0);
});

test('canvas pixels are packed as the BGR planes YuNet was trained on', () => {
  const geometry = {padWidth: 2, padHeight: 1};
  // Two pixels: pure red, then pure blue.
  const values = faceFinderInput(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), geometry);
  assert.deepEqual([...values], [0, 255, 0, 0, 255, 0]);
});
