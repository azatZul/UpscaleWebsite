import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WEBHOOK_SECRET = "whsec_test_secret";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newId = () => Array.from({ length: 26 }, () => ALPHABET[Math.floor(Math.random() * 32)]).join("");
const nowSeconds = () => Math.floor(Date.now() / 1000);

type Fault = () => Response | "network";

/** Just enough Stripe for tips: sessions made from the posted form, idempotent
 *  creates that compare the body like Stripe does, and one-shot faults keyed by
 *  "METHOD /path-prefix". */
class FakeStripe {
  sessions = new Map<string, any>();
  keys = new Map<string, { body: string; response: any }>();
  calls: { method: string; path: string; body: string; key: string | null }[] = [];
  faults: { route: string; fault: Fault }[] = [];
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
    const index = this.faults.findIndex(fault => `${request.method} ${url.pathname}`.startsWith(fault.route));
    if (index >= 0) {
      const result = this.faults.splice(index, 1)[0]!.fault();
      if (result === "network") throw new TypeError("network down");
      return result;
    }
    if (key && this.keys.has(key)) {
      const stored = this.keys.get(key)!;
      if (stored.body !== body) return error(400, "Keys for idempotent requests can only be used with the same parameters");
      return Response.json(stored.response);
    }
    if (request.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const form = new URLSearchParams(body);
      const id = `cs_test_${++this.counter}${crypto.randomUUID().replaceAll("-", "")}`;
      const session = {
        id, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${id}`, mode: form.get("mode"),
        status: "open", payment_status: "unpaid", payment_intent: null, livemode: false,
        amount_total: Number(form.get("line_items[0][price_data][unit_amount]")), currency: "usd",
        metadata: { kind: form.get("metadata[kind]"), album_id: form.get("metadata[album_id]"), tip_attempt: form.get("metadata[tip_attempt]") },
      };
      this.sessions.set(id, session);
      if (key) this.keys.set(key, { body, response: session });
      return Response.json(session);
    }
    const match = /^\/v1\/checkout\/sessions\/(\w+)$/.exec(url.pathname);
    if (match && request.method === "GET") {
      const session = this.sessions.get(match[1]!);
      return session ? Response.json(session) : error(404, "No such checkout.session");
    }
    throw new Error(`Unexpected Stripe call: ${request.method} ${url.pathname}`);
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

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://upscales.app${path}`, { redirect: "manual", ...init }));

type AlbumState = "locked" | "unlocked" | "deleted";

/** An album with one photo. `paid` marks it unlocked by a payment rather than by hand. */
async function insertAlbum(options: { state?: AlbumState; paid?: boolean } = {}): Promise<string> {
  const id = newId();
  const photo = newId();
  const prefix = `albums/${id}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO albums (
        id, title, note, state, featured, price_cents, currency, photo_count,
        cover_photo_id, cover_key, cover_mime, cover_width, cover_height, cover_bytes, created_at, unlocked_payment_id
      ) VALUES (?1, 'Family portraits', NULL, ?2, 1, 0, 'USD', 1, ?3, ?4, 'image/jpeg', 1200, 630, 5, ?5, ?6)`,
    ).bind(id, options.state ?? "unlocked", photo, `${prefix}/cover.jpg`, nowSeconds(), options.paid ? "cs_test_unlock" : null),
    env.DB.prepare(
      `INSERT INTO photos (
        album_id, id, position, before_key, before_width, before_height, before_bytes, before_sha256,
        after_key, after_width, after_height, after_bytes, after_sha256,
        clean_key, clean_width, clean_height, clean_bytes, clean_mime, clean_sha256, alt
      ) VALUES (?1, ?2, 0, ?3, 800, 600, 6, 'b', ?4, 800, 600, 5, 'a', ?5, 1600, 1200, 5, 'image/jpeg', 'c', 'Grandparents')`,
    ).bind(id, photo, `${prefix}/${photo}/before.webp`, `${prefix}/${photo}/after.webp`, `${prefix}/${photo}/clean.jpg`),
  ]);
  return id;
}

const page = async (path: string) => (await fetchWorker(path)).text();
const attemptOf = (html: string) => /name="attempt" value="([0-9a-f-]{36})"/.exec(html)?.[1];

function tipForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return form;
}

const postTip = (albumId: string, body: BodyInit, headers?: HeadersInit) =>
  fetchWorker(`/gallery/${albumId}/tip`, { method: "POST", body, headers });

/** Post the album's own form with an amount and return the session it opened. */
async function openTip(albumId: string, amount = "500", attempt?: string) {
  const response = await postTip(albumId, tipForm({ amount, attempt: attempt ?? crypto.randomUUID() }));
  expect(response.status).toBe(303);
  const location = response.headers.get("Location")!;
  expect(location).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  return stripe.sessions.get(location.split("/").pop()!)!;
}

