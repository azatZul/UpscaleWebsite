import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { creditBalance } from "../src/accounts";
import { isTestMode, testModeAllows } from "../src/test-mode";
import { cloudForm, fetchWorker, fundedAccount, installStubs, type Stubs } from "./helpers";

let stubs: Stubs;
beforeEach(async () => { stubs = await installStubs(); });
afterEach(() => stubs.restore());

const verified = (email: string) => ({ email, emailVerified: true });

describe("test-mode lock", () => {
  it("is on only for Stripe test keys", () => {
    expect(isTestMode({ STRIPE_SECRET_KEY: "sk_test_abc" })).toBe(true);
    expect(isTestMode({ STRIPE_SECRET_KEY: "rk_test_abc" })).toBe(true);
    expect(isTestMode({ STRIPE_SECRET_KEY: "rk_live_abc" })).toBe(false);
    expect(isTestMode({ STRIPE_SECRET_KEY: "sk_live_abc" })).toBe(false);
  });

  it("leaves live keys open to everyone", () => {
    expect(testModeAllows({ STRIPE_SECRET_KEY: "rk_live_abc" }, verified("anyone@example.com"))).toBe(true);
  });

  it("lets in only verified emails on the list, whatever their case or spacing", () => {
    const testEnv = { STRIPE_SECRET_KEY: "sk_test_abc", TEST_ALLOWED_EMAILS: " Dev@Example.com,\nsecond@example.com " };
    expect(testModeAllows(testEnv, verified("dev@example.com"))).toBe(true);
    expect(testModeAllows(testEnv, verified("second@example.com"))).toBe(true);
    expect(testModeAllows(testEnv, verified("stranger@example.com"))).toBe(false);
    expect(testModeAllows(testEnv, { email: "dev@example.com", emailVerified: false })).toBe(false);
    expect(testModeAllows(testEnv, { email: null, emailVerified: true })).toBe(false);
  });

  it("lets nobody in when test mode has no list", () => {
    expect(testModeAllows({ STRIPE_SECRET_KEY: "sk_test_abc" }, verified("dev@example.com"))).toBe(false);
  });
});

describe.sequential("test-mode lock on the endpoints", () => {
  it("refuses a stranger checkout and cloud jobs, charging nothing and calling no provider", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 100);
    const token = await stubs.idToken(sub, "google.com", "stranger@example.com");

    const checkout = await fetchWorker("/api/billing/checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amountCents: 500 }),
    });
    expect(checkout.status).toBe(403);
    expect(await checkout.json()).toEqual({ error: "test_mode_restricted" });

    const job = await fetchWorker("/api/cloud/restore", {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: cloudForm("req-locked-0001"),
    });
    expect(job.status).toBe(403);
    expect(await job.json()).toEqual({ error: "test_mode_restricted" });
    expect(stubs.auralensCalls).toHaveLength(0);
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(100);
  });
});
