import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  OPERATION_LABELS, describeActivity, formatCredits, formatDelta, formatPrice, parseDollars, quoteCredits,
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
