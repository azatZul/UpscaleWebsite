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
  { id: "starter", credits: 200, priceCents: 500, label: "200 credits" },
  { id: "plus", credits: 650, priceCents: 1500, label: "650 credits" },
  { id: "pro", credits: 1800, priceCents: 4000, label: "1,800 credits" },
];

export const packById = (id: string): CreditPack | undefined =>
  CREDIT_PACKS.find(pack => pack.id === id);

// Cloud processing options, mirroring the iOS app so a photo costs and behaves
// the same whichever surface processes it.
export type CloudKind = "creative" | "restore";
export type CreativeResolution = "2k" | "4k" | "8k";
export type RestoreMode = "restore" | "colorization" | "colorization_pro" | "advanced_restoration";

export type CloudRequest =
  | { kind: "creative"; creativity: number; resolution: CreativeResolution }
  | { kind: "restore"; mode: RestoreMode; increaseResolution: boolean; prompt: string };

export const CREATIVE_RESOLUTIONS: readonly CreativeResolution[] = ["2k", "4k", "8k"];
export const RESTORE_MODES: readonly RestoreMode[] = ["restore", "colorization", "colorization_pro", "advanced_restoration"];
// iOS's five creativity steps: Conservative (-2) through Artistic (2).
export const CREATIVITY_RANGE = { min: -2, max: 2 } as const;
export const MAX_PROMPT_LENGTH = 500;

// What each option costs a customer, in credits.
// One price for every photo: 10 credits, whichever tool runs it and whatever
// options it carries. That is $0.25 at the smallest pack and $0.22 at the
// largest, which is what the dearest tool needs to clear ~70%; the cheaper
// tools simply earn more. A price per tool would earn a little more again, and
// is not worth a price list nobody wants to read.
export const CREDIT_PRICES = {
  creative: { "2k": 10, "4k": 10, "8k": 10 },
  restore: { restore: 10, colorization: 10, colorization_pro: 10, advanced_restoration: 10 },
  // A bigger output is part of the one price, not an extra.
  increaseResolution: 0,
} as const;

// Upscaling in the browser is free and unlimited: the work happens on the
// person's own device and costs us nothing to allow.

// What each option costs upstream, in cents, checked against the providers.
//
//   creative       WaveSpeed image-upscaler, $0.01 per run, and a big photo
//                  is split into as many as four tiles that each cost a run.
//                  Four is the figure here: the published price is flat, but
//                  the page warns the charge grows with output size, and no
//                  8K job has been measured yet.
//   restore        WaveSpeed flux-2-dev/edit, $0.024 per edited image.
//   colorization_pro  WaveSpeed flux-2-pro/edit, $0.06 per edited image. A
//                  job under ~1.17 MP falls back to Replicate, billed $0.015
//                  per run plus $0.015 per input and per output megapixel,
//                  which comes to about $0.055 at the sizes that fall back.
//                  The $0.08 charges in the Replicate dashboard are the app's
//                  own path, which asks for more than 1 MP; the website never
//                  does, so $0.06 is its ceiling.
//   advanced_restoration  Replicate flux-kontext-apps/restore-image, $0.04 per
//                  output image, per-unit: it does not grow with image size.
//   increaseResolution  no charge on WaveSpeed, which bills flat per edited
//                  image, and the website's jobs go there. Worth re-checking
//                  against a measured hi-res job: if WaveSpeed's charge does
//                  grow with output size after all, this factor is the first
//                  thing that has to change.
export const UPSTREAM_COST_CENTS = {
  creative: { "2k": 4, "4k": 4, "8k": 4 },
  restore: { restore: 2.4, colorization: 2.4, colorization_pro: 6, advanced_restoration: 4 },
  increaseResolutionFactor: 1,
} as const;

export function creditsFor(request: CloudRequest): number {
  if (request.kind === "creative") return CREDIT_PRICES.creative[request.resolution];
  return CREDIT_PRICES.restore[request.mode] + (request.increaseResolution ? CREDIT_PRICES.increaseResolution : 0);
}

export function upstreamCostCents(request: CloudRequest): number {
  if (request.kind === "creative") return UPSTREAM_COST_CENTS.creative[request.resolution];
  const base = UPSTREAM_COST_CENTS.restore[request.mode];
  return request.increaseResolution ? base * UPSTREAM_COST_CENTS.increaseResolutionFactor : base;
}

