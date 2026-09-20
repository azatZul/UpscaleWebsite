// Cloud mode options and their credit price, for the page. The worker charges
// (worker/src/pricing.ts creditsFor); this only previews it on the button, from
// the price table the worker itself serves at /api/billing/packs.

// The worker's price table as shipped, for pricing the button before sign-in
// (the live table needs a token). tests/tool/cloud-pricing.test.js pins it to
// the same numbers worker/test/pricing.spec.ts asserts.
export const DEFAULT_PRICES = Object.freeze({
  creative: Object.freeze({'2k': 10, '4k': 10, '8k': 10}),
  restore: Object.freeze({restore: 10, colorization: 10, colorization_pro: 10, advanced_restoration: 10}),
  increaseResolution: 0,
});

export const RESOLUTIONS = ['2k', '4k', '8k'];
export const RESTORE_MODES = ['restore', 'colorization', 'colorization_pro', 'advanced_restoration'];
export const CREATIVITY = {min: -2, max: 2};

export const defaultOptions = () => ({
  creative: {creativity: 0, resolution: '4k'},
  restore: {mode: 'restore', increaseResolution: false, negative: false, prompt: ''},
});

/** Advanced Fix takes neither increased resolution nor a prompt, as in the app. */
export function normalizeRestore(options) {
  const mode = RESTORE_MODES.includes(options.mode) ? options.mode : 'restore';
  const advanced = mode === 'advanced_restoration';
  return {...options, mode, increaseResolution: advanced ? false : Boolean(options.increaseResolution),
    prompt: advanced ? '' : String(options.prompt || '')};
}

export function cloudCredits(prices, mode, options) {
  if (!prices) return null;
  if (mode === 'creative') return prices.creative?.[options.resolution] ?? null;
  if (mode === 'restore') {
    const restore = normalizeRestore(options);
    const base = prices.restore?.[restore.mode];
    if (base === undefined) return null;
    return base + (restore.increaseResolution ? prices.increaseResolution : 0);
  }
  return null;
}

/** Lowest price in a mode, for a "from N credits" line. */
export function cheapestCredits(prices, mode) {
  if (!prices) return null;
  const values = mode === 'creative' ? Object.values(prices.creative || {}) : Object.values(prices.restore || {});
  return values.length ? Math.min(...values) : null;
}

/** Form fields the worker's parseCloudRequest reads. Negative is applied to the
 *  image before upload, so it is not a field. */
export function cloudFields(mode, options) {
  if (mode === 'creative') {
    return {creativity: String(options.creativity), resolution: options.resolution};
  }
  const restore = normalizeRestore(options);
  const fields = {mode: restore.mode, increaseResolution: String(restore.increaseResolution)};
  const prompt = restore.prompt.trim();
  if (prompt) fields.prompt = prompt;
  return fields;
}
