import { describe, expect, it } from "vitest";

import {
  CREDIT_PACKS, MAX_PURCHASE_CENTS, MIN_PURCHASE_CENTS, OPERATION_CREDITS, UPSTREAM_COST_CENTS,
  centsPerCredit, marginFor, marginForPurchase, packById, quoteCredits, type Operation,
} from "../src/pricing";

const OPERATIONS = Object.keys(OPERATION_CREDITS) as Operation[];
// The business floor. If a price change drops any operation below this on any
// pack, that is a bug, not a pricing tweak.
const MINIMUM_MARGIN = 0.5;

describe("pricing", () => {
  it("clears 50% gross margin on every operation, on every pack", () => {
    for (const pack of CREDIT_PACKS) {
      for (const operation of OPERATIONS) {
        const margin = marginFor(operation, pack);
        expect(margin, `${operation} on ${pack.id} = ${(margin * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(MINIMUM_MARGIN);
      }
    }
  });

  it("is checked against the worst tier, where the bonus is largest", () => {
    // The biggest pack has the lowest effective credit price, so it is the
    // binding constraint -- guard against a future pack that undercuts it.
    const cheapest = Math.min(...CREDIT_PACKS.map(centsPerCredit));
    const biggest = CREDIT_PACKS.reduce((a, b) => (a.priceCents > b.priceCents ? a : b));
    expect(centsPerCredit(biggest)).toBeCloseTo(cheapest, 10);
  });

  it("bigger packs are better value, never worse", () => {
    const sorted = [...CREDIT_PACKS].sort((a, b) => a.priceCents - b.priceCents);
    for (let i = 1; i < sorted.length; i++) {
      expect(centsPerCredit(sorted[i]!)).toBeLessThan(centsPerCredit(sorted[i - 1]!));
    }
  });

  it("prices every operation above its upstream cost with real headroom", () => {
    for (const operation of OPERATIONS) {
      const worst = Math.min(...CREDIT_PACKS.map(centsPerCredit));
      const revenue = OPERATION_CREDITS[operation] * worst;
      expect(revenue / UPSTREAM_COST_CENTS[operation]).toBeGreaterThanOrEqual(2.1);
    }
  });

  it("looks packs up by id and rejects unknown ones", () => {
    expect(packById("pro")?.credits).toBe(4800);
    expect(packById("nope")).toBeUndefined();
  });

  it("quotes each preset pack exactly as the pack itself", () => {
    for (const pack of CREDIT_PACKS) {
      expect(quoteCredits(pack.priceCents)).toMatchObject({ credits: pack.credits, tierId: pack.id });
    }
  });

  it("gives a custom amount the rate of the largest pack it reaches", () => {
    expect(quoteCredits(1_000)).toMatchObject({ credits: 1_000, tierId: "starter", bonusPercent: 0 });
    expect(quoteCredits(2_000)).toMatchObject({ credits: 2_200, tierId: "plus", bonusPercent: 10 });
    expect(quoteCredits(10_000)).toMatchObject({ credits: 12_000, tierId: "pro", bonusPercent: 20 });
  });

  it("refuses amounts outside the purchasable range or with cents", () => {
    for (const cents of [0, 100, MIN_PURCHASE_CENTS - 100, MAX_PURCHASE_CENTS + 100, 550, -500, 1.5, Number.NaN]) {
      expect(quoteCredits(cents), String(cents)).toBeNull();
    }
    expect(quoteCredits(MIN_PURCHASE_CENTS)).not.toBeNull();
    expect(quoteCredits(MAX_PURCHASE_CENTS)).not.toBeNull();
  });

  it("clears 50% margin on every operation for every purchasable whole-dollar amount", () => {
    // Exhaustive rather than sampled: 496 amounts times three operations is
    // cheap, and it is the only way to be sure no tier edge dips under.
    for (let cents = MIN_PURCHASE_CENTS; cents <= MAX_PURCHASE_CENTS; cents += 100) {
      const quote = quoteCredits(cents)!;
      for (const operation of OPERATIONS) {
        const margin = marginForPurchase(operation, cents, quote.credits);
        expect(margin, `${operation} at $${cents / 100}`).toBeGreaterThanOrEqual(MINIMUM_MARGIN);
      }
    }
  });

  it("never gives fewer credits for paying more", () => {
    let previous = 0;
    for (let cents = MIN_PURCHASE_CENTS; cents <= MAX_PURCHASE_CENTS; cents += 100) {
      const credits = quoteCredits(cents)!.credits;
      expect(credits, `$${cents / 100}`).toBeGreaterThan(previous);
      previous = credits;
    }
  });
});
