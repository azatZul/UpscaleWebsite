import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { escapeHtml, parseRange } from "../src/index";

const FEATURED = "01JZZZZZZZZZZZZZZZZZZZZZZZ";
const PRIVATE = "02JZZZZZZZZZZZZZZZZZZZZZZZ";
const DELETED = "03JZZZZZZZZZZZZZZZZZZZZZZZ";
const PHOTO = "04JZZZZZZZZZZZZZZZZZZZZZZZ";

async function insertAlbum(id: string, state: "locked" | "unlocked" | "deleted", featured: boolean): Promise<void> {
  const coverKey = `albums/${id}/cover.jpg`;
  const galleryKey = `albums/${id}/gallery-v1.jpg`;
  const beforeKey = `albums/${id}/${PHOTO}/before.webp`;
  const afterKey = `albums/${id}/${PHOTO}/after-wm.webp`;
  const cleanKey = `albums/${id}/${PHOTO}/clean.jpg`;
  const zipKey = `albums/${id}/all.zip`;
  const uploads = [
    env.MEDIA.put(coverKey, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/jpeg" } }),
    env.MEDIA.put(beforeKey, new Uint8Array([10, 11, 12]), { httpMetadata: { contentType: "image/webp" } }),
    env.MEDIA.put(afterKey, new Uint8Array([20, 21, 22]), { httpMetadata: { contentType: "image/webp" } }),
    env.MEDIA.put(cleanKey, new Uint8Array([30, 31, 32, 33]), { httpMetadata: { contentType: "image/jpeg" } }),
    env.MEDIA.put(zipKey, new Uint8Array([40, 41, 42, 43, 44]), { httpMetadata: { contentType: "application/zip" } }),
    env.MEDIA.put(galleryKey, new Uint8Array([50, 51, 52]), { httpMetadata: { contentType: "image/jpeg" } }),
  ];
  await Promise.all(uploads);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO albums (
        id, title, note, state, featured, price_cents, currency, photo_count,
        cover_photo_id, cover_key, cover_mime, cover_width, cover_height,
        cover_bytes, gallery_key, gallery_mime, gallery_width, gallery_height,
        gallery_bytes, zip_key, zip_bytes, source_url, created_at, deleted_at
      ) VALUES (?1, ?2, NULL, ?3, ?4, 300, 'USD', 1, ?5, ?6, 'image/jpeg', 1200, 630, 3,
                ?7, ?8, ?9, ?10, ?11, ?12, 5, NULL, ?13, ?14)`,
    ).bind(
      id, `<Album ${id.slice(0, 2)}>`, state, featured ? 1 : 0, PHOTO, coverKey,
      galleryKey, "image/jpeg", 1280, 960, 3,
      zipKey, Date.now(), state === "deleted" ? Date.now() : null,
    ),
    env.DB.prepare(
      `INSERT INTO photos (
        album_id, id, position, before_key, before_width, before_height, before_bytes, before_sha256,
        after_key, after_width, after_height, after_bytes, after_sha256,
        clean_key, clean_width, clean_height, clean_bytes, clean_mime, clean_sha256, alt
      ) VALUES (?1, ?2, 0, ?3, 800, 600, 3, 'before', ?4, 800, 600, 3, 'after', ?5, 1600, 1200, 4, 'image/jpeg', 'clean', ?6)`,
    ).bind(id, PHOTO, beforeKey, afterKey, cleanKey, `Portrait <${id.slice(0, 2)}>`),
  ]);
}

async function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`https://upscales.app${path}`, init));
}

describe.sequential("album worker", () => {
  it("preserves static canonical URLs and directory indexes", async () => {
    for (const path of ["/", "/de/", "/guides/", "/de/guides/", "/compare.html", "/de/compare.html"]) {
      const response = await fetchWorker(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("Location"), path).toBeNull();
      expect(await response.text(), path).toContain('<html');
    }
  });
  it("parses only valid single byte ranges", () => {
    expect(parseRange("bytes=2-4", 10)).toEqual({ offset: 2, length: 3, end: 4 });
    expect(parseRange("bytes=-3", 10)).toEqual({ offset: 7, length: 3, end: 9 });
    expect(parseRange("bytes=12-", 10)).toBeNull();
    expect(parseRange("bytes=1-2,5-6", 10)).toBeNull();
    expect(escapeHtml(`<script>'&\"`)).toBe("&lt;script&gt;&#39;&amp;&quot;");
  });

  it("serves a featured gallery but does not leak unfeatured albums", async () => {
    await insertAlbum(FEATURED, "locked", true);
    await insertAlbum(PRIVATE, "unlocked", false);
    await env.DB.prepare("UPDATE albums SET price_cents=0 WHERE id=?1").bind(FEATURED).run();
    const response = await fetchWorker("/gallery");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=60");
    expect(html).toContain(`/gallery/${FEATURED}`);
    expect(html).not.toContain(`/gallery/${PRIVATE}`);
    expect(html).toContain("&lt;Album 01&gt;");
    expect(html).not.toContain("<Album 01>");
    expect(html).toContain("Watermarked preview");
    expect(html).toContain('class="gallery-preview"');
    expect(html).toContain(`/media/${FEATURED}/gallery.jpg`);
    expect(html).not.toContain(`/media/${FEATURED}/${PHOTO}/before.webp`);
  });

  it("streams the prepared gallery JPEG through the private R2 binding", async () => {
    const response = await fetchWorker(`/media/${FEATURED}/gallery.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([50, 51, 52]);
  });

  it("renders the album heading, ordered compare markup and noindex", async () => {
    const response = await fetchWorker(`/gallery/${FEATURED}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(html).toContain('property="og:image"');
    expect(html).toContain('class="cmp-wrap"');
    expect(html).toContain('data-album-carousel');
    expect(html).toContain('data-album-expand');
    expect(html).toContain('data-album-stage');
    expect(html).toContain('<h1>These photos were restored and enhanced with UScale.</h1>');
    expect(html).not.toContain('class="album-meta"');
    expect(html).not.toContain('class="lead">These photos were restored');
    // A one-photo album carries no carousel controls.
    expect(html).not.toContain('data-album-counter');
    expect(html).toContain("Portrait &lt;01&gt;");
    expect(html).not.toContain("Download full resolution");
  });

  it("renders a zero-price locked album as a watermarked preview", async () => {
    const albumPage = await (await fetchWorker(`/gallery/${FEATURED}`)).text();
    expect(albumPage).toContain("This album shows watermarked previews.");
    expect(albumPage).not.toContain("$0.00");
  });

  it("gates clean downloads and supports ranges after unlock", async () => {
    expect((await fetchWorker(`/download/${FEATURED}/${PHOTO}`)).status).toBe(403);
    await env.DB.prepare("UPDATE albums SET state = 'unlocked', unlocked_at = ?2 WHERE id = ?1 AND state = 'locked'").bind(FEATURED, Date.now()).run();
    const albumPage = await (await fetchWorker(`/gallery/${FEATURED}`)).text();
    expect(albumPage).not.toContain("Full resolution unlocked");
    const response = await fetchWorker(`/download/${FEATURED}/${PHOTO}`, { headers: { Range: "bytes=1-2" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 1-2/4");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([31, 32]);
    expect((await fetchWorker(`/download/${FEATURED}/${PHOTO}`, { headers: { Range: "bytes=9-" } })).status).toBe(416);
  });

  it("checks the tombstone before returning cached media", async () => {
    const mediaPath = `/media/${PRIVATE}/${PHOTO}/after.webp`;
    const galleryPath = `/media/${PRIVATE}/gallery.jpg`;
    expect((await fetchWorker(mediaPath)).status).toBe(200);
    expect((await fetchWorker(galleryPath)).status).toBe(200);
    await env.DB.prepare("UPDATE albums SET state = 'deleted', deleted_at = ?2 WHERE id = ?1").bind(PRIVATE, Date.now()).run();
    expect((await fetchWorker(mediaPath)).status).toBe(410);
    expect((await fetchWorker(galleryPath)).status).toBe(410);
    expect((await fetchWorker(`/gallery/${PRIVATE}`)).status).toBe(410);
  });

  it("returns 410 for deleted albums and hides private shell and APIs", async () => {
    await insertAlbum(DELETED, "deleted", false);
    expect((await fetchWorker(`/gallery/${DELETED}`)).status).toBe(410);
    expect((await fetchWorker("/_shell/album.html")).status).toBe(404);
    // /api/ accepts POST now (sign-in, and Stripe webhooks later), so an
    // unauthenticated write is 401 rather than the old blanket 405. Auth is
    // checked before routing on purpose: an unknown /api path answers 401 too,
    // so callers without a token cannot enumerate which endpoints exist.
    const unauthenticated = await fetchWorker("/api/admin", { method: "POST" });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.text()).toBe(JSON.stringify({ error: "unauthorized" }));
    // Non-/api dynamic paths keep rejecting writes outright.
    expect((await fetchWorker("/gallery", { method: "POST" })).status).toBe(405);
  });

  it("renders twenty comparisons in position order with lazy loading and no hero-follow", async () => {
    const id = "05JZZZZZZZZZZZZZZZZZZZZZZZ";
    await insertAlbum(id, "unlocked", false);
    const statements = [];
    for (let position = 19; position > 0; position--) {
      statements.push(env.DB.prepare(`INSERT INTO photos
        SELECT album_id, ?2, ?3, before_key, before_width, before_height, before_bytes, before_sha256,
               after_key, after_width, after_height, after_bytes, after_sha256,
               clean_key, clean_width, clean_height, clean_bytes, clean_mime, clean_sha256, ?4
        FROM photos WHERE album_id=?1 AND position=0`)
        .bind(id, String(position).padStart(26, "0"), position, `Photo number ${position}`));
    }
    statements.push(env.DB.prepare("UPDATE albums SET photo_count=20 WHERE id=?1").bind(id));
    await env.DB.batch(statements);
    const response = await fetchWorker(`/gallery/${id}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html.match(/class="cmp-wrap"/g)).toHaveLength(20);
    expect(html.match(/data-album-slide/g)).toHaveLength(20);
    expect(html.match(/data-album-dot=/g)).toHaveLength(20);
    expect(html.match(/<img[^>]+src="\/media\/[^>]+loading="lazy"/g)).toHaveLength(38);
    expect(html).not.toContain("data-follow");
    let previous = -1;
    for (let position = 1; position < 20; position++) {
      const offset = html.indexOf(`<h2>Photo number ${position}</h2>`);
      expect(offset).toBeGreaterThan(previous);
      previous = offset;
    }
  });
});
