import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleAlbumWebhook, processRefundJobs, startAlbumCheckout } from "../src/album-checkout";
import { albumCheckoutBody } from "../src/stripe";

const WEBHOOK_SECRET = "whsec_test_secret";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newId = () => Array.from({ length: 26 }, () => ALPHABET[Math.floor(Math.random() * 32)]).join("");
const nowSeconds = () => Math.floor(Date.now() / 1000);

type Fault = () => Response | "network" | Promise<Response | "network">;

/** A small in-memory Stripe: sessions with real status transitions, idempotent
 *  creates that compare the body like Stripe does, refunds, and one-shot faults
 *  keyed by "METHOD /path-prefix". */
class FakeStripe {
  sessions = new Map<string, any>();
  refunds = new Map<string, any>();
  keys = new Map<string, { body: string; response: any }>();
  calls: { method: string; path: string; body: string; key: string | null }[] = [];
  faults: { route: string; fault: Fault }[] = [];
  refundStatus = "succeeded";
  createDelayMs = 0;
  private counter = 0;

  once(route: string, fault: Fault) { this.faults.push({ route, fault }); }

  creates() { return this.calls.filter(call => call.method === "POST" && call.path === "/v1/checkout/sessions"); }

  pay(sessionId: string, overrides: Record<string, unknown> = {}) {
    const session = this.sessions.get(sessionId)!;
    Object.assign(session, { status: "complete", payment_status: "paid", payment_intent: `pi_${sessionId}` }, overrides);
    return session;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.text() : "";
    const key = request.headers.get("Idempotency-Key");
    this.calls.push({ method: request.method, path: url.pathname, body, key });
    const route = `${request.method} ${url.pathname}`;
    const index = this.faults.findIndex(fault => route.startsWith(fault.route));
    if (index >= 0) {
      const { fault } = this.faults.splice(index, 1)[0]!;
      const result = await fault();
      if (result === "network") throw new TypeError("network down");
      return result;
    }
    if (key && this.keys.has(key)) {
      const stored = this.keys.get(key)!;
      if (stored.body !== body) return error(400, "Keys for idempotent requests can only be used with the same parameters");
      return Response.json(stored.response);
    }
    const response = await this.route(request.method, url.pathname, body);
    if (key && response.ok) this.keys.set(key, { body, response: await response.clone().json() });
    return response;
  }

