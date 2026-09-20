import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_PRICES, cheapestCredits, cloudCredits, cloudFields, defaultOptions, normalizeRestore} from '../../src/tool/cloud-pricing.js';

// Same table worker/test/pricing.spec.ts asserts, so the button cannot promise
// a price the worker would not charge.
// A table with a price per option, so the arithmetic is visible; the real one
// charges the same for everything, which would hide a mistake here.
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

// The page prices the button before sign-in from DEFAULT_PRICES, and the tile
// badge is rendered from a figure in build.py. Both are copies of the worker's
// table, and a copy that drifts quotes a price the worker will not charge --
// which is exactly what happened when the flat price came in. Read the real
// table and compare, rather than pinning another copy of the numbers here.
test('the prices the page shows before sign-in match the worker', () => {
  const source = readFileSync(new URL('../../worker/src/pricing.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export const CREDIT_PRICES');
  const block = source.slice(start, source.indexOf('} as const;', start));
  assert.ok(start > 0 && block.length > 0, 'found the worker price table');
  const creative = block.slice(block.indexOf('creative:'), block.indexOf('restore:'));
  const restore = block.slice(block.indexOf('restore: {'), block.indexOf('}', block.indexOf('restore: {')));
  const read = (text, key) => Number(text.match(new RegExp(`["']?${key}["']?:\\s*(\\d+)`))[1]);

  for (const resolution of ['2k', '4k', '8k']) {
    assert.equal(DEFAULT_PRICES.creative[resolution], read(creative, resolution), `creative ${resolution}`);
  }
  for (const mode of ['restore', 'colorization', 'colorization_pro', 'advanced_restoration']) {
    assert.equal(DEFAULT_PRICES.restore[mode], read(restore, mode), mode);
  }
  assert.equal(DEFAULT_PRICES.increaseResolution, read(block, 'increaseResolution'));

  // The tile badge, rendered server-side before any price has loaded.
  const build = readFileSync(new URL('../../build/build.py', import.meta.url), 'utf8');
  const badge = Number(build.match(/tag_credits'\].replace\('\{credits\}', '(\d+)'\)/)[1]);
  assert.equal(badge, DEFAULT_PRICES.creative['4k'], 'the tile badge quotes the price of a photo');
});
