// A hand-rolled Stripe client, deliberately.
//
// The official SDK expects Node built-ins and bundles far more surface than two
// endpoints need. Stripe's REST API is form-encoded HTTP, and webhook signing
// is an HMAC we can do with WebCrypto, so the whole integration is this file.
//
// Nothing here trusts the amounts Stripe echoes back: the webhook resolves the
// pack from our own table and refuses a session whose total disagrees with it.

const API_BASE = "https://api.stripe.com/v1";
// Stripe's own recommended replay window for webhook timestamps.
const SIGNATURE_TOLERANCE = 300;

export class StripeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeError";
  }
}

type Fetcher = typeof fetch;

export interface StripeConfig {
  secretKey: string;
  fetcher?: Fetcher;
}

/** Flatten nested params into Stripe's bracket notation: metadata[pack_id]=x. */
function formEncode(params: Record<string, unknown>, prefix = ""): string[] {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") pairs.push(...formEncode(value as Record<string, unknown>, name));
    else pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return pairs;
}

async function callStripe(
  config: StripeConfig,
  path: string,
  params: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    // Pin the version: an account-level default upgrade must not silently
    // reshape the payloads this code parses.
    "Stripe-Version": "2025-08-27.basil",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response: Response;
  try {
    response = await (config.fetcher ?? fetch)(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: formEncode(params).join("&"),
    });
  } catch {
    throw new StripeError("Could not reach Stripe");
  }
  const body = await response.json().catch(() => null) as any;
  if (!response.ok) {
    // Stripe's message is safe to log but not to return: it can quote request
    // parameters back, and those include our own identifiers.
    throw new StripeError(body?.error?.message ?? `Stripe returned ${response.status}`);
  }
  return body;
}

export async function createCustomer(
  config: StripeConfig,
  input: { accountId: string; email: string | null },
): Promise<{ id: string }> {
  const created = await callStripe(config, "/customers", {
    email: input.email ?? undefined,
    metadata: { account_id: input.accountId },
    // Keyed on our account id, so a retry after a network failure reuses the
    // customer Stripe already made instead of creating a second one.
  }, `customer:${input.accountId}`);
  if (typeof created?.id !== "string") throw new StripeError("Stripe returned no customer id");
  return { id: created.id };
}

export interface CheckoutInput {
  accountId: string;
  customerId: string;
  packId: string;
  credits: number;
  priceCents: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(
  config: StripeConfig,
  input: CheckoutInput,
): Promise<{ id: string; url: string }> {
  const session = await callStripe(config, "/checkout/sessions", {
    mode: "payment",
    customer: input.customerId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.accountId,
    // The webhook reads pack_id from here and looks the pack up locally; these
    // are labels for reconciliation, never the source of the credit amount.
    metadata: { account_id: input.accountId, pack_id: input.packId, credits: input.credits },
    "line_items[0]": {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: input.priceCents,
        product_data: { name: input.productName },
      },
    },
  });
  if (typeof session?.id !== "string" || typeof session?.url !== "string") {
    throw new StripeError("Stripe returned no checkout URL");
  }
  return { id: session.id, url: session.url };
}

/** Compare two hex digests without leaking where they differ via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");

/** Verify a Stripe webhook signature and return the parsed event.
 *
 *  This is the webhook's only authentication -- the endpoint carries no bearer
 *  token, because Stripe has none to send. The raw body text must be the exact
 *  bytes Stripe sent; re-serializing parsed JSON changes the digest. */
export async function verifyWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<any> {
  if (!signatureHeader) throw new StripeError("Missing signature header");

  let timestamp: string | null = null;
  const provided: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value) timestamp = value;
    // A header can carry several v1 signatures during a secret rotation.
    else if (key === "v1" && value) provided.push(value);
  }
  if (!timestamp || provided.length === 0) throw new StripeError("Malformed signature header");

  const age = nowSeconds - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > SIGNATURE_TOLERANCE) {
    // Without this an attacker who captures one valid request can replay it
    // forever; the signature itself stays valid indefinitely.
    throw new StripeError("Signature timestamp outside tolerance");
  }

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = toHex(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`),
  ));
  if (!provided.some(candidate => timingSafeEqual(candidate, expected))) {
    throw new StripeError("Signature did not verify");
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new StripeError("Webhook body was not JSON");
  }
}