  private async route(method: string, path: string, body: string): Promise<Response> {
    if (method === "POST" && path === "/v1/checkout/sessions") {
      if (this.createDelayMs) await new Promise(resolve => setTimeout(resolve, this.createDelayMs));
      const form = new URLSearchParams(body);
      const id = `cs_test_${++this.counter}${crypto.randomUUID().replaceAll("-", "")}`;
      const session = {
        id, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${id}`,
        status: "open", payment_status: "unpaid", payment_intent: null, livemode: false,
        amount_total: Number(form.get("line_items[0][price_data][unit_amount]")), currency: "usd",
        expires_at: nowSeconds() + 86400,
        metadata: {
          kind: form.get("metadata[kind]"), album_id: form.get("metadata[album_id]"), checkout_id: form.get("metadata[checkout_id]"),
        },
      };
      this.sessions.set(id, session);
      return Response.json(session);
    }
    const sessionMatch = /^\/v1\/checkout\/sessions\/(\w+)(\/expire)?$/.exec(path);
    if (sessionMatch) {
      const session = this.sessions.get(sessionMatch[1]!);
      if (!session) return error(404, "No such checkout.session");
      if (sessionMatch[2]) {
        if (session.status !== "open") return error(400, "Only Checkout Sessions with a status of open can be expired");
        session.status = "expired";
      }
      return Response.json(session);
    }
    if (method === "POST" && path === "/v1/refunds") {
      const id = `re_${++this.counter}`;
      const refund = { id, status: this.refundStatus, payment_intent: new URLSearchParams(body).get("payment_intent") };
      this.refunds.set(id, refund);
      return Response.json(refund);
    }
    const refundMatch = /^\/v1\/refunds\/(\w+)$/.exec(path);
    if (refundMatch) {
      const refund = this.refunds.get(refundMatch[1]!);
      return refund ? Response.json(refund) : error(404, "No such refund");
    }
    throw new Error(`Unexpected Stripe call: ${method} ${path}`);
  }
}

const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

let stripe: FakeStripe;
let realFetch: typeof fetch;

beforeEach(() => {
  stripe = new FakeStripe();
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url.startsWith("https://api.stripe.com/")) return stripe.handle(request);
    throw new Error(`Unexpected fetch in test: ${request.url}`);
  }) as typeof fetch;
});

afterEach(() => { globalThis.fetch = realFetch; });

// Manual: the worker answers with 303s, and following them would hide where it sent us.
const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://upscales.app${path}`, { redirect: "manual", ...init }));

const unlock = (albumId: string) => fetchWorker(`/gallery/${albumId}/unlock`, { method: "POST" });

interface AlbumOptions {
  state?: "locked" | "unlocked" | "deleted";
  priceCents?: number;
  ready?: boolean;
}

/** A locked album with one photo, watermarked previews, and their clean twins. */
async function insertAlbum(options: AlbumOptions = {}): Promise<string> {
  const id = newId();
  const photo = newId();
  const keys = {
    cover: `albums/${id}/cover.jpg`, coverClean: `albums/${id}/cover-clean.jpg`,
    gallery: `albums/${id}/gallery-v2.jpg`, galleryClean: `albums/${id}/gallery-v2-clean.jpg`,
    before: `albums/${id}/${photo}/before.webp`, after: `albums/${id}/${photo}/after-wm-v2.webp`,
    afterClean: `albums/${id}/${photo}/after-v2.webp`, clean: `albums/${id}/${photo}/clean.jpg`,
  };
  await Promise.all(Object.entries(keys).map(([name, key]) =>
    env.MEDIA.put(key, new TextEncoder().encode(name), { httpMetadata: { contentType: "image/webp" } })));
  const ready = options.ready ?? true;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO albums (
        id, title, note, state, featured, price_cents, currency, photo_count,
        cover_photo_id, cover_key, cover_mime, cover_width, cover_height, cover_bytes,
        gallery_key, gallery_mime, gallery_width, gallery_height, gallery_bytes,
        unlocked_cover_key, unlocked_cover_bytes, unlocked_gallery_key, unlocked_gallery_bytes, created_at
      ) VALUES (?1, 'Family portraits', NULL, ?2, 1, ?3, 'USD', 1, ?4, ?5, 'image/jpeg', 1200, 630, 5,
                ?6, 'image/jpeg', 960, 720, 7, ?7, 10, ?8, 12, ?9)`,
    ).bind(id, options.state ?? "locked", options.priceCents ?? 300, photo, keys.cover, keys.gallery,
      keys.coverClean, keys.galleryClean, nowSeconds()),
    env.DB.prepare(
      `INSERT INTO photos (
        album_id, id, position, before_key, before_width, before_height, before_bytes, before_sha256,
        after_key, after_width, after_height, after_bytes, after_sha256,
        clean_key, clean_width, clean_height, clean_bytes, clean_mime, clean_sha256, alt,
        unlocked_after_key, unlocked_after_bytes, unlocked_after_sha256
      ) VALUES (?1, ?2, 0, ?3, 800, 600, 6, 'b', ?4, 800, 600, 5, 'a', ?5, 1600, 1200, 5, 'image/jpeg', 'c', 'Grandparents',
                ?6, 10, 'u')`,
    ).bind(id, photo, keys.before, keys.after, keys.clean, ready ? keys.afterClean : null),
  ]);
  return id;
}

async function signedWebhook(event: unknown): Promise<Response> {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = [...new Uint8Array(mac)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return fetchWorker("/api/webhooks/stripe", {
    method: "POST", headers: { "Stripe-Signature": `t=${timestamp},v1=${signature}` }, body,
  });
}

const completed = (session: any, livemode = false) =>
  ({ id: `evt_${crypto.randomUUID()}`, type: "checkout.session.completed", livemode, data: { object: session } });

const albumRow = (id: string) => env.DB.prepare("SELECT * FROM albums WHERE id = ?1").bind(id).first<any>();
const attempts = (id: string) => env.DB.prepare("SELECT * FROM checkouts WHERE album_id = ?1 ORDER BY created_at, rowid").bind(id).all<any>()
  .then(result => result.results);
const refundJobs = (id: string) => env.DB.prepare("SELECT * FROM refund_jobs WHERE album_id = ?1").bind(id).all<any>()
  .then(result => result.results);

/** Start a checkout and return the session Stripe made for it. */
async function openSession(albumId: string) {
  const response = await unlock(albumId);
  expect(response.status).toBe(303);
  const location = response.headers.get("Location")!;
  expect(location).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  return stripe.sessions.get(location.split("/").pop()!)!;
}

describe.sequential("album page", () => {
  it("offers the unlock only for a locked, priced album whose clean previews are ready", async () => {
    const forSale = await insertAlbum();
    const html = await (await fetchWorker(`/gallery/${forSale}`)).text();
    expect(html).toContain(`action="/gallery/${forSale}/unlock"`);
    expect(html).toContain("Unlock full resolution — $3.00");

    for (const options of [{ priceCents: 0 }, { ready: false }, { state: "unlocked" as const }]) {
      const id = await insertAlbum(options);
      const page = await (await fetchWorker(`/gallery/${id}`)).text();
      expect(page, JSON.stringify(options)).not.toContain("/unlock");
    }
  });

  it("refuses to start a checkout for an album that is not for sale", async () => {
    const id = await insertAlbum({ priceCents: 0 });
    const response = await unlock(id);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/gallery/${id}`);
    expect(stripe.calls).toHaveLength(0);
    expect(await attempts(id)).toHaveLength(0);
  });

  it("answers anything but POST on the unlock path with 405", async () => {
    const id = await insertAlbum();
    expect((await fetchWorker(`/gallery/${id}/unlock`)).status).toBe(405);
  });
});

