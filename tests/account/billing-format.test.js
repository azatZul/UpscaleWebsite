import assert from 'node:assert/strict';
import {test} from 'node:test';

import {OPERATION_LABELS, formatCredits, formatPrice} from '../../static/account/billing-format.js';

test('groups credit digits', () => {
  assert.equal(formatCredits(500), '500');
  assert.equal(formatCredits(1650), '1,650');
  assert.equal(formatCredits(4800), '4,800');
});

test('drops the cents on whole dollars but keeps them otherwise', () => {
  assert.equal(formatPrice(500), '$5');
  assert.equal(formatPrice(4000), '$40');
  assert.equal(formatPrice(1299), '$12.99');
});

test('labels every operation the worker reports', () => {
  // Mirrors OPERATION_CREDITS in worker/src/pricing.ts; an operation added
  // there without a label here would render as a bare identifier.
  for (const operation of ['upscale_standard', 'restore', 'upscale_ultimate']) {
    assert.ok(OPERATION_LABELS[operation], `missing label for ${operation}`);
  }
});
