import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { creditBalance, getOrCreateAccount, grantCredits, spendCredits } from "../src/accounts";

async function freshAccount(sub = `sub-${crypto.randomUUID()}`) {
  return getOrCreateAccount(env.ACCOUNTS_DB, sub, "person@example.com");
}

describe("accounts", () => {
  it("keys the account on the Google subject, not on any provider uid", async () => {
    const first = await getOrCreateAccount(env.ACCOUNTS_DB, "sub-stable", "a@example.com");
    const again = await getOrCreateAccount(env.ACCOUNTS_DB, "sub-stable", "a@example.com");
    expect(again.id).toBe(first.id);
    expect(first.googleSub).toBe("sub-stable");
    // Our id is ours -- it must not be the provider's identifier.
    expect(first.id).not.toBe("sub-stable");
  });

  it("picks up an address change without creating a second account", async () => {
    const first = await getOrCreateAccount(env.ACCOUNTS_DB, "sub-rename", "old@example.com");
    const renamed = await getOrCreateAccount(env.ACCOUNTS_DB, "sub-rename", "new@example.com");
    expect(renamed.id).toBe(first.id);
    expect(renamed.email).toBe("new@example.com");
  });
});

describe("credit ledger", () => {
  it("starts empty and sums grants", async () => {
    const account = await freshAccount();
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(0);
    await grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 50, reason: "purchase", idempotencyKey: "evt_1" });
    await grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 25, reason: "grant", idempotencyKey: "evt_2" });
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(75);
  });

  it("replaying a Stripe event does not double credit", async () => {
    const account = await freshAccount();
    const first = await grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 100, reason: "purchase", idempotencyKey: "evt_replay" });
    const replay = await grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 100, reason: "purchase", idempotencyKey: "evt_replay" });
    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);
    expect(replay.balance).toBe(100);
  });

  it("spends down and refuses to go negative", async () => {
    const account = await freshAccount();
    await grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 10, reason: "purchase", idempotencyKey: `g-${account.id}` });
    const ok = await spendCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 6, idempotencyKey: `s1-${account.id}` });
    expect(ok).toMatchObject({ applied: true, reason: "ok", balance: 4 });
    const tooMuch = await spendCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 5, idempotencyKey: `s2-${account.id}` });
    expect(tooMuch).toMatchObject({ applied: false, reason: "insufficient", balance: 4 });
  });

  it("concurrent spends cannot both succeed against one balance", async () => {
    const account = await freshAccount();
    await grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 10, reason: "purchase", idempotencyKey: `g2-${account.id}` });
    // A read-then-write balance check would let both of these through.
    const [a, b] = await Promise.all([
      spendCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 10, idempotencyKey: `c1-${account.id}` }),
      spendCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 10, idempotencyKey: `c2-${account.id}` }),
    ]);
    expect([a.applied, b.applied].filter(Boolean)).toHaveLength(1);
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(0);
  });

  it("a retried job spends once, not twice", async () => {
    const account = await freshAccount();
    await grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 10, reason: "purchase", idempotencyKey: `g3-${account.id}` });
    const key = `job-${account.id}`;
    await spendCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 4, idempotencyKey: key });
    const retry = await spendCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 4, idempotencyKey: key });
    expect(retry).toMatchObject({ applied: false, reason: "duplicate", balance: 6 });
  });

  it("rejects nonsense amounts rather than writing a zero or negative entry", async () => {
    const account = await freshAccount();
    await expect(grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 0, reason: "grant", idempotencyKey: "z" })).rejects.toThrow();
    await expect(grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: -5, reason: "grant", idempotencyKey: "n" })).rejects.toThrow();
    await expect(spendCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: 0, idempotencyKey: "z2" })).rejects.toThrow();
  });
});
