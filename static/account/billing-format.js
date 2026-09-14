// Pure billing helpers for the account page, testable without a browser.
// The worker is authoritative on every number; these only preview it.

export const OPERATION_LABELS = {
  upscale_standard: 'Upscale',
  restore: 'Restore',
  upscale_ultimate: 'Ultimate upscale',
};

/** Group digits: 1650 -> "1,650". Fixed to en-US so the page reads consistently. */
export function formatCredits(credits) {
  return Number(credits).toLocaleString('en-US');
}

/** Cents to a price. Whole dollars lose the ".00" -- $5, not $5.00. */
export function formatPrice(cents) {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars.toLocaleString('en-US') : dollars.toFixed(2)}`;
}

/** Parse what someone typed into the custom amount field into cents.
 *  Whole dollars only, matching the worker; "25", "$25" and "25.00" all work,
 *  "25.50" does not. Returns null for anything else. */
export function parseDollars(input) {
  const cleaned = String(input ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,6}(\.0{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Preview of the worker's quoteCredits: an amount earns the rate of the
 *  largest pack it reaches. Returns null outside the limits. */
export function quoteCredits(amountCents, packs, limits) {
  if (!Number.isSafeInteger(amountCents) || amountCents % 100 !== 0) return null;
  if (amountCents < limits.minCents || amountCents > limits.maxCents) return null;
  const byPrice = [...packs].sort((a, b) => a.priceCents - b.priceCents);
  const tier = byPrice.filter(pack => pack.priceCents <= amountCents).pop();
  if (!tier) return null;
  const base = byPrice[0];
  const rate = pack => pack.credits / pack.priceCents;
  return {
    amountCents,
    credits: Math.floor((amountCents * tier.credits) / tier.priceCents),
    tierId: tier.id,
    bonusPercent: Math.round((rate(tier) / rate(base) - 1) * 100),
  };
}

/** A ledger row as a line of text for the activity list. */
export function describeActivity(entry) {
  const operation = OPERATION_LABELS[entry.detail] || 'Cloud enhancement';
  switch (entry.reason) {
    case 'purchase': return 'Credits added';
    case 'spend': return operation;
    case 'reversal': return `Refund · ${operation} failed`;
    case 'refund': return 'Payment refunded';
    case 'grant': return 'Credits granted';
    default: return 'Credit adjustment';
  }
}

export function formatDelta(delta) {
  return `${delta > 0 ? '+' : '−'}${formatCredits(Math.abs(delta))}`;
}
