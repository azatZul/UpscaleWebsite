// Single source of truth for what things cost, in credits and in cents.
// Both checkout and the webhook read from here, so a pack's price and the
// credits it grants can never drift apart.

export interface CreditPack {
  id: string;
  credits: number;
  priceCents: number;
  label: string;
}

// Larger packs carry a bonus, so the effective credit price falls as the pack
// grows. Operation costs below are set against the WORST (lowest) effective
// price, not the headline rate -- otherwise the volume discount quietly eats
// the margin on exactly the customers who buy most.
export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "starter", credits: 500, priceCents: 500, label: "500 credits" },
  { id: "plus", credits: 1650, priceCents: 1500, label: "1,650 credits" },
  { id: "pro", credits: 4800, priceCents: 4000, label: "4,800 credits" },
];

export const packById = (id: string): CreditPack | undefined =>
  CREDIT_PACKS.find(pack => pack.id === id);

export type Operation = "upscale_standard" | "restore" | "upscale_ultimate";

// What each operation costs a customer, in credits.
export const OPERATION_CREDITS: Record<Operation, number> = {
  upscale_standard: 5,
  restore: 20,
  upscale_ultimate: 25,
};

// What each operation costs us upstream, in cents, at the providers actually
// used in production: Wavespeed for upscaling, Replicate for restore. These
// are published rate-card figures and both providers scale price with output
// resolution, so treat them as a floor and re-check against real dashboard
// spend before trusting the margins.
export const UPSTREAM_COST_CENTS: Record<Operation, number> = {
  upscale_standard: 1.0,
  restore: 5.5,
  upscale_ultimate: 6.0,
};

// Stripe takes 2.9% + 30c per transaction, so the fixed part hurts small packs
// disproportionately: 8.9% on a $5 pack against 3.6% on a $40 one.
export function stripeFeeCents(priceCents: number): number {
  return priceCents * 0.029 + 30;
}

/** Effective value of one credit for a pack, in cents. */
export const centsPerCredit = (pack: CreditPack): number => pack.priceCents / pack.credits;

/** Gross margin on one operation, as a fraction, for credits bought with a
 *  payment of `amountCents` that granted `credits`. Stripe's cut comes off
 *  revenue before the upstream cost. */
export function marginForPurchase(operation: Operation, amountCents: number, credits: number): number {
  const revenue = OPERATION_CREDITS[operation] * (amountCents / credits);
  const afterStripe = revenue * (1 - stripeFeeCents(amountCents) / amountCents);
  return (afterStripe - UPSTREAM_COST_CENTS[operation]) / revenue;
}

export const marginFor = (operation: Operation, pack: CreditPack): number =>
  marginForPurchase(operation, pack.priceCents, pack.credits);

// Custom top-ups. Whole dollars only: it keeps the credit arithmetic exact and
// the input simple, and nobody needs to buy $12.37 of credits.
export const MIN_PURCHASE_CENTS = 500;
export const MAX_PURCHASE_CENTS = 50_000;

export interface CreditQuote {
  amountCents: number;
  credits: number;
  /** The pack whose rate applies -- the largest one the amount reaches. */
  tierId: string;
  /** Bonus over the base rate, in whole percent, for display. */
  bonusPercent: number;
}

/** Credits for a custom amount, or null when the amount is not purchasable.
 *
 *  An amount earns the rate of the largest pack it reaches, so $20 buys at the
 *  $15 pack's rate and $100 at the $40 pack's. That keeps custom amounts from
 *  ever undercutting the packs: within one tier the credit rate is fixed while
 *  Stripe's fixed 30c shrinks as a share of the payment, so a tier's margin is
 *  lowest at its bottom edge -- which is exactly the preset pack the margin
 *  test already covers. */
export function quoteCredits(amountCents: number): CreditQuote | null {
  if (!Number.isSafeInteger(amountCents) || amountCents % 100 !== 0) return null;
  if (amountCents < MIN_PURCHASE_CENTS || amountCents > MAX_PURCHASE_CENTS) return null;
  const byPrice = [...CREDIT_PACKS].sort((a, b) => a.priceCents - b.priceCents);
  const tier = byPrice.filter(pack => pack.priceCents <= amountCents).pop();
  if (!tier) return null;
  const base = byPrice[0]!;
  return {
    amountCents,
    credits: Math.floor((amountCents * tier.credits) / tier.priceCents),
    tierId: tier.id,
    bonusPercent: Math.round((centsPerCredit(base) / centsPerCredit(tier) - 1) * 100),
  };
}