describe.sequential("starting a checkout", () => {
  it("creates one card-only session without an expiry and hands it out again", async () => {
    const id = await insertAlbum();
    const session = await openSession(id);
    const create = stripe.creates()[0]!;
    const form = new URLSearchParams(create.body);
    expect(form.get("payment_method_types[0]")).toBe("card");
    expect(form.get("metadata[kind]")).toBe("album_unlock");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("300");
    expect(form.has("expires_at")).toBe(false);
    expect(form.has("client_reference_id")).toBe(false);
    expect(form.get("success_url")).toBe(`https://upscales.app/gallery/${id}?checkout={CHECKOUT_SESSION_ID}`);

    const [attempt] = await attempts(id);
    expect(create.key).toBe(`album-checkout:${attempt.id}`);
    expect(attempt).toMatchObject({ status: "open", session_id: session.id, expires_at: session.expires_at, request_body: create.body });

    const again = await unlock(id);
    expect(again.headers.get("Location")).toBe(session.url);
    expect(stripe.creates()).toHaveLength(1);
  });

  it("lets only one of two simultaneous requests create a session", async () => {
    const id = await insertAlbum();
    stripe.createDelayMs = 50;
    const responses = await Promise.all([unlock(id), unlock(id), unlock(id)]);
    expect(stripe.creates()).toHaveLength(1);
    expect(await attempts(id)).toHaveLength(1);
    const locations = responses.map(response => response.headers.get("Location"));
    expect(locations.filter(location => location?.startsWith("https://checkout.stripe.com/"))).toHaveLength(1);
    expect(locations.filter(location => location === `/gallery/${id}?payment=preparing`)).toHaveLength(2);
  });

  it("replaces an open session when the price changes", async () => {
    const id = await insertAlbum();
    const first = await openSession(id);
    await env.DB.prepare("UPDATE albums SET price_cents = 500 WHERE id = ?1").bind(id).run();
    const second = await openSession(id);
    expect(second.id).not.toBe(first.id);
    expect(second.amount_total).toBe(500);
    expect(first.status).toBe("expired");
    expect((await attempts(id)).map(row => row.status)).toEqual(["expired", "open"]);
  });

  it("closes a session that expired on its own, even when Stripe refuses to expire it", async () => {
    const id = await insertAlbum();
    const first = await openSession(id);
    first.status = "expired";
    await env.DB.prepare("UPDATE checkouts SET expires_at = ?2 WHERE session_id = ?1").bind(first.id, nowSeconds() - 10).run();
    // A stale read that still says open, so the expire call is made and refused.
    stripe.once(`GET /v1/checkout/sessions/${first.id}`, () => Response.json({ ...first, status: "open" }));

    const second = await openSession(id);
    expect(second.id).not.toBe(first.id);
    expect(stripe.calls.some(call => call.path.endsWith("/expire"))).toBe(true);
    expect((await attempts(id)).map(row => row.status)).toEqual(["expired", "open"]);
  });

  it("confirms an expiring session that turns out to be paid instead of opening another", async () => {
    const id = await insertAlbum();
    const first = await openSession(id);
    stripe.pay(first.id);
    await env.DB.prepare("UPDATE checkouts SET expires_at = ?2 WHERE session_id = ?1").bind(first.id, nowSeconds() + 60).run();

    const response = await unlock(id);
    expect(response.headers.get("Location")).toBe(`/gallery/${id}?payment=paid`);
    expect(stripe.creates()).toHaveLength(1);
    expect(await albumRow(id)).toMatchObject({ state: "unlocked", unlocked_payment_id: first.id });
  });

  it("keeps the session open when Stripe cannot say what it is", async () => {
    const id = await insertAlbum();
    const first = await openSession(id);
    await env.DB.prepare("UPDATE checkouts SET expires_at = ?2 WHERE session_id = ?1").bind(first.id, nowSeconds() - 10).run();
    stripe.once("GET /v1/checkout/sessions/", () => error(500, "Stripe is down"));

    const response = await unlock(id);
    expect(response.headers.get("Location")).toBe(`/gallery/${id}?payment=retry`);
    expect((await attempts(id)).map(row => row.status)).toEqual(["open"]);
    expect(stripe.creates()).toHaveLength(1);
  });
});

