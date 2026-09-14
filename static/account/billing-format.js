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

export const RESTORE_MODE_LABELS = {
  restore: 'Restore',
  colorization: 'Restore & Colorize',
  colorization_pro: 'Enhanced Colorize',
  advanced_restoration: 'Advanced Fix',
};

/** A worker price key ("creative:8k", "restore:colorization+hires") as a label.
 *  Falls back to the older operation names for ledger rows written before
 *  option-based pricing. */
export function describePriceKey(key) {
  if (typeof key !== 'string') return null;
  const creative = /^creative:(2k|4k|8k)$/.exec(key);
  if (creative) return `Creative upscale · ${creative[1].toUpperCase()}`;
  const restore = /^restore:([a-z_]+?)(\+hires)?$/.exec(key);
  if (restore && RESTORE_MODE_LABELS[restore[1]]) {
    return `${RESTORE_MODE_LABELS[restore[1]]}${restore[2] ? ' · increased resolution' : ''}`;
  }
  return OPERATION_LABELS[key] || null;
}

/** Rows for "What credits buy", from the worker's price table. */
export function priceList(prices) {
  if (!prices) return [];
  const rows = [];
  const {creative = {}, restore = {}} = prices;
  if (creative['2k'] !== undefined && creative['2k'] === creative['4k']) {
    rows.push({label: 'Creative upscale · 2K or 4K', credits: creative['4k']});
  } else {
    for (const resolution of ['2k', '4k']) {
      if (creative[resolution] !== undefined) rows.push({label: `Creative upscale · ${resolution.toUpperCase()}`, credits: creative[resolution]});
    }
  }
  if (creative['8k'] !== undefined) rows.push({label: 'Creative upscale · 8K', credits: creative['8k']});
  for (const [mode, label] of Object.entries(RESTORE_MODE_LABELS)) {
    if (restore[mode] !== undefined) rows.push({label, credits: restore[mode]});
  }
  if (prices.increaseResolution) rows.push({label: 'Increased resolution', credits: prices.increaseResolution, extra: true});
  return rows;
}

/** A ledger row as a line of text for the activity list. */
export function describeActivity(entry) {
  const operation = describePriceKey(entry.detail) || 'Cloud enhancement';
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

/** A saved result's title: its mode and the option that changed its price. */
export function describeHistoryItem(item) {
  const options = item?.options || {};
  if (item?.operation === 'creative') {
    return `Creative upscale · ${String(options.resolution || '4k').toUpperCase()}`;
  }
  const mode = RESTORE_MODE_LABELS[options.mode] || 'Restore';
  return options.increaseResolution ? `${mode} · increased resolution` : mode;
}

/** Storage sizes in the units people read them in: 340 KB, 12.5 MB, 2 GB. */
export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  const units = [['GB', 1024 ** 3], ['MB', 1024 ** 2], ['KB', 1024]];
  for (const [unit, size] of units) {
    if (value >= size) {
      const amount = value / size;
      return `${amount >= 10 || Number.isInteger(amount) ? Math.round(amount) : amount.toFixed(1)} ${unit}`;
    }
  }
  return `${value} B`;
}

