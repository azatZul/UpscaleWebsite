import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { creditBalance, getOrCreateAccount, recordPurchase } from "../src/accounts";
import { checkoutEventStatement, checkoutSnapshotStatement, dispatchReddit, handleRedditRequest,
  snapshotForRequest, type RedditSnapshot } from "../src/reddit";

const live: Env = { ...env, REDDIT_ENABLED: "true", REDDIT_PIXEL_ID: "a2_test", REDDIT_CAPI_ACCESS_TOKEN: "test-private-token", STRIPE_MODE: "live" };
const sent: { url: string; payload: any; headers: Headers }[] = [];
let reply: () => Response | Promise<Response>;
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext;
const flush = async () => { while (pending.length) await Promise.all(pending.splice(0)); };

beforeEach(async () => {
  for (const db of [env.ACCOUNTS_DB, env.DB]) {
    await db.batch([db.prepare("DELETE FROM reddit_outbox"), db.prepare("DELETE FROM reddit_checkouts")]);
  }
  await env.ACCOUNTS_DB.prepare("DELETE FROM reddit_contexts").run();
  sent.length = 0;
  pending.length = 0;
  reply = () => Response.json({ data: {} });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), payload: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return reply();
  });
});
afterEach(async () => { await flush(); vi.unstubAllGlobals(); });

function request(path: string, body: unknown, cookie = "", origin = "https://upscales.app") {
  return new Request(`https://upscales.app${path}`, { method: "POST", headers: {
    Origin: origin, Cookie: cookie, "Content-Type": "application/json", "User-Agent": "customer-browser", "CF-Connecting-IP": "192.0.2.1",
  }, body: JSON.stringify(body) });
}
async function consent(): Promise<{ cookie: string; snapshot: RedditSnapshot }> {
  const response = await handleRedditRequest(request("/api/ads/consent",
    { v: 2, advertising: true, clickId: "reddit-test-click", path: "/free-upscale/" }), live, ctx);
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0]!;
  const snapshot = await snapshotForRequest(request("/api/billing/checkout", {}, cookie), live);
  expect(snapshot).not.toBeNull();
  return { cookie, snapshot: snapshot! };
}
async function queuedCheckout(snapshot: RedditSnapshot) {
  const id = crypto.randomUUID();
  await checkoutSnapshotStatement(env.ACCOUNTS_DB, id, snapshot).run();
  return id;
}
async function signed(event: unknown, valid = true) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_test_secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(signature)].map(x => x.toString(16).padStart(2, "0")).join("");
  return new Request("https://upscales.app/api/webhooks/stripe", { method: "POST", body,
    headers: { "Stripe-Signature": `t=${timestamp},v1=${valid ? hex : "bad"}` } });
}

