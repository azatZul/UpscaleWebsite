// Only the verified payment paths may enqueue PURCHASE. The public relay has
// a small allowlist, browser-bound consent, same-origin checks and a rate limit.
const COOKIE = "__Host-uscale-ads";
const RETENTION_MS = 30 * 86400_000;
const MAX_EVENT_AGE = 7 * 86400_000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLICK = /^[a-zA-Z0-9_.:-]{1,256}$/;
const RELAY_EVENTS = new Set(["PageVisit", "UpscaleCompleted", "RestoreCompleted", "ResultDownloaded"]);

export interface RedditEnv {
  ACCOUNTS_DB: D1Database;
  DB: D1Database;
  REDDIT_PIXEL_ID?: string;
  REDDIT_CAPI_ACCESS_TOKEN?: string;
  REDDIT_ENABLED?: string;
  STRIPE_MODE?: string;
}

interface Context {
  id: string;
  click_id: string | null;
  allowed: number;
  expires_at: number;
}

export interface RedditSnapshot {
  contextId: string;
  payload: Record<string, unknown>;
}

function enabled(env: RedditEnv): boolean {
  return env.REDDIT_ENABLED === "true" && !!env.REDDIT_PIXEL_ID && !!env.REDDIT_CAPI_ACCESS_TOKEN
    && env.STRIPE_MODE === "live";
}

function response(body: unknown, status = 200, cookie?: string): Response {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store",
    ...(cookie ? { "Set-Cookie": cookie } : {}),
  } });
}

export function contextCookie(request: Request): string | null {
  const value = request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && ID.test(value) ? value : null;
}

async function activeContext(request: Request, env: RedditEnv, now: number): Promise<Context | null> {
  const id = contextCookie(request);
  return id ? env.ACCOUNTS_DB.prepare(
    "SELECT id, click_id, allowed, expires_at FROM reddit_contexts WHERE id = ? AND allowed = 1 AND expires_at > ?",
  ).bind(id, now).first<Context>() : null;
}

// Never forward query strings: auth action codes and signed image URLs are not
// advertising data. Product paths are sufficient to identify funnel stages.
export function safeSource(path: unknown): string {
  if (typeof path !== "string" || path.length > 300 || !/^\/[a-zA-Z0-9/_\-.]*$/.test(path)) return "https://upscales.app/";
  return `https://upscales.app${path}`;
}

function touch(body: Record<string, unknown>, now: number): string {
  const fields: Record<string, unknown> = { at: now, url: safeSource(body.path) };
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const value = body[key];
    if (typeof value === "string") fields[key] = value.replace(/[\x00-\x1f]/g, "").slice(0, 150);
  }
  return JSON.stringify(fields);
}

export async function snapshotForRequest(request: Request, env: RedditEnv): Promise<RedditSnapshot | null> {
  if (!enabled(env) || new URL(request.url).hostname !== "upscales.app") return null;
  const context = await activeContext(request, env, Date.now());
  if (!context) return null;
  const user: Record<string, string> = {};
  const ip = request.headers.get("CF-Connecting-IP");
  const ua = request.headers.get("User-Agent");
  if (ip) user.ip_address = ip;
  if (ua) user.user_agent = ua.slice(0, 1000);
  const uuid = request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith("_rdt_uuid="))?.slice("_rdt_uuid=".length);
  // Reuse Reddit's own first-party identifier when a marketing page set it.
  if (uuid && /^[a-zA-Z0-9._-]{10,120}$/.test(uuid)) user.uuid = uuid;
  const payload: Record<string, unknown> = {
    action_source: "WEBSITE", event_source_url: safeSource(new URL(request.url).pathname), user,
  };
  if (context.click_id) payload.click_id = context.click_id;
  return { contextId: context.id, payload };
}