describe.sequential("recovering an attempt", () => {
  it("finishes an attempt whose worker died before calling Stripe, with the same body and key", async () => {
    const id = await insertAlbum();
    const checkoutId = crypto.randomUUID();
    const body = albumCheckoutBody({
      checkoutId, albumId: id, productName: "Unlock", priceCents: 300,
      successUrl: `https://upscales.app/gallery/${id}?checkout={CHECKOUT_SESSION_ID}`, cancelUrl: `https://upscales.app/gallery/${id}`,
    });
    // Old enough to be past the grace period, younger than Stripe's 30-minute
    // minimum lifetime -- a stored deadline would be refused here.
    const createdAt = nowSeconds() - 20 * 60;
    await env.DB.prepare(
      `INSERT INTO checkouts (id, album_id, amount_cents, currency, livemode, request_body, status, created_at, updated_at)
       VALUES (?1, ?2, 300, 'usd', 0, ?3, 'creating', ?4, ?4)`,
    ).bind(checkoutId, id, body, createdAt).run();

    const response = await unlock(id);
    expect(response.headers.get("Location")).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const [create] = stripe.creates();
    expect(create).toMatchObject({ body, key: `album-checkout:${checkoutId}` });
    const [attempt] = await attempts(id);
    expect(attempt.status).toBe("open");
    expect(attempt.expires_at).toBeGreaterThan(nowSeconds() + 3600);
  });

  it("expires a recovered session made at the old price and sends the buyer to the new one", async () => {
    const id = await insertAlbum({ priceCents: 300 });
    const checkoutId = crypto.randomUUID();
    const body = albumCheckoutBody({
      checkoutId, albumId: id, productName: "Unlock", priceCents: 800,
      successUrl: `https://upscales.app/gallery/${id}?checkout={CHECKOUT_SESSION_ID}`, cancelUrl: `https://upscales.app/gallery/${id}`,
    });
    // Hung at $8; set-price has since dropped the album to $3.
    await env.DB.prepare(
      `INSERT INTO checkouts (id, album_id, amount_cents, currency, livemode, request_body, status, created_at, updated_at)
       VALUES (?1, ?2, 800, 'usd', 0, ?3, 'creating', ?4, ?4)`,
    ).bind(checkoutId, id, body, nowSeconds() - 60).run();

    const response = await unlock(id);
    const [stale, fresh] = stripe.creates().map(call => stripe.keys.get(call.key!)!.response);
    expect(stale.amount_total).toBe(800);
    expect(stripe.sessions.get(stale.id).status).toBe("expired");
    expect(fresh.amount_total).toBe(300);
    expect(response.headers.get("Location")).toBe(fresh.url);
    expect((await attempts(id)).map(row => [row.status, row.amount_cents])).toEqual([["expired", 800], ["open", 300]]);
  });

  it("gets back the session Stripe made when the first answer was lost", async () => {
    const id = await insertAlbum();
    // Stripe makes the session, but the answer never arrives.
    stripe.once("POST /v1/checkout/sessions", async (): Promise<"network"> => {
      await stripe["route"]("POST", "/v1/checkout/sessions", stripe.calls.at(-1)!.body).then(async made => {
        const session = await made.json<any>();
        stripe.keys.set(stripe.calls.at(-1)!.key!, { body: stripe.calls.at(-1)!.body, response: session });
      });
      return "network";
    });
    const first = await unlock(id);
    expect(first.headers.get("Location")).toBe(`/gallery/${id}?payment=retry`);
    expect((await attempts(id))[0].status).toBe("creating");

    // Younger than the grace period, a second request waits.
    expect((await unlock(id)).headers.get("Location")).toBe(`/gallery/${id}?payment=preparing`);

    await env.DB.prepare("UPDATE checkouts SET created_at = created_at - 60 WHERE album_id = ?1").bind(id).run();
    const retried = await unlock(id);
    expect(stripe.sessions.size).toBe(1);
    expect(retried.headers.get("Location")).toBe([...stripe.sessions.values()][0].url);
    expect((await attempts(id)).map(row => row.attempts)).toEqual([2]);
  });

  it("gives up on an attempt Stripe refused, so the next request starts afresh", async () => {
    const id = await insertAlbum();
    stripe.once("POST /v1/checkout/sessions", () => error(400, "Invalid amount"));
    expect((await unlock(id)).headers.get("Location")).toBe(`/gallery/${id}?payment=failed`);
    expect((await attempts(id))[0]).toMatchObject({ status: "failed", last_error: "Invalid amount" });

    await openSession(id);
    expect((await attempts(id)).map(row => row.status)).toEqual(["failed", "open"]);
  });

  it("abandons an attempt too old for its idempotency key", async () => {
    const id = await insertAlbum();
    await env.DB.prepare(
      `INSERT INTO checkouts (id, album_id, amount_cents, currency, livemode, request_body, status, created_at, updated_at)
       VALUES (?1, ?2, 300, 'usd', 0, 'mode=payment', 'creating', ?3, ?3)`,
    ).bind(crypto.randomUUID(), id, nowSeconds() - 24 * 3600).run();
    await openSession(id);
    const rows = await attempts(id);
    expect(rows.map(row => [row.status, row.last_error])).toEqual([["failed", "abandoned"], ["open", null]]);
  });
});

