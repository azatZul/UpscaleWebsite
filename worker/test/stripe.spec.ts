import { describe, expect, it, vi } from "vitest";

import { StripeError, createCheckoutSession, createCustomer, verifyWebhook } from "../src/stripe";

const SECRET = "whsec_test_secret";

async function sign(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

const okFetch = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), {
  status: 200, headers: { "Content-Type": "application/json" },
}));

describe("stripe webhook verification", () => {
  it("accepts a correctly signed body and returns the parsed event", async () => {
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
    const event = await verifyWebhook(body, await sign(body), SECRET);
    expect(event.data.object.id).toBe("cs_1");
  });

  it("rejects a body that was altered after signing", async () => {
    const body = JSON.stringify({ amount_total: 500 });
    const header = await sign(body);
    await expect(verifyWebhook(body.replace("500", "999"), header, SECRET))
      .rejects.toThrow(StripeError);
  });

  it("rejects a signature made with a different secret", async () => {
    const body = "{}";
    await expect(verifyWebhook(body, await sign(body, "whsec_wrong"), SECRET)).rejects.toThrow(/did not verify/);
  });

  it("rejects a replayed request outside the timestamp tolerance", async () => {
    const body = "{}";
    const stale = Math.floor(Date.now() / 1000) - 3600;
    // The signature itself is still valid -- only the timestamp check stops it,
    // which is the whole point of having one.
    await expect(verifyWebhook(body, await sign(body, SECRET, stale), SECRET))
      .rejects.toThrow(/tolerance/);
  });

  it("accepts one valid signature among several, as during secret rotation", async () => {
    const body = JSON.stringify({ type: "ping" });
    const timestamp = Math.floor(Date.now() / 1000);
    const good = await sign(body, SECRET, timestamp);
    const other = await sign(body, "whsec_old", timestamp);
    const combined = `${good},${other.split(",")[1]}`;
    expect((await verifyWebhook(body, combined, SECRET)).type).toBe("ping");
  });

  it("rejects a missing or malformed signature header", async () => {
    await expect(verifyWebhook("{}", null, SECRET)).rejects.toThrow(/Missing signature/);
    await expect(verifyWebhook("{}", "nonsense", SECRET)).rejects.toThrow(/Malformed/);
  });

  it("rejects a signed body that is not JSON", async () => {
    const body = "not json";
    await expect(verifyWebhook(body, await sign(body), SECRET)).rejects.toThrow(/not JSON/);
  });
});

describe("stripe api client", () => {
  it("form-encodes nested checkout params in bracket notation", async () => {
    const fetcher = okFetch({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    const session = await createCheckoutSession({ secretKey: "sk_test", fetcher: fetcher as any }, {
      accountId: "acc_1", customerId: "cus_1", packId: "starter", credits: 500, priceCents: 500,
      productName: "UScale 500 credits",
      successUrl: "https://x/ok", cancelUrl: "https://x/no",
    });
    expect(session.url).toContain("checkout.stripe.com");
    const body = (fetcher.mock.calls[0]![1] as RequestInit).body as string;
    expect(body).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=500");
    expect(body).toContain("line_items%5B0%5D%5Bquantity%5D=1");
    expect(body).toContain("metadata%5Bpack_id%5D=starter");
    expect(body).toContain("client_reference_id=acc_1");
    const headers = (fetcher.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test");
    expect(headers["Stripe-Version"]).toBeTruthy();
  });

  it("keys customer creation on the account so retries do not duplicate", async () => {
    const fetcher = okFetch({ id: "cus_1" });
    await createCustomer({ secretKey: "sk_test", fetcher: fetcher as any }, { accountId: "acc_7", email: null });
    const headers = (fetcher.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("customer:acc_7");
    // A null email is omitted rather than sent as the string "null".
    expect((fetcher.mock.calls[0]![1] as RequestInit).body).not.toContain("email");
  });

  it("surfaces a Stripe error response as StripeError", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "No such customer" } }), { status: 400 }));
    await expect(createCustomer({ secretKey: "sk_test", fetcher: fetcher as any }, { accountId: "a", email: null }))
      .rejects.toThrow(/No such customer/);
  });

  it("surfaces a network failure as StripeError, not a raw fetch error", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("network down"); });
    await expect(createCustomer({ secretKey: "sk_test", fetcher: fetcher as any }, { accountId: "a", email: null }))
      .rejects.toThrow(/Could not reach Stripe/);
  });
});
