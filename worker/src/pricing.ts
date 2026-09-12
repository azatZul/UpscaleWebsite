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

/** Gross margin on one operation, as a fraction, for credits bought in `pack`.
 *  Stripe's cut is taken off revenue before the upstream cost. */
export function marginFor(operation: Operation, pack: CreditPack): number {
  const revenue = OPERATION_CREDITS[operation] * centsPerCredit(pack);
  const afterStripe = revenue * (1 - stripeFeeCents(pack.priceCents) / pack.priceCents);
  return (afterStripe - UPSTREAM_COST_CENTS[operation]) / revenue;
}
