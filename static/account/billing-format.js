// Pure formatting for the billing UI, so it can be tested without a browser.

export const OPERATION_LABELS = {
  upscale_standard: 'Upscale',
  restore: 'Restore',
  upscale_ultimate: 'Ultimate upscale',
};

/** Group digits the way the reader's locale does: 1650 -> "1,650". */
export function formatCredits(credits) {
  return Number(credits).toLocaleString();
}

/** Cents to a price. Whole dollars lose the ".00" -- $5, not $5.00. */
export function formatPrice(cents) {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}
