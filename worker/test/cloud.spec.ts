import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { creditBalance, failCloudJob, listActivity, refundStaleJobs, startCloudJob } from "../src/accounts";
import { RESULT_URL, cloudForm, fetchWorker, fundedAccount, installStubs, type Stubs } from "./helpers";

let stubs: Stubs;
beforeEach(async () => { stubs = await installStubs(); });
afterEach(() => stubs.restore());

const jobInput = (accountId: string, requestId: string, credits: number, priceKey = "restore:restore") =>
  ({ accountId, requestId, operation: "restore", options: "{}", priceKey, credits });

async function post(sub: string, path: string, form: FormData) {
  return fetchWorker(path, { method: "POST", headers: { Authorization: `Bearer ${await stubs.idToken(sub)}` }, body: form });
}

const objectsFor = async (accountId: string) =>
  (await env.USER_MEDIA.list({ prefix: `users/${accountId}/` })).objects.map(object => object.key);

describe.sequential("cloud jobs in the ledger", () => {
  it("charges and opens a job atomically, and refuses without leaving a trace when short", async () => {
    const account = await fundedAccount(`sub-${crypto.randomUUID()}`, 15);
    expect((await startCloudJob(env.ACCOUNTS_DB, jobInput(account.id, "req-aaaaaaaa", 20))).kind).toBe("insufficient");
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(15);
    const jobs = await env.ACCOUNTS_DB.prepare("SELECT COUNT(*) AS n FROM cloud_jobs WHERE account_id = ?").bind(account.id).first<{ n: number }>();
    expect(jobs?.n).toBe(0);
    expect(await startCloudJob(env.ACCOUNTS_DB, jobInput(account.id, "req-bbbbbbbb", 5, "creative:4k"))).toMatchObject({ kind: "started", balance: 10 });
  });

  it("refunds a failed job exactly once, never one that succeeded, and labels the ledger by price", async () => {
    const account = await fundedAccount(`sub-${crypto.randomUUID()}`, 50);
    const started = await startCloudJob(env.ACCOUNTS_DB, jobInput(account.id, "req-refund01", 20, "restore:advanced_restoration"));
    if (started.kind !== "started") throw new Error("expected a started job");
    const job = { id: started.job.id, accountId: account.id, credits: 20, priceKey: "restore:advanced_restoration" };
    expect(await failCloudJob(env.ACCOUNTS_DB, job, "boom")).toMatchObject({ refunded: true, balance: 50 });
    expect(await failCloudJob(env.ACCOUNTS_DB, job, "boom again")).toMatchObject({ refunded: false, balance: 50 });

    const kept = await startCloudJob(env.ACCOUNTS_DB, jobInput(account.id, "req-refund02", 20, "restore:advanced_restoration"));
    if (kept.kind !== "started") throw new Error("expected a started job");
    await env.ACCOUNTS_DB.prepare("UPDATE cloud_jobs SET status = 'succeeded' WHERE id = ?").bind(kept.job.id).run();
    expect(await failCloudJob(env.ACCOUNTS_DB, { ...job, id: kept.job.id }, "late")).toMatchObject({ refunded: false, balance: 30 });

    const activity = await listActivity(env.ACCOUNTS_DB, account.id);
    expect(activity.map(entry => [entry.reason, entry.delta, entry.detail])).toEqual([
      ["spend", -20, "restore:advanced_restoration"], ["reversal", 20, "restore:advanced_restoration"],
      ["spend", -20, "restore:advanced_restoration"], ["grant", 50, null],
    ]);
  });
});