describe.sequential("confirming a payment", () => {
  it("unlocks the album for everyone and switches to the clean previews", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openSession(id)).id);
    const response = await signedWebhook(completed(session));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, album: "unlocked" });

    expect(await albumRow(id)).toMatchObject({ state: "unlocked", unlocked_payment_id: session.id });
    expect((await attempts(id))[0].status).toBe("paid");
    const html = await (await fetchWorker(`/gallery/${id}`)).text();
    expect(html).toContain("after-v2.webp");
    expect(html).not.toContain("/unlock");
    expect(html).toContain("Download this photo");

    const photo = /\/media\/\w+\/(\w+)\/after\.webp/.exec(html)![1];
    expect(await (await fetchWorker(`/media/${id}/${photo}/after.webp`)).text()).toBe("afterClean");
    expect(await (await fetchWorker(`/media/${id}/cover.jpg`)).text()).toBe("coverClean");
    expect(await (await fetchWorker(`/media/${id}/gallery.jpg`)).text()).toBe("galleryClean");
    expect((await fetchWorker(`/download/${id}/${photo}`)).status).toBe(200);
  });

  it("still serves the watermarked previews while the album is locked", async () => {
    const id = await insertAlbum();
    const html = await (await fetchWorker(`/gallery/${id}`)).text();
    const photo = /\/media\/\w+\/(\w+)\/after\.webp/.exec(html)![1];
    expect(await (await fetchWorker(`/media/${id}/${photo}/after.webp`)).text()).toBe("after");
    expect(await (await fetchWorker(`/media/${id}/cover.jpg`)).text()).toBe("cover");
  });

  it("ignores a replayed event", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openSession(id)).id);
    await signedWebhook(completed(session));
    const replay = await signedWebhook(completed(session));
    expect(await replay.json()).toEqual({ received: true, album: "unlocked" });
    expect(await refundJobs(id)).toHaveLength(0);
    expect(stripe.calls.filter(call => call.path === "/v1/refunds")).toHaveLength(0);
  });

  it("does not unlock for an amount other than the one quoted", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openSession(id)).id, { amount_total: 50 });
    expect(await (await signedWebhook(completed(session))).json()).toEqual({ received: true, album: "mismatch" });
    expect((await albumRow(id)).state).toBe("locked");
  });

  it("unlocks from the success redirect before the webhook arrives, and not twice with it", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openSession(id)).id);
    const [redirect, webhook] = await Promise.all([
      fetchWorker(`/gallery/${id}?checkout=${session.id}`),
      signedWebhook(completed(session)),
    ]);
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("Location")).toBe(`/gallery/${id}?payment=paid`);
    expect(webhook.status).toBe(200);
    expect(await albumRow(id)).toMatchObject({ state: "unlocked", unlocked_payment_id: session.id });
    const events = await env.DB.prepare("SELECT outcome FROM payment_events WHERE album_id = ?1").bind(id).all();
    expect(events.results).toEqual([{ outcome: "unlocked" }]);
    expect(await refundJobs(id)).toHaveLength(0);

    const page = await (await fetchWorker(`/gallery/${id}?payment=paid`)).text();
    expect(page).toContain("Your photos are unlocked and ready to download");
  });

  it("does not ask Stripe about a session it did not create for this album", async () => {
    const id = await insertAlbum();
    const other = await insertAlbum();
    const foreign = await openSession(other);
    const calls = stripe.calls.length;
    for (const sessionId of ["cs_test_unknown", foreign.id, "../../v1/refunds"]) {
      const response = await fetchWorker(`/gallery/${id}?checkout=${encodeURIComponent(sessionId)}`);
      expect(response.headers.get("Location")).toBe(`/gallery/${id}`);
    }
    expect(stripe.calls.length).toBe(calls);
  });

  it("says the payment is being confirmed while it is still unpaid", async () => {
    const id = await insertAlbum();
    const session = await openSession(id);
    const response = await fetchWorker(`/gallery/${id}?checkout=${session.id}`);
    expect(response.headers.get("Location")).toBe(`/gallery/${id}?payment=pending`);
    expect((await albumRow(id)).state).toBe("locked");
  });
});

