import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { creditBalance, failCloudJob, getOrCreateAccount, grantCredits, listActivity, startCloudJob } from "../src/accounts";
import { resetKeyCache } from "../src/auth";

const PROJECT = "upscaler-e9010";
const KID = "cloud-key";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const AURALENS = "https://auralens-406817559814.us-central1.run.app";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let keyPair: CryptoKeyPair;
let realFetch: typeof fetch;
let auralensCalls: { url: string; auth: string | null; fields: Record<string, string> }[] = [];
let auralensResponder: () => Response = () => Response.json({ output_url: "https://cdn.example/result.jpg" });

async function idToken(googleSub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
  const signingInput = `${encode({ alg: "RS256", kid: KID, typ: "JWT" })}.${encode({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "uid", iat: now - 10, exp: now + 3600,
    email: "cloud@example.com", firebase: { identities: { "google.com": [googleSub] } },
  })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://upscales.app${path}`, init));

function upload(requestId: string, options: { type?: string; bytes?: number } = {}): FormData {
  const form = new FormData();
  form.append("image", new File([new Uint8Array(options.bytes ?? 64)], "photo.jpg", { type: options.type ?? "image/jpeg" }));
  form.append("requestId", requestId);
  return form;
}

async function fundedAccount(sub: string, credits: number) {
  const account = await getOrCreateAccount(env.ACCOUNTS_DB, sub, "cloud@example.com");
  if (credits > 0) {
    await grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: credits, reason: "grant", idempotencyKey: `seed:${sub}` });
  }
  return account;
}

