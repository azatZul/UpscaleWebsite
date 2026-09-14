import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signMediaUrl } from "../src/media-signing";
import { RESULT_BYTES, cloudForm, fetchWorker, fundedAccount, installStubs, type Stubs } from "./helpers";

let stubs: Stubs;
beforeEach(async () => { stubs = await installStubs(); });
afterEach(() => stubs.restore());

const auth = async (sub: string) => ({ Authorization: `Bearer ${await stubs.idToken(sub)}` });

async function process(sub: string, requestId: string, fields: Record<string, string> = {}) {
  const response = await fetchWorker("/api/cloud/restore", { method: "POST", headers: await auth(sub), body: cloudForm(requestId, fields) });
  if (response.status !== 200) throw new Error(`processing failed: ${response.status}`);
  return await response.json() as { jobId: string; outputUrl: string; originalUrl: string; downloadUrl: string };
}

async function history(sub: string) {
  const response = await fetchWorker("/api/history", { headers: await auth(sub) });
  return { status: response.status, body: await response.json() as { items: Array<Record<string, any>>; usedBytes: number; maxBytes: number } };
}

describe.sequential("history", () => {
  it("lists saved results newest first, with links that load the images", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    const first = await process(sub, "req-hist-0001");
    const second = await process(sub, "req-hist-0002", { mode: "colorization", prompt: "green coat" });

    const { status, body } = await history(sub);
    expect(status).toBe(200);
    expect(body.items.map(item => item.id)).toEqual([second.jobId, first.jobId]);
    expect(body.items[0]).toMatchObject({ operation: "restore", credits: 15, options: { mode: "colorization", prompt: "green coat" } });
    expect(body.usedBytes).toBe(2 * (64 + RESULT_BYTES));

    const result = await fetchWorker(body.items[0]!.resultUrl);
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("image/jpeg");
    expect(result.headers.get("Cache-Control")).toMatch(/^private, max-age=\d+$/);
    expect((await result.arrayBuffer()).byteLength).toBe(RESULT_BYTES);

    const original = await fetchWorker(body.items[0]!.originalUrl);
    expect((await original.arrayBuffer()).byteLength).toBe(64);

    const download = await fetchWorker(body.items[0]!.downloadUrl);
    expect(download.headers.get("Content-Disposition")).toMatch(/^attachment; filename="uscale-result-[0-9a-f]{8}\.jpg"$/);
  });

  it("serves byte ranges from a signed link", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    const job = await process(sub, "req-range-001");
    const response = await fetchWorker(job.outputUrl, { headers: { Range: "bytes=0-9" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 0-9/${RESULT_BYTES}`);
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it("refuses tampered, expired and borrowed signatures", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    const job = await process(sub, "req-sig-00001");
    const url = new URL(job.outputUrl, "https://upscales.app");

    const tampered = new URL(url);
    const sig = tampered.searchParams.get("sig")!;
    tampered.searchParams.set("sig", (sig[0] === "A" ? "B" : "A") + sig.slice(1));
    expect((await fetchWorker(tampered.pathname + tampered.search)).status).toBe(403);

    const expired = await signMediaUrl(env.MEDIA_SIGNING_KEY!, job.jobId, "result", Date.now() - 3 * 3600_000);
    expect((await fetchWorker(expired)).status).toBe(403);

    // The result's signature does not open the original.
    expect((await fetchWorker(url.pathname.replace("/result", "/original") + url.search)).status).toBe(403);
    expect((await fetchWorker(url.pathname)).status).toBe(403);
  });

  it("deletes a result from the list and from storage, and its links stop working", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 100);
    const job = await process(sub, "req-delete-01");

    const response = await fetchWorker(`/api/history/${job.jobId}`, { method: "DELETE", headers: await auth(sub) });
    expect(response.status).toBe(200);
    expect((await history(sub)).body.items).toEqual([]);
    expect((await env.USER_MEDIA.list({ prefix: `users/${account.id}/` })).objects).toEqual([]);
    expect((await fetchWorker(job.outputUrl)).status).toBe(404);
    expect((await fetchWorker(`/api/history/${job.jobId}`, { method: "DELETE", headers: await auth(sub) })).status).toBe(404);
  });

  it("keeps one account's history out of another's reach", async () => {
    const owner = `sub-${crypto.randomUUID()}`;
    const other = `sub-${crypto.randomUUID()}`;
    await fundedAccount(owner, 100);
    await fundedAccount(other, 0);
    const job = await process(owner, "req-owner-001");

    expect((await history(other)).body.items).toEqual([]);
    const response = await fetchWorker(`/api/history/${job.jobId}`, { method: "DELETE", headers: await auth(other) });
    expect(response.status).toBe(404);
    expect((await history(owner)).body.items.map(item => item.id)).toEqual([job.jobId]);
  });

  it("requires a token to list or delete", async () => {
    expect((await fetchWorker("/api/history")).status).toBe(401);
    expect((await fetchWorker(`/api/history/${crypto.randomUUID()}`, { method: "DELETE" })).status).toBe(401);
  });
});