describe.sequential("refunding a payment that unlocked nothing", () => {
  it("refunds a payment for an album unlocked by hand while the buyer was paying", async () => {
    const id = await insertAlbum();
    const session = await openSession(id);
    await env.DB.prepare("UPDATE albums SET state = 'unlocked', unlocked_at = 1 WHERE id = ?1").bind(id).run();
    stripe.pay(session.id);

    expect(await (await signedWebhook(completed(session))).json()).toEqual({ received: true, album: "refund" });
    const [job] = await refundJobs(id);
    expect(job).toMatchObject({ payment_intent: session.payment_intent, reason: "already_unlocked", status: "succeeded" });
    const refundCalls = stripe.calls.filter(call => call.path === "/v1/refunds");
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]!.key).toBe(`album-refund:${session.payment_intent}`);
    expect((await albumRow(id)).unlocked_payment_id).toBeNull();

    // The buyer's way back says so.
    expect((await fetchWorker(`/gallery/${id}?checkout=${session.id}`)).headers.get("Location"))
      .toBe(`/gallery/${id}?payment=refunded`);
  });

  it("refunds a payment for an album deleted meanwhile", async () => {
    const id = await insertAlbum();
    const session = await openSession(id);
    await env.DB.prepare("UPDATE albums SET state = 'deleted' WHERE id = ?1").bind(id).run();
    stripe.pay(session.id);
    await signedWebhook(completed(session));
    expect((await refundJobs(id))[0]).toMatchObject({ reason: "album_deleted", status: "succeeded" });
  });

  it("keeps the refund queued when Stripe fails, and the cron finishes it", async () => {
    const id = await insertAlbum();
    const session = await openSession(id);
    await env.DB.prepare("UPDATE albums SET state = 'unlocked' WHERE id = ?1").bind(id).run();
    stripe.pay(session.id);
    stripe.once("POST /v1/refunds", () => "network");

    await signedWebhook(completed(session));
    expect((await refundJobs(id))[0]).toMatchObject({ status: "pending", attempts: 1 });

    // Stripe accepts the refund but has not settled it yet.
    stripe.refundStatus = "pending";
    await processRefundJobs(env);
    const [submitted] = await refundJobs(id);
    expect(submitted.status).toBe("submitted");

    // A replay of the event neither loses nor duplicates the job.
    await signedWebhook(completed(session));
    expect(await refundJobs(id)).toHaveLength(1);
    expect((await refundJobs(id))[0].status).toBe("submitted");

    stripe.refunds.get(submitted.refund_id)!.status = "succeeded";
    await processRefundJobs(env);
    expect((await refundJobs(id))[0].status).toBe("succeeded");
    const creates = stripe.calls.filter(call => call.method === "POST" && call.path === "/v1/refunds");
    expect(creates).toHaveLength(2);
    expect(new Set(creates.map(call => call.key))).toEqual(new Set([`album-refund:${session.payment_intent}`]));
  });

  it("marks a refund Stripe reports as failed", async () => {
    const id = await insertAlbum();
    const session = await openSession(id);
    await env.DB.prepare("UPDATE albums SET state = 'unlocked' WHERE id = ?1").bind(id).run();
    stripe.pay(session.id);
    stripe.refundStatus = "failed";
    await signedWebhook(completed(session));
    expect((await refundJobs(id))[0].status).toBe("failed");
  });

  it("leaves the album unlocked when its payment is refunded in Stripe", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openSession(id)).id);
    await signedWebhook(completed(session));
    const refunded = await signedWebhook({
      type: "charge.refunded",
      data: { object: { id: "ch_1", payment_intent: session.payment_intent, amount_refunded: 300, currency: "usd" } },
    });
    expect(await refunded.json()).toEqual({ received: true, ignored: "album_payment" });
    expect((await albumRow(id)).state).toBe("unlocked");
  });
});