async function signedWebhook(event: unknown): Promise<Response> {
  const body = JSON.stringify(event);
  const timestamp = nowSeconds();
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = [...new Uint8Array(mac)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return fetchWorker("/api/webhooks/stripe", {
    method: "POST", headers: { "Stripe-Signature": `t=${timestamp},v1=${signature}` }, body,
  });
}

const event = (type: string, object: any, livemode = false) =>
  ({ id: `evt_${crypto.randomUUID()}`, type, livemode, data: { object } });

const tipRows = (albumId: string) => env.DB.prepare("SELECT * FROM album_tips WHERE album_id = ?1").bind(albumId).all<any>()
  .then(result => result.results);

const receivedLogs = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter(([line]: unknown[]) => typeof line === "string" && line.includes('"album_tip_received"')).length;

describe.sequential("tip card", () => {
  it("is offered on free albums only", async () => {
    const free = await insertAlbum();
    const html = await page(`/gallery/${free}`);
    expect(html).toContain(`action="/gallery/${free}/tip"`);
    expect(html).toContain("data-tip-open");
    expect(html).toContain("data-tip-dialog");
    for (const options of [{ state: "locked" as const }, { paid: true }]) {
      const id = await insertAlbum(options);
      const other = await page(`/gallery/${id}`);
      expect(other, JSON.stringify(options)).not.toContain("/tip\"");
      expect(other, JSON.stringify(options)).not.toContain("data-tip-open");
      expect(other, JSON.stringify(options)).not.toContain("data-tip-dialog");
      expect(other, JSON.stringify(options)).not.toContain("tip-modal");
    }
    expect((await fetchWorker(`/gallery/${await insertAlbum({ state: "deleted" })}`)).status).toBe(410);
  });

  it("is complete without JS: $5 checked, a neutral label, a fresh attempt per render", async () => {
    const id = await insertAlbum();
    const html = await page(`/gallery/${id}`);
    // One form, folded into a <details> until site.js moves it into the dialog; the dialog
    // starts empty and the boot script that hides the fallback runs before any of it.
    expect(html.match(/data-album-tip/g)).toHaveLength(1);
    expect(html).toMatch(/<details class="tip-fallback[^>]*>[\s\S]*data-album-tip[\s\S]*<\/details>/);
    expect(html).toMatch(/<dialog[^>]*data-tip-dialog[^>]*>(?:(?!<\/dialog>)[\s\S])*<\/dialog>/);
    expect(html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"))).not.toContain("data-album-tip");
    expect(html.indexOf('classList.add("tip-modal")')).toBeLessThan(html.indexOf("data-tip-open"));
    expect(html).toContain('<input type="radio" name="amount" value="500" checked>');
    for (const cents of ["200", "300", "700", "1000"]) {
      expect(html).toContain(`<input type="radio" name="amount" value="${cents}">`);
    }
    expect(html).toContain(">Leave a tip</button>");
    // The mascot and the caption follow the checked amount in CSS alone: one caption per amount.
    expect(html).toContain('class="tip-mascot"');
    for (const [mood, caption] of [["m2", "Buys an espresso"], ["m5", "Coffee and a smile"], ["m10", "You just made our day!"]]) {
      expect(html).toContain(`<span class="${mood}">${caption}</span>`);
    }
    const again = await page(`/gallery/${id}`);
    expect(attemptOf(html)).toBeTruthy();
    expect(attemptOf(again)).not.toBe(attemptOf(html));
  });

  it("hands photo downloads on free albums to the saved dialog, and no others", async () => {
    const free = await insertAlbum();
    const html = await page(`/gallery/${free}`);
    expect(html).toMatch(new RegExp(`href="/download/${free}/\\w+" data-tip-download="/media/${free}/\\w+/after\\.webp\\?v=after\\.webp"`));
    expect(html).toContain("data-tip-saved hidden");
    expect(html).toContain('id="tip-saved-title"');
    // Locked albums have no downloads; paid ones keep the browser's own download.
    const paid = await insertAlbum({ paid: true });
    const paidHtml = await page(`/gallery/${paid}`);
    expect(paidHtml).toContain(`href="/download/${paid}/`);
    expect(paidHtml).not.toContain("data-tip-download");
  });

  it("answers anything but POST on the tip path with 405", async () => {
    expect((await fetchWorker(`/gallery/${await insertAlbum()}/tip`)).status).toBe(405);
  });
});

describe.sequential("starting a tip", () => {
  it("opens a card-only session for each allowed amount", async () => {
    const id = await insertAlbum();
    for (const amount of ["200", "300", "500", "700", "1000"]) {
      const attempt = crypto.randomUUID();
      const session = await openTip(id, amount, attempt);
      const create = stripe.creates().at(-1)!;
      const form = new URLSearchParams(create.body);
      expect(session.amount_total).toBe(Number(amount));
      expect(form.get("metadata[kind]")).toBe("album_tip");
      expect(form.get("metadata[album_id]")).toBe(id);
      expect(form.get("payment_method_types[0]")).toBe("card");
      expect(form.get("line_items[0][price_data][product_data][name]")).toBe("Tip for UScale");
      expect(form.get("success_url")).toBe(`https://upscales.app/gallery/${id}?tip={CHECKOUT_SESSION_ID}`);
      expect(create.key).toBe(`album-tip:${id}:${attempt}:${amount}`);
    }
  });

  it("reuses one session for a resubmitted form, even after the album is renamed", async () => {
    const id = await insertAlbum();
    const attempt = crypto.randomUUID();
    const first = await openTip(id, "700", attempt);
    await env.DB.prepare("UPDATE albums SET title = 'Renamed' WHERE id = ?1").bind(id).run();
    const second = await openTip(id, "700", attempt);
    expect(second.id).toBe(first.id);
    expect(stripe.sessions.size).toBe(1);
  });

  it("opens a new session when the same form is sent with another amount", async () => {
    const id = await insertAlbum();
    const attempt = crypto.randomUUID();
    const five = await openTip(id, "500", attempt);
    const ten = await openTip(id, "1000", attempt);
    expect(ten.id).not.toBe(five.id);
    expect(ten.amount_total).toBe(1000);
  });

  it("sends a garbled form back to the album without asking Stripe", async () => {
    const id = await insertAlbum();
    const bad = [
      postTip(id, tipForm({ attempt: crypto.randomUUID() })),
      postTip(id, tipForm({ amount: "400", attempt: crypto.randomUUID() })),
      postTip(id, tipForm({ amount: "500" })),
      postTip(id, tipForm({ amount: "500", attempt: "not-a-uuid" })),
      postTip(id, JSON.stringify({ amount: 500, attempt: crypto.randomUUID() }), { "Content-Type": "application/json" }),
    ];
    for (const response of await Promise.all(bad)) {
      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(`/gallery/${id}?payment=failed`);
    }
    expect(stripe.calls).toHaveLength(0);
  });

  it("refuses locked and paid albums", async () => {
    for (const options of [{ state: "locked" as const }, { paid: true }]) {
      const id = await insertAlbum(options);
      const response = await postTip(id, tipForm({ amount: "500", attempt: crypto.randomUUID() }));
      expect(response.headers.get("Location")).toBe(`/gallery/${id}`);
    }
    expect(stripe.calls).toHaveLength(0);
  });

  it("says retry when Stripe's answer is unknown and failed when it refused", async () => {
    const id = await insertAlbum();
    stripe.once("POST /v1/checkout/sessions", () => "network");
    let response = await postTip(id, tipForm({ amount: "500", attempt: crypto.randomUUID() }));
    expect(response.headers.get("Location")).toBe(`/gallery/${id}?payment=retry`);
    stripe.once("POST /v1/checkout/sessions", () => error(400, "Invalid request"));
    response = await postTip(id, tipForm({ amount: "500", attempt: crypto.randomUUID() }));
    expect(response.headers.get("Location")).toBe(`/gallery/${id}?payment=failed`);
  });
});

describe.sequential("confirming a tip", () => {
  it("records it once whether the webhook or the return comes first", async () => {
    const log = vi.spyOn(console, "log");
    for (const order of ["webhook-first", "return-first"]) {
      const id = await insertAlbum();
      const session = stripe.pay((await openTip(id)).id);
      const viaWebhook = () => signedWebhook(event("checkout.session.completed", session));
      const viaReturn = () => fetchWorker(`/gallery/${id}?tip=${session.id}`);
      const before = receivedLogs(log);
      if (order === "webhook-first") {
        expect((await viaWebhook()).status).toBe(200);
        expect(await (await viaReturn()).text()).toContain("Thank you for the tip!");
      } else {
        expect(await (await viaReturn()).text()).toContain("Thank you for the tip!");
        expect((await viaWebhook()).status).toBe(200);
      }
      expect(await tipRows(id), order).toHaveLength(1);
      expect(receivedLogs(log) - before, order).toBe(1);
    }
  });

  it("records one row when the webhook and the return race", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openTip(id)).id);
    await Promise.all([
      signedWebhook(event("checkout.session.completed", session)),
      fetchWorker(`/gallery/${id}?tip=${session.id}`),
      fetchWorker(`/gallery/${id}?tip=${session.id}`),
    ]);
    const rows = await tipRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount_cents: 500, currency: "usd", livemode: 0, payment_intent: `pi_${session.id}` });
  });

  it("ignores a session that is not a tip we would have made", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["mode", { mode: "subscription" }],
      ["amount", { amount_total: 400 }],
      ["currency", { currency: "eur" }],
      ["payment intent", { payment_intent: "" }],
      ["livemode", { livemode: true }],
      ["unknown album", { metadata: { kind: "album_tip", album_id: newId() } }],
    ];
    for (const [name, overrides] of cases) {
      const id = await insertAlbum();
      const session = stripe.pay((await openTip(id)).id, overrides);
      const response = await signedWebhook(event("checkout.session.completed", session));
      expect(await response.json(), name).toMatchObject({ received: true });
      expect(await tipRows(id), name).toHaveLength(0);
    }
  });

  it("does not credit an unpaid session", async () => {
    const id = await insertAlbum();
    const session = await openTip(id);
    const body = await (await signedWebhook(event("checkout.session.completed", session))).json();
    expect(body).toMatchObject({ tip: "unpaid" });
    expect(await tipRows(id)).toHaveLength(0);
  });

  it("keeps tip sessions out of the credits path", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openTip(id)).id);
    const body = await (await signedWebhook(event("checkout.session.completed", session))).json() as any;
    expect(body).toEqual({ received: true, tip: "recorded" });
    expect(body.error).toBeUndefined();
  });

  it("logs a refund or dispute of a tip and changes nothing", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openTip(id)).id);
    await signedWebhook(event("checkout.session.completed", session));
    const charge = { id: "ch_1", payment_intent: session.payment_intent, amount_refunded: 500, currency: "usd" };
    expect(await (await signedWebhook(event("charge.refunded", charge))).json()).toMatchObject({ ignored: "album_tip" });
    const dispute = { id: "dp_1", payment_intent: session.payment_intent, amount: 500, currency: "usd" };
    expect(await (await signedWebhook(event("charge.dispute.funds_withdrawn", dispute))).json()).toMatchObject({ ignored: "album_tip" });
    expect(await tipRows(id)).toHaveLength(1);
  });
});

