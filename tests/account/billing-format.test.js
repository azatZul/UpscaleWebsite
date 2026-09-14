import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  OPERATION_LABELS, describeActivity, describePriceKey, formatCredits, formatDelta, formatPrice, parseDollars, priceList,
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
  assert.equal(describeActivity({reason: 'spend', detail: 'creative:4k'}), 'Creative upscale · 4K');
  assert.equal(describeActivity({reason: 'reversal', detail: 'restore:colorization'}), 'Refund · Restore & Colorize failed');
});

test('lists what credits buy from the price table', () => {
  const rows = priceList({
    creative: {'2k': 5, '4k': 5, '8k': 15},
    restore: {restore: 15, colorization: 15, colorization_pro: 35, advanced_restoration: 20},
    increaseResolution: 10,
  });
  assert.deepEqual(rows.map(row => [row.label, row.credits]), [
    ['Creative upscale · 2K or 4K', 5], ['Creative upscale · 8K', 15], ['Restore', 15], ['Restore & Colorize', 15],
    ['Enhanced Colorize', 35], ['Advanced Fix', 20], ['Increased resolution', 10],
  ]);
  assert.deepEqual(priceList(null), []);
});

