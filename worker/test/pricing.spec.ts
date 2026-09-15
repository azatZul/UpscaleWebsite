import { describe, expect, it } from "vitest";

import {
  CREDIT_PACKS, CREDIT_PRICES, FREE_DEVICE_UPSCALES, MAX_PROMPT_LENGTH, MAX_PURCHASE_CENTS, MIN_PURCHASE_CENTS,
  allPricedRequests, centsPerCredit, creditsFor, marginFor, marginForPurchase, packById, parseCloudRequest,
  priceKey, quoteCredits, type CloudRequest,
} from "../src/pricing";

// The business floor. If a price change drops any option below this on any
// purchase, that is a bug, not a pricing tweak.
const MINIMUM_MARGIN = 0.5;
const REQUESTS = allPricedRequests();

describe("pricing", () => {
  it("charges the approved credit prices", () => {
    const table = Object.fromEntries(REQUESTS.map(request => [priceKey(request), creditsFor(request)]));
    expect(table).toEqual({
      "creative:2k": 5, "creative:4k": 5, "creative:8k": 15,
      "restore:restore": 15, "restore:restore+hires": 25,
      "restore:colorization": 15, "restore:colorization+hires": 25,
      "restore:colorization_pro": 35, "restore:colorization_pro+hires": 45,
      "restore:advanced_restoration": 20,
    });
    expect(CREDIT_PRICES.increaseResolution).toBe(10);
    expect(CREDIT_PRICES.device).toBe(1);
    expect(FREE_DEVICE_UPSCALES).toBe(10);
  });

  it("clears 50% gross margin on every priced option, on every pack", () => {
    for (const pack of CREDIT_PACKS) {
      for (const request of REQUESTS) {
        const margin = marginFor(request, pack);
        expect(margin, `${priceKey(request)} on ${pack.id} = ${(margin * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(MINIMUM_MARGIN);
      }
    }
  });

  it("clears 50% margin on every option for every purchasable whole-dollar amount", () => {
    // Exhaustive rather than sampled: 496 amounts times ten variants is cheap,
    // and it is the only way to be sure no tier edge dips under.
    for (let cents = MIN_PURCHASE_CENTS; cents <= MAX_PURCHASE_CENTS; cents += 100) {
      const quote = quoteCredits(cents)!;
      for (const request of REQUESTS) {
        const margin = marginForPurchase(request, cents, quote.credits);
        expect(margin, `${priceKey(request)} at $${cents / 100}`).toBeGreaterThanOrEqual(MINIMUM_MARGIN);
      }
    }
  });

  it("bigger packs are better value, never worse", () => {
    const sorted = [...CREDIT_PACKS].sort((a, b) => a.priceCents - b.priceCents);
    for (let i = 1; i < sorted.length; i++) {
      expect(centsPerCredit(sorted[i]!)).toBeLessThan(centsPerCredit(sorted[i - 1]!));
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

  it("never gives fewer credits for paying more", () => {
    let previous = 0;
    for (let cents = MIN_PURCHASE_CENTS; cents <= MAX_PURCHASE_CENTS; cents += 100) {
      const credits = quoteCredits(cents)!.credits;
      expect(credits, `$${cents / 100}`).toBeGreaterThan(previous);
      previous = credits;
    }
  });
});

describe("parseCloudRequest", () => {
  it("defaults creative upscale to balanced creativity at 4K, like the app", () => {
    expect(parseCloudRequest("creative", {})).toEqual({ kind: "creative", creativity: 0, resolution: "4k" });
    expect(parseCloudRequest("creative", { creativity: "-2", resolution: "8k" })).toEqual({ kind: "creative", creativity: -2, resolution: "8k" });
  });

  it("refuses creativity and resolutions the app does not offer", () => {
    for (const creativity of ["3", "-3", "1.5", "abc", ""]) {
      expect(parseCloudRequest("creative", { creativity }), creativity).toEqual({ error: "invalid_creativity" });
    }
    expect(parseCloudRequest("creative", { resolution: "16k" })).toEqual({ error: "invalid_resolution" });
  });

  it("reads restore modes, increased resolution and the prompt", () => {
    expect(parseCloudRequest("restore", { mode: "colorization_pro", increaseResolution: "true", prompt: "  blue eyes  " }))
      .toEqual({ kind: "restore", mode: "colorization_pro", increaseResolution: true, prompt: "blue eyes" });
    expect(parseCloudRequest("restore", {})).toEqual({ kind: "restore", mode: "restore", increaseResolution: false, prompt: "" });
  });

  it("refuses what Advanced Fix does not support, and ignores its prompt", () => {
    expect(parseCloudRequest("restore", { mode: "advanced_restoration", increaseResolution: "true" }))
      .toEqual({ error: "increase_resolution_unavailable" });
    const request = parseCloudRequest("restore", { mode: "advanced_restoration", prompt: "keep the hat" }) as CloudRequest;
    expect(request).toMatchObject({ mode: "advanced_restoration", prompt: "" });
  });

  it("refuses unknown modes, flags, long prompts and unknown kinds", () => {
    expect(parseCloudRequest("restore", { mode: "bogus" })).toEqual({ error: "invalid_mode" });
    expect(parseCloudRequest("restore", { increaseResolution: "yes" })).toEqual({ error: "invalid_increase_resolution" });
    expect(parseCloudRequest("restore", { prompt: "x".repeat(MAX_PROMPT_LENGTH + 1) })).toEqual({ error: "prompt_too_long" });
    expect(parseCloudRequest("upscale_standard", {})).toEqual({ error: "unknown_operation" });
  });

  it("replaces control characters in the prompt but keeps line breaks", () => {
    const bell = String.fromCharCode(7);
    const request = parseCloudRequest("restore", { prompt: `red dress${bell}\nblue eyes` }) as CloudRequest;
    expect(request).toMatchObject({ prompt: "red dress \nblue eyes" });
  });
});