describe.sequential("coming back from a tip", () => {
  it("keeps the session in the URL and hides the form while the tip is unconfirmed", async () => {
    const id = await insertAlbum();
    const session = await openTip(id);
    stripe.once("GET /v1/checkout/sessions", () => error(503, "Try again"));
    const pending = await fetchWorker(`/gallery/${id}?tip=${session.id}`);
    expect(pending.status).toBe(200);
    const html = await pending.text();
    expect(html).toContain("Your tip is being confirmed");
    expect(html).toContain(`href="/gallery/${id}?tip=${session.id}"`);
    expect(html).toContain("sessionStorage");
    expect(html).not.toContain(`action="/gallery/${id}/tip"`);
    expect(html).not.toContain("data-tip-open");
    expect(html).not.toContain("data-tip-dialog");
    expect(html).not.toContain("data-tip-download");

    // Paid, and Stripe answers again: the same URL now thanks the buyer.
    stripe.pay(session.id);
    const tipped = await page(`/gallery/${id}?tip=${session.id}`);
    expect(tipped).toContain("Thank you for the tip!");
    expect(tipped).toContain("is-thanked");
    expect(tipped).not.toContain(`action="/gallery/${id}/tip"`);
    expect(tipped).not.toContain("data-tip-open");
    expect(tipped).not.toContain("data-tip-dialog");
    expect(tipped).not.toContain("data-tip-download");
  });

  it("treats an unpaid session as pending", async () => {
    const id = await insertAlbum();
    const session = await openTip(id);
    expect(await page(`/gallery/${id}?tip=${session.id}`)).toContain("Your tip is being confirmed");
  });

  it("answers a recorded tip without asking Stripe", async () => {
    const id = await insertAlbum();
    const session = stripe.pay((await openTip(id)).id);
    await signedWebhook(event("checkout.session.completed", session));
    const before = stripe.calls.length;
    expect(await page(`/gallery/${id}?tip=${session.id}`)).toContain("Thank you for the tip!");
    expect(stripe.calls.length).toBe(before);
  });

  it("drops a session Stripe does not know, or one for another album", async () => {
    const id = await insertAlbum();
    const missing = await fetchWorker(`/gallery/${id}?tip=cs_test_doesnotexist`);
    expect(missing.status).toBe(303);
    expect(missing.headers.get("Location")).toBe(`/gallery/${id}`);

    const other = await insertAlbum();
    const session = stripe.pay((await openTip(other)).id);
    const foreign = await fetchWorker(`/gallery/${id}?tip=${session.id}`);
    expect(foreign.headers.get("Location")).toBe(`/gallery/${id}`);
    expect(await tipRows(id)).toHaveLength(0);

    const garbled = await fetchWorker(`/gallery/${id}?tip=${encodeURIComponent("<script>")}`);
    expect(garbled.headers.get("Location")).toBe(`/gallery/${id}`);
  });
});