beforeEach(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  ) as CryptoKeyPair;
  resetKeyCache();
  auralensCalls = [];
  auralensResponder = () => Response.json({ output_url: "https://cdn.example/result.jpg" });
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === JWKS_URL) {
      const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
      return Response.json({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] });
    }
    if (request.url.startsWith(AURALENS)) {
      const form = await request.formData();
      const fields: Record<string, string> = {};
      form.forEach((value, name) => { if (typeof value === "string") fields[name] = value; });
      auralensCalls.push({ url: request.url, auth: request.headers.get("Authorization"), fields });
      return auralensResponder();
    }
    throw new Error(`Unexpected fetch in test: ${request.url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe.sequential("cloud jobs in the ledger", () => {
  it("charges and opens a job atomically, and refuses without leaving a trace when short", async () => {
    const account = await fundedAccount(`sub-${crypto.randomUUID()}`, 15);
    const first = await startCloudJob(env.ACCOUNTS_DB, { accountId: account.id, requestId: "req-aaaaaaaa", operation: "restore", credits: 20 });
    expect(first.kind).toBe("insufficient");
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(15);
    const jobs = await env.ACCOUNTS_DB.prepare("SELECT COUNT(*) AS n FROM cloud_jobs WHERE account_id = ?").bind(account.id).first<{ n: number }>();
    expect(jobs?.n).toBe(0);

    const second = await startCloudJob(env.ACCOUNTS_DB, { accountId: account.id, requestId: "req-bbbbbbbb", operation: "upscale_standard", credits: 5 });
    expect(second).toMatchObject({ kind: "started", balance: 10 });
  });

  it("refunds a failed job exactly once, and never a job that succeeded", async () => {
    const account = await fundedAccount(`sub-${crypto.randomUUID()}`, 50);
    const started = await startCloudJob(env.ACCOUNTS_DB, { accountId: account.id, requestId: "req-refund01", operation: "restore", credits: 20 });
    if (started.kind !== "started") throw new Error("expected a started job");
    const job = { id: started.job.id, accountId: account.id, credits: 20, operation: "restore" };
    expect(await failCloudJob(env.ACCOUNTS_DB, job, "boom")).toMatchObject({ refunded: true, balance: 50 });
    expect(await failCloudJob(env.ACCOUNTS_DB, job, "boom again")).toMatchObject({ refunded: false, balance: 50 });

    const kept = await startCloudJob(env.ACCOUNTS_DB, { accountId: account.id, requestId: "req-refund02", operation: "restore", credits: 20 });
    if (kept.kind !== "started") throw new Error("expected a started job");
    await env.ACCOUNTS_DB.prepare("UPDATE cloud_jobs SET status = 'succeeded' WHERE id = ?").bind(kept.job.id).run();
    expect(await failCloudJob(env.ACCOUNTS_DB, { ...job, id: kept.job.id }, "late failure")).toMatchObject({ refunded: false, balance: 30 });

    const activity = await listActivity(env.ACCOUNTS_DB, account.id);
    expect(activity.map(entry => [entry.reason, entry.delta, entry.detail])).toEqual([
      ["spend", -20, "restore"], ["reversal", 20, "restore"], ["spend", -20, "restore"], ["grant", 50, null],
    ]);
  });
});

describe.sequential("POST /api/cloud/:operation", () => {
  it("charges, calls auralens with the tool key, and returns the result", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    const response = await fetchWorker("/api/cloud/upscale_ultimate", {
      method: "POST", headers: { Authorization: `Bearer ${await idToken(sub)}` }, body: upload("req-success1"),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outputUrl: "https://cdn.example/result.jpg", balance: 75, charged: 25 });
    expect(auralensCalls).toHaveLength(1);
    expect(auralensCalls[0]!.url).toBe(`${AURALENS}/creative-upscale`);
    expect(auralensCalls[0]!.auth).toBe("Bearer test-tool-key-that-is-long-enough-000000");
    expect(auralensCalls[0]!.fields.advanced).toBe("true");
  });

  it("does not charge twice for a retried upload with the same request id", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    const send = async () => fetchWorker("/api/cloud/restore", {
      method: "POST", headers: { Authorization: `Bearer ${await idToken(sub)}` }, body: upload("req-retry001"),
    });
    expect(await (await send()).json()).toMatchObject({ balance: 80, charged: 20 });
    expect(await (await send()).json()).toMatchObject({ balance: 80, charged: 0, replayed: true });
    expect(auralensCalls).toHaveLength(1);
  });

  it("refunds the credits when processing fails", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 30);
    auralensResponder = () => new Response(JSON.stringify({ detail: "provider down" }), { status: 500 });
    const response = await fetchWorker("/api/cloud/restore", {
      method: "POST", headers: { Authorization: `Bearer ${await idToken(sub)}` }, body: upload("req-failure1"),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "processing_failed", refunded: true, balance: 30 });
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(30);
  });

  it("answers 402 with the shortfall and never calls auralens", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 4);
    const response = await fetchWorker("/api/cloud/upscale_standard", {
      method: "POST", headers: { Authorization: `Bearer ${await idToken(sub)}` }, body: upload("req-poor0001"),
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "insufficient_credits", balance: 4, required: 5 });
    expect(auralensCalls).toHaveLength(0);
  });

  it("validates the upload before charging anything", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 100);
    const token = await idToken(sub);
    const cases: [FormData, number][] = [
      [upload("req-badtype1", { type: "application/pdf" }), 415],
      [upload("bad id!"), 400],
      [(() => { const f = new FormData(); f.append("requestId", "req-noimage1"); return f; })(), 400],
    ];
    for (const [body, status] of cases) {
      expect((await fetchWorker("/api/cloud/restore", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body })).status).toBe(status);
    }
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(100);
    expect(auralensCalls).toHaveLength(0);
  });

  it("requires a token and rejects unknown operations", async () => {
    expect((await fetchWorker("/api/cloud/restore", { method: "POST", body: upload("req-noauth01") })).status).toBe(401);
    const sub = `sub-${crypto.randomUUID()}`;
    const response = await fetchWorker("/api/cloud/free_upscale", {
      method: "POST", headers: { Authorization: `Bearer ${await idToken(sub)}` }, body: upload("req-unknown1"),
    });
    expect(response.status).toBe(404);
  });
});