describe.sequential("stale job refunds", () => {
  it("refunds jobs whose request died, once, and leaves recent ones alone", async () => {
    const account = await fundedAccount(`sub-${crypto.randomUUID()}`, 50);
    const stale = await startCloudJob(env.ACCOUNTS_DB, jobInput(account.id, "req-stale-001", 15));
    const recent = await startCloudJob(env.ACCOUNTS_DB, jobInput(account.id, "req-recent-01", 15));
    if (stale.kind !== "started" || recent.kind !== "started") throw new Error("expected started jobs");
    const hourAgo = Date.now() - 60 * 60 * 1000;
    await env.ACCOUNTS_DB.prepare("UPDATE cloud_jobs SET created_at = ? WHERE id = ?").bind(hourAgo, stale.job.id).run();

    expect(await refundStaleJobs(env.ACCOUNTS_DB, Date.now() - 15 * 60 * 1000)).toBeGreaterThanOrEqual(1);
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(35);
    expect(await refundStaleJobs(env.ACCOUNTS_DB, Date.now() - 15 * 60 * 1000)).toBe(0);
    const statuses = await env.ACCOUNTS_DB.prepare("SELECT id, status FROM cloud_jobs WHERE account_id = ?").bind(account.id).all<{ id: string; status: string }>();
    expect(Object.fromEntries(statuses.results.map(row => [row.id, row.status]))).toEqual({
      [stale.job.id]: "failed", [recent.job.id]: "processing",
    });
  });
});