export function checkoutSnapshotStatement(db: D1Database, id: string, snapshot: RedditSnapshot): D1PreparedStatement {
  return db.prepare("INSERT OR IGNORE INTO reddit_checkouts (id, context_id, snapshot, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, snapshot.contextId, JSON.stringify(snapshot.payload), Date.now());
}

// INSERT...SELECT keeps the snapshot inside the financial batch. Unique event
// IDs make webhook replay, a lost HTTP response and retries safe.
export function checkoutEventStatement(
  db: D1Database, checkoutId: string, conversionId: string, type: string,
  metadata: Record<string, unknown>, at: number, condition = "1", bindings: unknown[] = [],
): D1PreparedStatement {
  return db.prepare(`INSERT OR IGNORE INTO reddit_outbox (conversion_id, context_id, payload, event_at)
    SELECT ?, context_id, json_set(snapshot, '$.event_at', ?, '$.type', json(?), '$.metadata', json(?)), ?
      FROM reddit_checkouts WHERE id = ? AND (${condition})`)
    .bind(conversionId, at, JSON.stringify(type === "PURCHASE" ? { tracking_type: type }
      : { tracking_type: "CUSTOM", custom_event_name: type }),
    JSON.stringify({ ...metadata, conversion_id: conversionId }), at, checkoutId, ...bindings);
}

export function purchaseMetadata(amountCents: number, currency: string, product: string): Record<string, unknown> {
  return { value: amountCents / 100, currency: currency.toUpperCase(), item_count: 1,
    products: [{ id: product, category: product, name: product === "credit_topup" ? "UScale credits" : "Album unlock", quantity: 1,
      item_price: amountCents / 100 }] };
}

export async function handleRedditRequest(request: Request, env: RedditEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  if (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return response({ error: "forbidden" }, 403);
  }
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return response({ error: "invalid_body" }, 400);
  // A bounded reader avoids buffering arbitrary requests on this public route.
  const reader = request.body?.getReader();
  if (!reader) return response({ error: "invalid_body" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); return response({ error: "too_large" }, 413); }
    chunks.push(value);
  }
  let body: Record<string, unknown>;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return response({ error: "invalid_body" }, 400); }
  const now = Date.now();
  const cookieId = contextCookie(request);
  if (url.pathname === "/api/ads/consent" && body.advertising === false) {
    if (cookieId) {
      await env.ACCOUNTS_DB.prepare("UPDATE reddit_contexts SET allowed = 0, click_id = NULL, first_touch = '{}', last_touch = '{}' WHERE id = ?")
        .bind(cookieId).run();
      for (const db of [env.ACCOUNTS_DB, env.DB]) {
        await db.batch([
          db.prepare("DELETE FROM reddit_checkouts WHERE context_id = ?").bind(cookieId),
          db.prepare("UPDATE reddit_outbox SET status = CASE WHEN status IN ('pending', 'failed') THEN 'discarded' ELSE status END, payload = '{}' WHERE context_id = ?")
            .bind(cookieId),
        ]);
      }
    }
    return response({ accepted: false });
  }
  if (!enabled(env) || url.hostname !== "upscales.app") return response({ accepted: false });
  if (url.pathname === "/api/ads/consent") {
    if (body.v !== 2 || body.advertising !== true) return response({ error: "consent_required" }, 400);
    const existing = await activeContext(request, env, now);
    const click = typeof body.clickId === "string" && CLICK.test(body.clickId) ? body.clickId : null;
    if (existing) {
      if (click && click !== existing.click_id) {
        await env.ACCOUNTS_DB.prepare("UPDATE reddit_contexts SET click_id = ?, last_touch = ? WHERE id = ? AND allowed = 1")
          .bind(click, touch(body, now), existing.id).run();
      }
      return response({ accepted: true });
    }
    const id = crypto.randomUUID();
    const captured = touch(body, now);
    await env.ACCOUNTS_DB.prepare(`INSERT INTO reddit_contexts
      (id, click_id, first_touch, last_touch, created_at, expires_at, rate_started_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, click, captured, captured, now, now + RETENTION_MS, now).run();
    return response({ accepted: true }, 200, `${COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${RETENTION_MS / 1000}`);
  }
  if (url.pathname !== "/api/ads/event") return response({ error: "not_found" }, 404);
  if (typeof body.event !== "string" || !RELAY_EVENTS.has(body.event) || typeof body.id !== "string" || !ID.test(body.id)) {
    return response({ error: "invalid_event" }, 400);
  }
  const snapshot = await snapshotForRequest(request, env);
  if (!snapshot) return response({ accepted: false });
  const limit = await env.ACCOUNTS_DB.prepare(`UPDATE reddit_contexts SET
    rate_count = CASE WHEN rate_started_at < ?1 THEN 1 ELSE rate_count + 1 END,
    rate_started_at = CASE WHEN rate_started_at < ?1 THEN ?2 ELSE rate_started_at END
    WHERE id = ?3 AND allowed = 1 AND (rate_started_at < ?1 OR rate_count < 100)`)
    .bind(now - 3600_000, now, snapshot.contextId).run();
  if (limit.meta.changes !== 1) return response({ error: "rate_limited" }, 429);
  const payload = { ...snapshot.payload, event_source_url: safeSource(body.path), event_at: now,
    type: body.event === "PageVisit" ? { tracking_type: "PAGE_VISIT" } : { tracking_type: "CUSTOM", custom_event_name: body.event },
    metadata: { conversion_id: body.id } };
  await env.ACCOUNTS_DB.prepare(`INSERT OR IGNORE INTO reddit_outbox
    (conversion_id, context_id, payload, event_at) VALUES (?, ?, ?, ?)`)
    .bind(body.id, snapshot.contextId, JSON.stringify(payload), now).run();
  ctx.waitUntil(dispatchReddit(env).catch(() => logFailure("dispatch")));
  return response({ accepted: true });
}

export function logFailure(operation: string): void {
  // Do not log tokens, matching data, URLs with query strings or raw responses.
  console.error(JSON.stringify({ event: "reddit_tracking_failed", operation }));
}

interface OutboxRow { conversion_id: string; context_id: string; payload: string; event_at: number; attempts: number }

export async function dispatchReddit(env: RedditEnv, now = Date.now()): Promise<void> {
  for (const db of [env.ACCOUNTS_DB, env.DB]) {
    const rows = enabled(env) ? await db.prepare(`SELECT conversion_id, context_id, payload, event_at, attempts FROM reddit_outbox
      WHERE status = 'pending' AND next_attempt_at <= ? AND lease_until <= ? ORDER BY event_at LIMIT 20`)
      .bind(now, now).all<OutboxRow>() : { results: [] };
    for (const row of rows.results) {
      const claimed = await db.prepare(`UPDATE reddit_outbox SET lease_until = ?, attempts = attempts + 1
        WHERE conversion_id = ? AND status = 'pending' AND lease_until <= ?`)
        .bind(now + 60_000, row.conversion_id, now).run();
      if (claimed.meta.changes !== 1) continue;
      const consent = await env.ACCOUNTS_DB.prepare("SELECT id FROM reddit_contexts WHERE id = ? AND allowed = 1 AND expires_at > ?")
        .bind(row.context_id, now).first();
      if (!consent || row.event_at < now - MAX_EVENT_AGE) {
        await db.prepare("UPDATE reddit_outbox SET status = 'discarded', payload = '{}', last_error = ? WHERE conversion_id = ?")
          .bind(consent ? "event_expired" : "consent_unavailable", row.conversion_id).run();
        continue;
      }
      let status = 0;
      let accepted = false;
      try {
        const result = await fetch(`https://ads-api.reddit.com/api/v3/pixels/${encodeURIComponent(env.REDDIT_PIXEL_ID!)}/conversion_events`, {
          method: "POST", signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${env.REDDIT_CAPI_ACCESS_TOKEN}`, "Content-Type": "application/json",
            "User-Agent": "UScale-Website-Conversions/1.0" },
          body: JSON.stringify({ data: { events: [JSON.parse(row.payload)] } }),
        });
        status = result.status;
        const body = await result.json().catch(() => null) as { error?: unknown; errors?: unknown[] } | null;
        accepted = result.ok && !!body && !body.error && !(Array.isArray(body.errors) && body.errors.length);
      } catch { /* Timeouts are retried with the original conversion ID. */ }
      if (accepted) {
        await db.prepare("UPDATE reddit_outbox SET status = 'delivered', delivered_at = ?, payload = '{}', last_error = NULL WHERE conversion_id = ?")
          .bind(now, row.conversion_id).run();
      } else {
        // Config errors can be repaired; keep retrying until the event expires.
        const permanent = status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
        await db.prepare(`UPDATE reddit_outbox SET status = ?, lease_until = 0, next_attempt_at = ?, last_error = ?
          WHERE conversion_id = ?`).bind(permanent ? "failed" : "pending",
          now + Math.min(6 * 3600_000, 30_000 * 2 ** Math.min(row.attempts, 10)),
          status ? `http_${status}` : "network_or_response", row.conversion_id).run();
        logFailure(permanent ? "event_rejected" : "delivery_retry");
      }
    }
    // Drop matching data once its declared retention has elapsed.
    await db.prepare("DELETE FROM reddit_checkouts WHERE created_at < ?").bind(now - RETENTION_MS).run();
    await db.prepare("DELETE FROM reddit_outbox WHERE event_at < ?").bind(now - RETENTION_MS).run();
  }
  await env.ACCOUNTS_DB.prepare("DELETE FROM reddit_contexts WHERE expires_at < ?").bind(now).run();
}
