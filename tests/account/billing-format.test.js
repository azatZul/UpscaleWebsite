import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  OPERATION_LABELS, describeActivity, describeHistoryItem, describePriceKey, formatBytes, formatCredits, formatDelta, formatPrice, parseDollars,
  photoPrice, priceList,
  quoteCredits,
} from '../../static/account/billing-format.js';

// Mirrors worker/src/pricing.ts. The expectations below are the same numbers
// worker/test/pricing.spec.ts asserts, so a divergence fails one side or both.
const PACKS = [
  {id: 'starter', credits: 500, priceCents: 500},
  {id: 'plus', credits: 1650, priceCents: 1500},
  {id: 'pro', credits: 4800, priceCents: 4000},
];
const LIMITS = {minCents: 500, maxCents: 50000};

test('groups credit digits', () => {
  assert.equal(formatCredits(500), '500');
  assert.equal(formatCredits(1650), '1,650');
  assert.equal(formatCredits(12000), '12,000');
});

test('drops the cents on whole dollars but keeps them otherwise', () => {
  assert.equal(formatPrice(500), '$5');
  assert.equal(formatPrice(4000), '$40');
  assert.equal(formatPrice(1299), '$12.99');
});

test('parses whole-dollar input in the forms people type', () => {
  assert.equal(parseDollars('25'), 2500);
  assert.equal(parseDollars(' $25 '), 2500);
  assert.equal(parseDollars('25.00'), 2500);
  assert.equal(parseDollars('1,000'), 100000);
  for (const bad of ['', '25.50', 'abc', '-5', '5e2', '$']) assert.equal(parseDollars(bad), null, bad);
});

test('quotes the same credits the worker grants', () => {
  assert.equal(quoteCredits(500, PACKS, LIMITS).credits, 500);
  assert.equal(quoteCredits(1500, PACKS, LIMITS).credits, 1650);
  assert.equal(quoteCredits(2000, PACKS, LIMITS).credits, 2200);
  assert.equal(quoteCredits(2500, PACKS, LIMITS).credits, 2750);
  assert.equal(quoteCredits(10000, PACKS, LIMITS).credits, 12000);
  assert.equal(quoteCredits(10000, PACKS, LIMITS).bonusPercent, 20);
  for (const bad of [400, 550, 50100]) assert.equal(quoteCredits(bad, PACKS, LIMITS), null, String(bad));
});

test('describes every ledger reason, including unknown operations', () => {
  assert.equal(describeActivity({reason: 'purchase', detail: 'plus'}), 'Credits added');
  assert.equal(describeActivity({reason: 'spend', detail: 'restore'}), 'Restore');
  assert.equal(describeActivity({reason: 'reversal', detail: 'upscale_ultimate'}), 'Refund · Ultimate upscale failed');
  assert.equal(describeActivity({reason: 'spend', detail: 'something_new'}), 'Cloud enhancement');
  assert.equal(formatDelta(500), '+500');
  assert.equal(formatDelta(-20), '−20');
});

test('labels every operation the worker reports', () => {
  for (const operation of ['upscale_standard', 'restore', 'upscale_ultimate']) {
    assert.ok(OPERATION_LABELS[operation], `missing label for ${operation}`);
  }
});

test('names option-based price keys, and still names the older operations', () => {
  assert.equal(describePriceKey('creative:8k'), 'Creative upscale · 8K');
  assert.equal(describePriceKey('restore:colorization_pro+hires'), 'Enhanced Colorize · increased resolution');
  assert.equal(describePriceKey('restore:advanced_restoration'), 'Advanced Fix');
  assert.equal(describePriceKey('restore'), 'Restore');
  assert.equal(describePriceKey('restore:bogus'), null);
  assert.equal(describePriceKey('device:upscale'), 'Upscale on device');
  assert.equal(describeActivity({reason: 'spend', detail: 'creative:4k'}), 'Creative upscale · 4K');
  assert.equal(describeActivity({reason: 'reversal', detail: 'restore:colorization'}), 'Refund · Restore & Colorize failed');
});

test('lists what credits buy from the price table', () => {
  const rows = priceList({
    creative: {'2k': 10, '4k': 10, '8k': 10},
    restore: {restore: 10, colorization: 10, colorization_pro: 10, advanced_restoration: 10},
    increaseResolution: 0,
  });
  assert.deepEqual(rows.map(row => [row.label, row.credits]), [['Any photo', 10]]);
  assert.deepEqual(priceList(null), []);
});

test('reads the ordinary photo price as the one most operations share', () => {
  assert.equal(photoPrice({creative: {'2k': 10, '4k': 10, '8k': 10}, restore: {restore: 10, colorization_pro: 20}}), 10);
  // A tie goes to the cheaper figure, so an estimate never flatters a pack.
  assert.equal(photoPrice({creative: {'4k': 5}, restore: {restore: 15}}), 5);
  assert.equal(photoPrice(null), null);
  assert.equal(photoPrice({}), null);
});

test('keeps operations apart when their prices differ', () => {
  const rows = priceList({
    creative: {'2k': 5, '4k': 5, '8k': 15},
    restore: {restore: 15, colorization: 15, colorization_pro: 35, advanced_restoration: 20},
    increaseResolution: 10,
  });
  assert.deepEqual(rows.map(row => [row.label, row.credits]), [
    ['Creative upscale · 2K or 4K', 5],
    ['Any photo', 15],
    ['Advanced Fix', 20],
    ['Enhanced Colorize', 35],
    ['Increased resolution', 10],
  ]);
});

test('titles a saved result by its mode and price-changing option', () => {
  assert.equal(describeHistoryItem({operation: 'creative', options: {resolution: '8k', creativity: 2}}), 'Creative upscale · 8K');
  assert.equal(describeHistoryItem({operation: 'restore', options: {mode: 'colorization', increaseResolution: true}}),
    'Restore & Colorize · increased resolution');
  assert.equal(describeHistoryItem({operation: 'restore', options: {}}), 'Restore');
});

test('formats storage sizes the way people read them', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(340 * 1024), '340 KB');
  assert.equal(formatBytes(1.5 * 1024 ** 2), '1.5 MB');
  assert.equal(formatBytes(2 * 1024 ** 3), '2 GB');
  assert.equal(formatBytes(-4), '0 B');
});

