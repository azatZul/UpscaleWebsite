import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getOrCreateAccount } from "../src/accounts";
import { resetKeyCache } from "../src/auth";
import { CREDIT_PACKS } from "../src/pricing";

const WEBHOOK_SECRET = "whsec_test_secret";
const PROJECT = "upscaler-e9010";
const KID = "billing-key";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let keyPair: CryptoKeyPair;
let realFetch: typeof fetch;
let stripeCalls: { url: string; body: string }[] = [];

/** Stand in for both Google's JWKS endpoint and the Stripe API, so an
 *  authenticated request can be driven end to end through the worker. */
function installFetchStub(stripeResponder?: (url: string) => Response) {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === JWKS_URL) {
      const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" },
      });
    }
    if (url.startsWith("https://api.stripe.com/")) {
      stripeCalls.push({ url, body: String(init?.body ?? "") });
      if (stripeResponder) return stripeResponder(url);
      const payload = url.includes("/customers")
        ? { id: "cus_test_1" }
        : { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" };
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

async function idToken(googleSub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: KID, typ: "JWT" };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: "firebase-uid",
    iat: now - 10,
    exp: now + 3600,
    email: "buyer@example.com",
    email_verified: true,
    firebase: { identities: { "google.com": [googleSub] }, sign_in_provider: "google.com" },
  };
  const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

async function signBody(body: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return `t=${timestamp},v1=${[...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://upscales.app${path}`, init));

async function postWebhook(event: unknown, options: { secret?: string; header?: string } = {}) {
  const body = JSON.stringify(event);
  return fetchWorker("/api/webhooks/stripe", {
    method: "POST",
    headers: { "Stripe-Signature": options.header ?? await signBody(body, options.secret) },
    body,
  });
}

/** A session shaped like Stripe's, priced correctly for whichever pack the
 *  overrides name -- so a test that wants a mismatch has to ask for one. */
