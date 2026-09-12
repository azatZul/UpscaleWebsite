import { describe, expect, it } from "vitest";

import {
  CREDIT_PACKS, OPERATION_CREDITS, UPSTREAM_COST_CENTS,
  centsPerCredit, marginFor, packById, type Operation,
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
});