describe.sequential("Stripe mode", () => {
  it("refuses to sell with a test key on a live deployment", async () => {
    const id = await insertAlbum();
    const outcome = await startAlbumCheckout({ ...env, STRIPE_MODE: "live" }, id, "https://upscales.app");
    expect(outcome).toEqual({ kind: "album", notice: "unavailable" });
    expect(stripe.calls).toHaveLength(0);
  });

  it("refuses to sell with a live key on a test deployment", async () => {
    const id = await insertAlbum();
    const outcome = await startAlbumCheckout({ ...env, STRIPE_SECRET_KEY: "sk_live_fake" }, id, "https://upscales.app");
    expect(outcome).toEqual({ kind: "album", notice: "unavailable" });
  });

  it("does not unlock from a test-mode event on a live deployment", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openSession(id)).id);
    const live = { ...env, STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_fake" };
    expect(await handleAlbumWebhook(live, completed(session, false)))
      .toEqual({ status: 200, body: { received: true, ignored: "livemode" } });
    // Even an event claiming live mode carries the test session it was made from.
    expect(await handleAlbumWebhook(live, completed(session, true)))
      .toEqual({ status: 200, body: { received: true, album: "mismatch" } });
    expect((await albumRow(id)).state).toBe("locked");
  });

  it("ignores a live-mode event on a test deployment", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openSession(id)).id);
    expect(await (await signedWebhook(completed(session, true))).json()).toEqual({ received: true, ignored: "livemode" });
    expect((await albumRow(id)).state).toBe("locked");
  });
});