function completedSession(overrides: Record<string, any> = {}) {
  const packId = overrides.metadata?.pack_id ?? CREDIT_PACKS[0]!.id;
  const pack = CREDIT_PACKS.find(candidate => candidate.id === packId);
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${crypto.randomUUID()}`,
        payment_status: "paid",
        amount_total: pack?.priceCents ?? CREDIT_PACKS[0]!.priceCents,
        currency: "usd",
        payment_intent: "pi_test_1",
        metadata: { pack_id: packId },
        ...overrides,
      },
    },
  };
}

const balanceOf = async (accountId: string) => (await env.ACCOUNTS_DB
  .prepare("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_entries WHERE account_id = ?")
  .bind(accountId).first<{ balance: number }>())?.balance ?? 0;

beforeEach(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  ) as CryptoKeyPair;
  stripeCalls = [];
  resetKeyCache();
});

afterEach(() => {
  if (realFetch) globalThis.fetch = realFetch;
});

describe.sequential("stripe webhook", () => {
  it("credits a paid session and records the purchase behind it", async () => {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, `sub-${crypto.randomUUID()}`, "buyer@example.com");
    const event = completedSession({ metadata: { pack_id: "starter", account_id: account.id } });
    const response = await postWebhook(event);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, applied: true, balance: 500 });

    const purchase = await env.ACCOUNTS_DB
      .prepare("SELECT account_id, pack_id, credits, amount_cents, currency, stripe_payment_intent FROM purchases WHERE stripe_session_id = ?")
      .bind(event.data.object.id).first();
    expect(purchase).toMatchObject({
      account_id: account.id, pack_id: "starter", credits: 500, amount_cents: 500,
      currency: "usd", stripe_payment_intent: "pi_test_1",
    });
  });

  it("falls back to client_reference_id when metadata carries no account", async () => {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, `sub-${crypto.randomUUID()}`, null);
    const event = completedSession({ client_reference_id: account.id, metadata: { pack_id: "pro" } });
    expect((await postWebhook(event)).status).toBe(200);
    expect(await balanceOf(account.id)).toBe(4800);
  });

  it("does not credit twice when Stripe retries the same event", async () => {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, `sub-${crypto.randomUUID()}`, null);
    const event = completedSession({ metadata: { pack_id: "plus", account_id: account.id } });
    const first = await postWebhook(event);
    const second = await postWebhook(event);
    expect(await first.json()).toMatchObject({ applied: true, balance: 1650 });
    // Retries are routine, not exceptional: the second call must succeed and
    // change nothing, or Stripe will keep resending.
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ applied: false, balance: 1650 });
    expect(await balanceOf(account.id)).toBe(1650);
  });

  it("refuses a session whose total disagrees with the pack it claims", async () => {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, `sub-${crypto.randomUUID()}`, null);
    // The pro pack's 4800 credits for the starter pack's $5.
    const event = completedSession({ amount_total: 500, metadata: { pack_id: "pro", account_id: account.id } });
    expect(event.data.object.amount_total).toBe(500);
    const response = await postWebhook(event);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ error: "amount_mismatch" });
    expect(await balanceOf(account.id)).toBe(0);
  });

  it("refuses a session for an unknown pack, and one that is not paid", async () => {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, `sub-${crypto.randomUUID()}`, null);
    const unknown = await postWebhook(completedSession({ metadata: { pack_id: "free_money", account_id: account.id } }));
    expect(await unknown.json()).toMatchObject({ error: "unattributable" });
    const unpaid = await postWebhook(completedSession({
      payment_status: "unpaid", metadata: { pack_id: "starter", account_id: account.id },
    }));
    expect(await unpaid.json()).toMatchObject({ ignored: "unpaid" });
    expect(await balanceOf(account.id)).toBe(0);
  });

  it("grants nothing when the signature is wrong, absent, or stale", async () => {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, `sub-${crypto.randomUUID()}`, null);
    const event = completedSession({ metadata: { pack_id: "starter", account_id: account.id } });
    const wrongSecret = await postWebhook(event, { secret: "whsec_attacker" });
    expect(wrongSecret.status).toBe(400);
    expect(await wrongSecret.json()).toEqual({ error: "invalid_signature" });

    const body = JSON.stringify(event);
    const noHeader = await fetchWorker("/api/webhooks/stripe", { method: "POST", body });
    expect(noHeader.status).toBe(400);

    const stale = await postWebhook(event, {
      header: await signBody(JSON.stringify(event), WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600),
    });
    expect(stale.status).toBe(400);
    expect(await balanceOf(account.id)).toBe(0);
  });

  it("accepts unrelated event types without retrying them", async () => {
    const response = await postWebhook({ type: "payment_intent.created", data: { object: {} } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, ignored: "payment_intent.created" });
  });

  it("rejects a GET on the webhook endpoint", async () => {
    const response = await fetchWorker("/api/webhooks/stripe");
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});

describe.sequential("billing endpoints", () => {
  it("requires a token for the pack list and for checkout", async () => {
    expect((await fetchWorker("/api/billing/packs")).status).toBe(401);
    expect((await fetchWorker("/api/billing/checkout", { method: "POST" })).status).toBe(401);
  });

  it("serves the same pack table the webhook credits from", async () => {
    installFetchStub();
    const response = await fetchWorker("/api/billing/packs", {
      headers: { Authorization: `Bearer ${await idToken("sub-packs")}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.packs).toHaveLength(3);
    expect(body.packs[0]).toMatchObject({ id: "starter", credits: 500, priceCents: 500 });
    expect(body.operations).toMatchObject({ upscale_standard: 5, restore: 20, upscale_ultimate: 25 });
  });

  it("creates a customer once, then a checkout session for the chosen pack", async () => {
    installFetchStub();
    const token = await idToken("sub-checkout");
    const response = await fetchWorker("/api/billing/checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ packId: "plus" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(stripeCalls.map(call => call.url)).toEqual([
      "https://api.stripe.com/v1/customers",
      "https://api.stripe.com/v1/checkout/sessions",
    ]);
    // The price comes from our table, not from the request body.
    expect(stripeCalls[1]!.body).toContain("unit_amount%5D=1500");

    // Second purchase reuses the stored customer rather than making another.
    stripeCalls = [];
    await fetchWorker("/api/billing/checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ packId: "starter" }),
    });
    expect(stripeCalls.map(call => call.url)).toEqual(["https://api.stripe.com/v1/checkout/sessions"]);
    expect(stripeCalls[0]!.body).toContain("customer=cus_test_1");
  });

  it("rejects a pack id the price table does not contain", async () => {
    installFetchStub();
    for (const body of [JSON.stringify({ packId: "bespoke" }), JSON.stringify({}), "not json"]) {
      const response = await fetchWorker("/api/billing/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${await idToken("sub-badpack")}`, "Content-Type": "application/json" },
        body,
      });
      expect(response.status, body).toBe(400);
    }
    // Nothing reached Stripe: an unknown pack is refused before any API call.
    expect(stripeCalls).toHaveLength(0);
  });

  it("reports a Stripe outage as 502 without leaking Stripe's message", async () => {
    installFetchStub(() => new Response(JSON.stringify({ error: { message: "No such customer: cus_x" } }), { status: 400 }));
    const response = await fetchWorker("/api/billing/checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${await idToken("sub-outage")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ packId: "starter" }),
    });
    expect(response.status).toBe(502);
    expect(await response.text()).toBe(JSON.stringify({ error: "checkout_failed" }));
  });
});
