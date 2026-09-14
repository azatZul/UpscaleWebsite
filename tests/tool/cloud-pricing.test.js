import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PRICES, cheapestCredits, cloudCredits, cloudFields, defaultOptions, normalizeRestore} from '../../src/tool/cloud-pricing.js';

// Same table worker/test/pricing.spec.ts asserts, so the button cannot promise
// a price the worker would not charge.
const PRICES = {
  creative: {'2k': 5, '4k': 5, '8k': 15},
  restore: {restore: 15, colorization: 15, colorization_pro: 35, advanced_restoration: 20},
  increaseResolution: 10,
};

test('prices creative upscale by resolution', () => {
  assert.equal(cloudCredits(PRICES, 'creative', {creativity: 2, resolution: '2k'}), 5);
  assert.equal(cloudCredits(PRICES, 'creative', {creativity: -2, resolution: '8k'}), 15);
});

test('prices restore by mode, plus increased resolution', () => {
  assert.equal(cloudCredits(PRICES, 'restore', {mode: 'colorization_pro', increaseResolution: true}), 45);
  assert.equal(cloudCredits(PRICES, 'restore', {mode: 'restore', increaseResolution: false}), 15);
});

test('advanced fix ignores increased resolution and the prompt, as the worker does', () => {
  const options = {mode: 'advanced_restoration', increaseResolution: true, prompt: 'hat'};
  assert.equal(cloudCredits(PRICES, 'restore', options), 20);
  assert.deepEqual(cloudFields('restore', options), {mode: 'advanced_restoration', increaseResolution: 'false'});
  assert.equal(normalizeRestore(options).prompt, '');
});

test('sends only the fields the worker reads, and the prompt only when there is one', () => {
  assert.deepEqual(cloudFields('creative', defaultOptions().creative), {creativity: '0', resolution: '4k'});
  assert.deepEqual(cloudFields('restore', {mode: 'colorization', increaseResolution: true, negative: true, prompt: '  blue eyes '}),
    {mode: 'colorization', increaseResolution: 'true', prompt: 'blue eyes'});
});

test('reports the cheapest price per mode, and nothing before prices load', () => {
  assert.equal(cheapestCredits(PRICES, 'creative'), 5);
  assert.equal(cheapestCredits(PRICES, 'restore'), 15);
  assert.equal(cloudCredits(null, 'restore', {mode: 'restore'}), null);
  assert.equal(cheapestCredits(null, 'creative'), null);
});

test('ships the worker price table for pricing before sign-in', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_PRICES)), PRICES);
});