/** Stable label for the ledger and analytics: "creative:8k", "restore:colorization+hires". */
export function priceKey(request: CloudRequest): string {
  if (request.kind === "creative") return `creative:${request.resolution}`;
  return `restore:${request.mode}${request.increaseResolution ? "+hires" : ""}`;
}

/** Every distinct priced variant -- what the margin test must cover. Creativity
 *  and the prompt do not change the provider price, so they are not varied. */
export function allPricedRequests(): CloudRequest[] {
  const creative = CREATIVE_RESOLUTIONS.map(resolution => ({ kind: "creative" as const, creativity: 0, resolution }));
  const restore = RESTORE_MODES.flatMap(mode => [false, true]
    .filter(increaseResolution => !(increaseResolution && mode === "advanced_restoration"))
    .map(increaseResolution => ({ kind: "restore" as const, mode, increaseResolution, prompt: "" })));
  return [...creative, ...restore];
}

/** Replace control characters other than tab and line feed with spaces, so a
 *  prompt cannot smuggle terminal or protocol bytes into logs or the model. */
function cleanPrompt(value: string): string {
  return Array.from(value, char => {
    const code = char.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10) || code === 127 ? " " : char;
  }).join("").trim();
}

/** Validate form fields into a request, or explain why not. Runs before any
 *  credit is charged, so a malformed request never costs anything. */
export function parseCloudRequest(
  kind: string,
  fields: Record<string, string | undefined>,
): CloudRequest | { error: string } {
  if (kind === "creative") {
    const rawCreativity = fields.creativity ?? "0";
    if (!/^-?[0-9]$/.test(rawCreativity)) return { error: "invalid_creativity" };
    const creativity = Number(rawCreativity);
    if (creativity < CREATIVITY_RANGE.min || creativity > CREATIVITY_RANGE.max) return { error: "invalid_creativity" };
    const resolution = (fields.resolution ?? "4k") as CreativeResolution;
    if (!CREATIVE_RESOLUTIONS.includes(resolution)) return { error: "invalid_resolution" };
    return { kind: "creative", creativity, resolution };
  }
  if (kind === "restore") {
    const mode = (fields.mode ?? "restore") as RestoreMode;
    if (!RESTORE_MODES.includes(mode)) return { error: "invalid_mode" };
    const flag = fields.increaseResolution ?? "false";
    if (flag !== "true" && flag !== "false") return { error: "invalid_increase_resolution" };
    const increaseResolution = flag === "true";
    // The iOS app offers neither option with Advanced Fix: it runs a dedicated
    // restoration model that takes no prompt and has a fixed output size.
    if (increaseResolution && mode === "advanced_restoration") return { error: "increase_resolution_unavailable" };
    const prompt = cleanPrompt(fields.prompt ?? "");
    if (prompt.length > MAX_PROMPT_LENGTH) return { error: "prompt_too_long" };
    return { kind: "restore", mode, increaseResolution, prompt: mode === "advanced_restoration" ? "" : prompt };
  }
  return { error: "unknown_operation" };
}

// Stripe takes 2.9% + 30c per transaction, so the fixed part hurts small packs
// disproportionately: 8.9% on a $5 pack against 3.6% on a $40 one.
export function stripeFeeCents(priceCents: number): number {
  return priceCents * 0.029 + 30;
}

/** Effective value of one credit for a pack, in cents. */
export const centsPerCredit = (pack: CreditPack): number => pack.priceCents / pack.credits;

/** Gross margin on one request, as a fraction, for credits bought with a
 *  payment of `amountCents` that granted `credits`. Stripe's cut comes off
 *  revenue before the upstream cost. */
export function marginForPurchase(request: CloudRequest, amountCents: number, credits: number): number {
  const revenue = creditsFor(request) * (amountCents / credits);
  const afterStripe = revenue * (1 - stripeFeeCents(amountCents) / amountCents);
  return (afterStripe - upstreamCostCents(request)) / revenue;
}

export const marginFor = (request: CloudRequest, pack: CreditPack): number =>
  marginForPurchase(request, pack.priceCents, pack.credits);

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
