import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { creditBalance, jobForAccount } from "../src/accounts";
import { RESULT_URL, fetchWorker, fundedAccount, installStubs, type Stubs } from "./helpers";

let stubs: Stubs;
beforeEach(async () => { stubs = await installStubs(); });
afterEach(() => stubs.restore());

/** A creative upscale sent as tiles, the way the browser sends a big photo. */
function tiledForm(requestId: string, tiles: number, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (let index = 0; index < tiles; index++) {
    form.append(`tile${index}`, new File([new Uint8Array(64).fill(index + 1)], `tile-${index}.jpg`, { type: "image/jpeg" }));
  }
  form.append("tileCount", String(tiles));
  form.append("requestId", requestId);
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return form;
}

const auth = async (sub: string) => ({ Authorization: `Bearer ${await stubs.idToken(sub)}` });
const post = async (sub: string, path: string, body: BodyInit) =>
  fetchWorker(path, { method: "POST", headers: await auth(sub), body });
const postJson = async (sub: string, path: string, body: unknown) =>
  fetchWorker(path, {
    method: "POST",
    headers: { ...(await auth(sub)), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe.sequential("tiled creative upscale", () => {
  it("runs one provider call per tile, charges once, and hands back signed tiles", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 100);
    const response = await post(sub, "/api/cloud/creative", tiledForm("req-tiled-001", 4, { resolution: "8k", creativity: "1" }));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;

    expect(body).toMatchObject({ charged: 10, balance: 90, tileCount: 4, saved: false });
    expect(stubs.auralensCalls).toHaveLength(4);
    expect(stubs.auralensCalls.every(call => call.path === "/creative-upscale")).toBe(true);
    // Four 8K tiles would be enormous, so each tile is asked for at 4K, as in the app.
    expect(stubs.auralensCalls.map(call => call.fields.target_resolution)).toEqual(["4k", "4k", "4k", "4k"]);
    expect(body.tiles.map((tile: any) => tile.index)).toEqual([0, 1, 2, 3]);
    expect(body.tiles.every((tile: any) => typeof tile.sig === "string" && tile.url === RESULT_URL)).toBe(true);
    // Paid for and finished, so an abandoned browser cannot have it refunded later.
    expect((await jobForAccount(env.ACCOUNTS_DB, account.id, body.jobId))?.status).toBe("succeeded");
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(90);
  });

  it("keeps 8K per tile when a photo only needs two", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    await post(sub, "/api/cloud/creative", tiledForm("req-tiled-002", 2, { resolution: "8k" }));
    expect(stubs.auralensCalls.map(call => call.fields.target_resolution)).toEqual(["8k", "8k"]);
  });

  it("refuses more tiles than the grid allows, and tiling for restore", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    const tooMany = await post(sub, "/api/cloud/creative", tiledForm("req-tiled-003", 5));
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ error: "invalid_tile_count", maxTiles: 4 });
    const restore = await post(sub, "/api/cloud/restore", tiledForm("req-tiled-004", 2));
    expect(restore.status).toBe(400);
    expect(await restore.json()).toMatchObject({ error: "tiling_unsupported" });
    expect(stubs.auralensCalls).toHaveLength(0);
    expect(await creditBalance(env.ACCOUNTS_DB, (await fundedAccount(sub, 0)).id)).toBe(100);
  });

  it("refunds the whole photo when one tile fails", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 30);
    let calls = 0;
    stubs.setAuralensResponder(() => {
      calls += 1;
      return calls === 2 ? new Response(JSON.stringify({ detail: "tile down" }), { status: 500 }) : Response.json({ output_url: RESULT_URL });
    });
    const response = await post(sub, "/api/cloud/creative", tiledForm("req-tiled-005", 4));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "processing_failed", refunded: true, balance: 30 });
    expect(await creditBalance(env.ACCOUNTS_DB, account.id)).toBe(30);
  });

  it("fetches a tile only with the worker's own signature, for that job", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const other = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    await fundedAccount(other, 100);
    const body = await (await post(sub, "/api/cloud/creative", tiledForm("req-tiled-006", 2))).json() as Record<string, any>;
    const tile = body.tiles[0];

    const ok = await postJson(sub, "/api/cloud/tile", { jobId: body.jobId, index: 0, url: tile.url, sig: tile.sig });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(0);

    // A different URL under the same signature, which is how an open proxy would start.
    const forged = await postJson(sub, "/api/cloud/tile", {
      jobId: body.jobId, index: 0, url: "https://evil.example/secret", sig: tile.sig,
    });
    expect(forged.status).toBe(403);
    // Someone else's job, with its real signature.
    const stolen = await postJson(other, "/api/cloud/tile", { jobId: body.jobId, index: 0, url: tile.url, sig: tile.sig });
    expect(stolen.status).toBe(404);
  });

  it("keeps the stitched photo, and shows it in history", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const account = await fundedAccount(sub, 100);
    const body = await (await post(sub, "/api/cloud/creative", tiledForm("req-tiled-007", 2))).json() as Record<string, any>;

    const form = new FormData();
    form.append("jobId", body.jobId);
    form.append("result", new File([new Uint8Array(4096).fill(9)], "result.jpg", { type: "image/jpeg" }));
    form.append("original", new File([new Uint8Array(512).fill(4)], "original.jpg", { type: "image/jpeg" }));
    const saved = await (await post(sub, "/api/cloud/result", form)).json() as Record<string, any>;
    expect(saved.saved).toBe(true);
    expect(String(saved.resultUrl)).toMatch(/^\/media\/history\/[0-9a-f-]{36}\/result\?exp=\d+&sig=/);

    const keys = (await env.USER_MEDIA.list({ prefix: `users/${account.id}/${body.jobId}` })).objects.map(object => object.key);
    expect(keys.sort()).toEqual([`users/${account.id}/${body.jobId}/original`, `users/${account.id}/${body.jobId}/result`]);

    const history = await (await fetchWorker("/api/history", { headers: await auth(sub) })).json() as Record<string, any>;
    expect(history.items[0]).toMatchObject({ id: body.jobId, operation: "creative", credits: 10 });
    expect(history.usedBytes).toBe(4096 + 512);

    // A retried upload keeps what is already stored rather than a second copy.
    const again = await (await post(sub, "/api/cloud/result", form)).json() as Record<string, any>;
    expect(again).toMatchObject({ saved: true, replayed: true });
    expect((await env.USER_MEDIA.list({ prefix: `users/${account.id}/${body.jobId}` })).objects).toHaveLength(2);
  });

  it("refuses a result for someone else's job", async () => {
    const sub = `sub-${crypto.randomUUID()}`;
    const other = `sub-${crypto.randomUUID()}`;
    await fundedAccount(sub, 100);
    await fundedAccount(other, 100);
    const body = await (await post(sub, "/api/cloud/creative", tiledForm("req-tiled-008", 2))).json() as Record<string, any>;
    const form = new FormData();
    form.append("jobId", body.jobId);
    form.append("result", new File([new Uint8Array(64).fill(1)], "result.jpg", { type: "image/jpeg" }));
    expect((await post(other, "/api/cloud/result", form)).status).toBe(404);
  });
});
