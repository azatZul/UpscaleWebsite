import test from 'node:test';
import assert from 'node:assert/strict';
import {nextFocus} from '../../src/tool/overlay.js';

test('Tab wraps inside a full-screen layer in both directions', () => {
  const items = ['close', 'face-1', 'apply'];
  assert.equal(nextFocus(items, 'apply'), 'close');
  assert.equal(nextFocus(items, 'close', true), 'apply');
  assert.equal(nextFocus(items, 'face-1'), 'apply');
});

test('focus outside the layer enters it at the matching end', () => {
  assert.equal(nextFocus(['a', 'b'], 'page'), 'a');
  assert.equal(nextFocus(['a', 'b'], 'page', true), 'b');
  assert.equal(nextFocus(['only'], 'only'), 'only');
  assert.equal(nextFocus([], 'page'), undefined);
});
