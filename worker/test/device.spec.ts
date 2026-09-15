import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listActivity } from "../src/accounts";
import { fetchWorker, fundedAccount, installStubs, type Stubs } from "./helpers";

let stubs: Stubs;
beforeEach(async () => { stubs = await installStubs(); });
afterEach(() => stubs.restore());

async function claim(sub: string, requestId: string) {
  const response = await fetchWorker("/api/device-upscales", {
    method: "POST",
    headers: { Authorization: `Bearer ${await stubs.idToken(sub)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function allowance(sub: string) {
  const response = await fetchWorker("/api/device-upscales", { headers: { Authorization: `Bearer ${await stubs.idToken(sub)}` } });
  return await response.json() as Record<string, unknown>;
}

describe.sequential("on-device upscale allowance", () => {
  it("gives ten free upscales, then charges one credit each, then asks for credits", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 2);
    expect(await allowance(sub)).toMatchObject({ freeLimit: 10, freeUsed: 0, freeRemaining: 10, credits: 1, balance: 2 });

    for (let index = 0; index < 10; index++) {
      const result = await claim(sub, `req-free-${String(index).padStart(3, "0")}`);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ kind: "free", freeRemaining: 9 - index, balance: 2 });
    }
    expect((await claim(sub, "req-paid-001")).body).toMatchObject({ kind: "paid", freeRemaining: 0, balance: 1 });
    expect((await claim(sub, "req-paid-002")).body).toMatchObject({ kind: "paid", balance: 0 });

    const refused = await claim(sub, "req-paid-003");
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({ error: "insufficient_credits", required: 1, balance: 0, freeRemaining: 0 });
    expect(refused.body.kind).toBeUndefined();

    const spends = (await listActivity(env.ACCOUNTS_DB, account.id)).filter(entry => entry.reason === "spend");
    expect(spends.map(entry => [entry.delta, entry.detail])).toEqual([[-1, "device:upscale"], [-1, "device:upscale"]]);
    const rows = await env.ACCOUNTS_DB.prepare("SELECT COUNT(*) AS n FROM device_upscales WHERE account_id = ?").bind(account.id).first<{ n: number }>();
    expect(rows?.n).toBe(12);
  });

  it("counts a retried confirmation once", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 0);
    expect((await claim(sub, "req-retry-001")).body).toMatchObject({ kind: "free", freeRemaining: 9 });
    expect((await claim(sub, "req-retry-001")).body).toMatchObject({ kind: "duplicate", freeRemaining: 9 });
  });

  it("refuses an invalid request id and requires a token", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 0);
    expect((await claim(sub, "bad id!")).status).toBe(400);
    expect((await fetchWorker("/api/device-upscales")).status).toBe(401);
    expect((await fetchWorker("/api/device-upscales", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("advertises the on-device price and allowance with the pack list", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 0);
    const response = await fetchWorker("/api/billing/packs", { headers: { Authorization: `Bearer ${await stubs.idToken(sub)}` } });
    expect(await response.json()).toMatchObject({ device: { credits: 1, freeLimit: 10 }, prices: { device: 1 } });
  });
});
