import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingEnhancements, sameSelection, selectedPatches} from '../../src/tool/face-selection.js';

const patch = name => ({name});
const face = (patchValue, transform = {a: 1}) => ({patch: patchValue, transform});

test('only selected faces that were never enhanced run the face model', () => {
  const faces = [face(patch('a')), face(null), face(patch('c')), face(null)];
  assert.deepEqual(pendingEnhancements(faces, [true, true, false, false]), [1]);
  assert.deepEqual(pendingEnhancements(faces, [false, false, false, false]), []);
});

test('a face turned off and on again keeps its patch and is not enhanced twice', () => {
  const faces = [face(patch('a')), face(null)];
  assert.deepEqual(pendingEnhancements(faces, [false, true]), [1]);
  faces[1].patch = patch('b');
  assert.deepEqual(pendingEnhancements(faces, [false, false]), []);
  assert.deepEqual(pendingEnhancements(faces, [true, true]), []);
});

test('selected patches keep catalog order and skip faces without one', () => {
  const faces = [face(patch('a'), {i: 0}), face(null, {i: 1}), face(patch('c'), {i: 2})];
  assert.deepEqual(selectedPatches(faces, [true, true, true]).map(item => item.transform.i), [0, 2]);
  assert.deepEqual(selectedPatches(faces, [false, true, true]).map(item => item.patch.name), ['c']);
});

test('an unchanged selection is recognised so Apply can skip the work', () => {
  assert.equal(sameSelection([true, false], [true, false]), true);
  assert.equal(sameSelection([true, false], [true, true]), false);
  assert.equal(sameSelection([true], [true, false]), false);
});