describe.sequential("POST /api/cloud/:kind", () => {
  it("sends creative upscale's creativity and resolution, charges by resolution, and saves the result", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 100);
    const response = await post(sub, "/api/cloud/creative", cloudForm("req-creative1", { creativity: "2", resolution: "8k" }));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ charged: 15, balance: 85, saved: true });
    expect(String(body.outputUrl)).toMatch(/^\/media\/history\/[0-9a-f-]{36}\/result\?exp=\d+&sig=/);
    expect(String(body.downloadUrl)).toMatch(/&download=1$/);

    const call = stubs.auralensCalls[0]!;
    expect(call.path).toBe("/creative-upscale");
    expect(call.auth).toBe("Bearer test-tool-key-that-is-long-enough-000000");
    expect(call.fields).toMatchObject({ creativity: "2", target_resolution: "8k", advanced: "false", output_format: "jpeg" });
    expect(call.files).toEqual(["image"]);
    expect((await objectsFor(account.id)).sort()).toEqual([
      `users/${account.id}/${body.jobId}/original`, `users/${account.id}/${body.jobId}/result`,
    ]);
  });

  it("routes each restore mode the way the app does, at its price", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 200);
    const cases = [
      { mode: "restore", path: "/edit-flux-2-dev", charged: 15 },
      { mode: "colorization", path: "/edit-flux-2-dev", charged: 15 },
      { mode: "colorization_pro", path: "/edit-flux-2-pro", charged: 35 },
      { mode: "advanced_restoration", path: "/restore-image", charged: 20 },
    ];
    for (const [index, expected] of cases.entries()) {
      const response = await post(sub, "/api/cloud/restore", cloudForm(`req-mode-${index}-abc`, { mode: expected.mode }));
      expect(response.status, expected.mode).toBe(200);
      expect(await response.json(), expected.mode).toMatchObject({ charged: expected.charged });
      const call = stubs.auralensCalls[index]!;
      expect(call.path, expected.mode).toBe(expected.path);
      if (expected.mode === "advanced_restoration") {
        expect(call.files).toEqual(["image"]);
        expect(call.fields.prompt).toBeUndefined();
      } else {
        expect(call.files).toEqual(["image1"]);
        expect(call.fields).toMatchObject({ increase_resolution: "false", aspect_ratio: "match_input_image" });
        expect(call.fields.prompt?.length).toBeGreaterThan(20);
        expect(call.fields.user_prompt).toBeUndefined();
      }
    }
  });

  it("adds 10 credits for increased resolution and forwards the user's prompt", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    const response = await post(sub, "/api/cloud/restore",
      cloudForm("req-hires-001", { mode: "colorization", increaseResolution: "true", prompt: "blue eyes, red dress" }));
    expect(await response.json()).toMatchObject({ charged: 25, balance: 75 });
    expect(stubs.auralensCalls[0]!.fields).toMatchObject({
      increase_resolution: "true", user_prompt: "blue eyes, red dress", improve_user_prompt: "true",
    });
  });

  it("refuses invalid options before charging anything", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 100);
    const cases: [string, Record<string, string>, string][] = [
      ["/api/cloud/creative", { creativity: "3" }, "invalid_creativity"],
      ["/api/cloud/creative", { resolution: "16k" }, "invalid_resolution"],
      ["/api/cloud/restore", { mode: "advanced_restoration", increaseResolution: "true" }, "increase_resolution_unavailable"],
      ["/api/cloud/restore", { prompt: "x".repeat(501) }, "prompt_too_long"],
      ["/api/cloud/restore", { mode: "bogus" }, "invalid_mode"],
    ];
    for (const [index, [path, fields, error]] of cases.entries()) {
      const response = await post(sub, path, cloudForm(`req-invalid-${index}`, fields));
      expect(response.status, error).toBe(400);
      expect(await response.json(), error).toEqual({ error });
    }
    expect((await post(sub, "/api/cloud/upscale_standard", cloudForm("req-oldpath1"))).status).toBe(404);
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(100);
    expect(stubs.auralensCalls).toHaveLength(0);
  });

  it("does not charge twice for a retried upload with the same request id", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    const send = () => post(sub, "/api/cloud/restore", cloudForm("req-retry001"));
    expect(await (await send()).json()).toMatchObject({ balance: 85, charged: 15, saved: true });
    expect(await (await send()).json()).toMatchObject({ balance: 85, charged: 0, replayed: true, saved: true });
    expect(stubs.auralensCalls).toHaveLength(1);
  });

  it("refunds the credits when processing fails, and keeps nothing", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 30);
    stubs.setAuralensResponder(() => new Response(JSON.stringify({ detail: "provider down" }), { status: 500 }));
    const response = await post(sub, "/api/cloud/restore", cloudForm("req-failure1"));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "processing_failed", refunded: true, balance: 30 });
    expect(await objectsFor(account.id)).toEqual([]);
  });

  it("still delivers a paid result when copying it into history fails", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 30);
    stubs.setResultResponder(() => new Response("gone", { status: 404 }));
    const response = await post(sub, "/api/cloud/restore", cloudForm("req-nosave01"));
    expect(response.status).toBe(200);
    // Charged, not refunded: the work was done, and the provider link still works.
    expect(await response.json()).toMatchObject({ saved: false, charged: 15, balance: 15, outputUrl: RESULT_URL, originalUrl: null });
    expect(await objectsFor(account.id)).toEqual([]);
  });

  it("answers 402 with the shortfall and never calls auralens", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 4);
    const response = await post(sub, "/api/cloud/creative", cloudForm("req-poor0001"));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "insufficient_credits", balance: 4, required: 5 });
    expect(stubs.auralensCalls).toHaveLength(0);
  });

  it("limits how many jobs one account can have running at once", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 200);
    for (const index of [1, 2, 3]) {
      await startCloudJob(env.ACCOUNTS_DB, jobInput(account.id, `req-running-${index}`, 15));
    }
    const response = await post(sub, "/api/cloud/restore", cloudForm("req-toomany1"));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "too_many_active_jobs" });
    expect(stubs.auralensCalls).toHaveLength(0);
  });

  it("validates the upload before charging anything", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 100);
    const cases: [FormData, number][] = [
      [cloudForm("req-badtype1", {}, { type: "application/pdf" }), 415],
      [cloudForm("bad id!"), 400],
      [cloudForm("req-noimage1", {}, { omit: true }), 400],
    ];
    for (const [form, status] of cases) {
      expect((await post(sub, "/api/cloud/restore", form)).status).toBe(status);
    }
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(100);
    expect(stubs.auralensCalls).toHaveLength(0);
  });

  it("requires a token", async () => {
    expect((await fetchWorker("/api/cloud/restore", { method: "POST", body: cloudForm("req-noauth01") })).status).toBe(401);
  });
});