describe.sequential("Reddit advertising and Stripe integration", () => {
  it("requires explicit v2 advertising consent and exact origin", async () => {
    expect((await handleRedditRequest(request("/api/ads/consent", {v: 1, analytics: true}), live, ctx)).status).toBe(400);
    expect((await handleRedditRequest(request("/api/ads/consent", {v: 2, advertising: true}, "", "https://attacker.example"), live, ctx)).status).toBe(403);
    const response = await handleRedditRequest(request("/api/ads/consent", {v: 2, advertising: true}), {...live, STRIPE_MODE: "test"}, ctx);
    expect(await response.json()).toEqual({accepted: false});
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("rejects browser purchases and events without consent", async () => {
    const {cookie} = await consent();
    expect((await handleRedditRequest(request("/api/ads/event", {event: "Purchase", id: crypto.randomUUID()}, cookie), live, ctx)).status).toBe(400);
    const result = await handleRedditRequest(request("/api/ads/event", {event: "UpscaleCompleted", id: crypto.randomUUID()}), live, ctx);
    expect(await result.json()).toEqual({accepted: false});
    expect(sent).toHaveLength(0);
  });

  it("relays a real event once, using the browser's match keys and a safe URL", async () => {
    const {cookie} = await consent();
    const id = crypto.randomUUID();
    for (let i = 0; i < 2; i++) {
      await handleRedditRequest(request("/api/ads/event", {event: "UpscaleCompleted", id, path: "/account/?oobCode=secret", value: 999}, cookie), live, ctx);
      await flush();
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://ads-api.reddit.com/api/v3/pixels/a2_test/conversion_events");
    expect(sent[0]!.headers.get("Authorization")).toBe("Bearer test-private-token");
    const event = sent[0]!.payload.data.events[0];
    expect(event).toMatchObject({action_source: "WEBSITE", click_id: "reddit-test-click", event_source_url: "https://upscales.app/",
      user: {ip_address: "192.0.2.1", user_agent: "customer-browser"}, type: {tracking_type: "CUSTOM", custom_event_name: "UpscaleCompleted"},
      metadata: {conversion_id: id}});
    expect(event.metadata.value).toBeUndefined();
    expect(await env.ACCOUNTS_DB.prepare("SELECT payload, status FROM reddit_outbox WHERE conversion_id = ?").bind(id).first())
      .toEqual({payload: "{}", status: "delivered"});
  });

  it("caps relay event volume per consent context", async () => {
    const {cookie, snapshot} = await consent();
    await env.ACCOUNTS_DB.prepare("UPDATE reddit_contexts SET rate_count = 100 WHERE id = ?").bind(snapshot.contextId).run();
    const result = await handleRedditRequest(request("/api/ads/event", {event: "PageVisit", id: crypto.randomUUID()}, cookie), live, ctx);
    expect(result.status).toBe(429);
    expect(sent).toHaveLength(0);
  });

  it("withdrawal discards both databases' queued events and deletes matching snapshots", async () => {
    const {cookie, snapshot} = await consent();
    for (const db of [env.ACCOUNTS_DB, env.DB]) {
      const id = crypto.randomUUID();
      await checkoutSnapshotStatement(db, id, snapshot).run();
      await checkoutEventStatement(db, id, `checkout:${id}`, "CheckoutStarted", {}, Date.now()).run();
    }
    await handleRedditRequest(request("/api/ads/consent", {v: 2, advertising: false}, cookie), live, ctx);
    await dispatchReddit(live);
    expect(sent).toHaveLength(0);
    for (const db of [env.ACCOUNTS_DB, env.DB]) {
      expect((await db.prepare("SELECT status, payload FROM reddit_outbox").all()).results).toEqual([{status: "discarded", payload: "{}"}]);
      expect((await db.prepare("SELECT * FROM reddit_checkouts").all()).results).toHaveLength(0);
    }
    expect(await env.ACCOUNTS_DB.prepare("SELECT allowed, click_id FROM reddit_contexts WHERE id = ?").bind(snapshot.contextId).first())
      .toEqual({allowed: 0, click_id: null});
  });

  it("records a verified paid Stripe session and purchase conversion together, replayed once", async () => {
    const {snapshot} = await consent();
    const checkoutId = await queuedCheckout(snapshot);
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, crypto.randomUUID(), null);
    const sessionId = `cs_live_${crypto.randomUUID().replaceAll("-", "")}`;
    const event = {type: "checkout.session.completed", livemode: true, created: Math.floor(Date.now() / 1000), data: {object: {
      id: sessionId, livemode: true, payment_status: "paid", amount_total: 500, currency: "usd", payment_intent: "pi_live_test",
      metadata: {account_id: account.id, reddit_checkout_id: checkoutId},
    }}};
    for (let i = 0; i < 2; i++) {
      expect((await worker.fetch(await signed(event), live, ctx)).status).toBe(200);
      await flush();
    }
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.data.events[0]).toMatchObject({type: {tracking_type: "PURCHASE"},
      metadata: {conversion_id: `purchase:${sessionId}`, value: 5, currency: "USD", item_count: 1}});
  });

  it("never reports test, unpaid, bad-signature or mismatched-currency sessions as live purchases", async () => {
    const {snapshot} = await consent();
    const checkoutId = await queuedCheckout(snapshot);
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, crypto.randomUUID(), null);
    for (const overrides of [{livemode: false}, {payment_status: "unpaid"}, {currency: "eur"}, {amount_total: 550}]) {
      const event = {type: "checkout.session.completed", livemode: true, data: {object: {
        id: `cs_${crypto.randomUUID()}`, livemode: true, payment_status: "paid", amount_total: 500, currency: "usd",
        metadata: {account_id: account.id, reddit_checkout_id: checkoutId}, ...overrides,
      }}};
      await worker.fetch(await signed(event), live, ctx);
    }
    expect((await worker.fetch(await signed({}, false), live, ctx)).status).toBe(400);
    await flush();
    expect(sent).toHaveLength(0);
  });

  it("records delayed successful payment only when it becomes paid", async () => {
    const {snapshot} = await consent();
    const checkoutId = await queuedCheckout(snapshot);
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, crypto.randomUUID(), null);
    const event = {type: "checkout.session.completed", livemode: true, data: {object: {
      id: `cs_${crypto.randomUUID()}`, livemode: true, payment_status: "unpaid", amount_total: 500, currency: "usd",
      metadata: {account_id: account.id, reddit_checkout_id: checkoutId},
    }}};
    await worker.fetch(await signed(event), live, ctx);
    await flush();
    expect(sent).toHaveLength(0);
    event.type = "checkout.session.async_payment_succeeded";
    event.data.object.payment_status = "paid";
    await worker.fetch(await signed(event), live, ctx);
    await flush();
    expect(sent).toHaveLength(1);
  });

  it("a failed financial transaction cannot leave a purchase conversion behind", async () => {
    const {snapshot} = await consent();
    const checkoutId = await queuedCheckout(snapshot);
    await expect(recordPurchase(env.ACCOUNTS_DB, {accountId: "missing-account", packId: "starter", credits: 200, amountCents: 500,
      currency: "usd", stripeSessionId: "cs_missing", stripePaymentIntent: null, redditCheckoutId: checkoutId})).rejects.toThrow();
    expect((await env.ACCOUNTS_DB.prepare("SELECT * FROM reddit_outbox").all()).results).toHaveLength(0);
  });

  it("retries failed delivery with the original event ID, timestamp and decimal value", async () => {
    const {snapshot} = await consent();
    const id = await queuedCheckout(snapshot);
    const at = Date.now();
    await checkoutEventStatement(env.ACCOUNTS_DB, id, "purchase:retry", "PURCHASE", {value: 9.99, currency: "USD"}, at).run();
    reply = () => new Response("unavailable", {status: 503});
    await dispatchReddit(live, at);
    expect(await env.ACCOUNTS_DB.prepare("SELECT status, attempts FROM reddit_outbox WHERE conversion_id = 'purchase:retry'").first())
      .toEqual({status: "pending", attempts: 1});
    reply = () => Response.json({data: {}});
    await dispatchReddit(live, at + 60_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload).toEqual(sent[0]!.payload);
    expect(sent[1]!.payload.data.events[0]).toMatchObject({event_at: at, metadata: {value: 9.99}});
  });

  it("concurrent dispatch claims the event once and an API error inside HTTP 200 stays pending", async () => {
    const {snapshot} = await consent();
    const id = await queuedCheckout(snapshot);
    await checkoutEventStatement(env.ACCOUNTS_DB, id, "checkout:race", "CheckoutStarted", {}, Date.now()).run();
    reply = () => Response.json({error: {message: "rejected"}});
    await Promise.all([dispatchReddit(live), dispatchReddit(live)]);
    expect(sent).toHaveLength(1);
    expect(await env.ACCOUNTS_DB.prepare("SELECT status FROM reddit_outbox WHERE conversion_id = 'checkout:race'").first()).toEqual({status: "pending"});
  });

  it("signup is emitted only for the winning new account insertion", async () => {
    const {snapshot} = await consent();
    const uid = crypto.randomUUID();
    await Promise.all([getOrCreateAccount(env.ACCOUNTS_DB, uid, null, snapshot), getOrCreateAccount(env.ACCOUNTS_DB, uid, null, snapshot)]);
    await getOrCreateAccount(env.ACCOUNTS_DB, uid, null, snapshot);
    await dispatchReddit(live);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.data.events[0].type).toEqual({tracking_type: "SIGN_UP"});
  });
});
