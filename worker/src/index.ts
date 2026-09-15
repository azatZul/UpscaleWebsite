import { bearerToken, verifyIdToken, type VerifiedIdentity } from "./auth";
import {
  claimDeviceUpscale, completeCloudJob, countActiveJobs, creditBalance, deleteHistoryItem, deviceAllowance, failCloudJob,
  getHistoryItem,
  getOrCreateAccount, historyBytes, listActivity, listHistory, recordPurchase, refundStaleJobs, setStripeCustomerId,
  startCloudJob,
  type Account, type StoredObject,
} from "./accounts";
import { AuralensError, runCloudRequest } from "./auralens";
import { signMediaUrl, verifyMediaSignature, type MediaVariant } from "./media-signing";
import {
  CREDIT_PACKS, CREDIT_PRICES, FREE_DEVICE_UPSCALES, MAX_PURCHASE_CENTS, MIN_PURCHASE_CENTS, creditsFor, packById,
  parseCloudRequest,
  priceKey, quoteCredits, type CloudKind,
} from "./pricing";
import { StripeError, createCheckoutSession, createCustomer, verifyWebhook } from "./stripe";

const ALBUM_ID = "[0-9A-HJKMNP-TV-Z]{26}";
const ALBUM_PATH = new RegExp(`^/gallery/(${ALBUM_ID})$`);
const COVER_PATH = new RegExp(`^/media/(${ALBUM_ID})/cover\\.jpg$`);
const GALLERY_MEDIA_PATH = new RegExp(`^/media/(${ALBUM_ID})/gallery\\.jpg$`);
const MEDIA_PATH = new RegExp(`^/media/(${ALBUM_ID})/(${ALBUM_ID})/(before|after)\\.webp$`);
const DOWNLOAD_PATH = new RegExp(`^/download/(${ALBUM_ID})/(${ALBUM_ID})$`);
const ZIP_PATH = new RegExp(`^/download/(${ALBUM_ID})/all\\.zip$`);
const SUPPORT_EMAIL = "alexandr.graschenkov91@gmail.com";

const ICON_PREVIOUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.25 5.5 8.75 12 15.25 18.5"/></svg>`;
const ICON_NEXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.75 5.5 15.25 12 8.75 18.5"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const ICON_GALLERY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m3 15 4.5-4.5 4 4L15 11l6 5.5"/><circle cx="9" cy="9" r="1.4"/></svg>`;
const ICON_EXPAND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
const ICON_FLAG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V4m0 0h11l-1.5 4L15 12H4"/></svg>`;
const ICON_CALENDAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`;
const ICON_ARCHIVE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h18M4 7v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7M3 7l1.6-3.2A1 1 0 0 1 5.5 3h13a1 1 0 0 1 .9.8L21 7M10 12h4"/></svg>`;

type AlbumState = "locked" | "unlocked" | "deleted";

type AlbumRow = {
  id: string;
  title: string;
  note: string | null;
  state: AlbumState;
  photo_count: number;
  cover_mime: string;
  cover_width: number;
  cover_height: number;
  zip_key: string | null;
  created_at: number;
};

type GalleryRow = {
  id: string;
  title: string;
  state: AlbumState;
  price_cents: number;
  currency: string;
  photo_count: number;
  gallery_key: string;
  gallery_width: number | null;
  gallery_height: number | null;
  created_at: number;
};

type PhotoRow = {
  id: string;
  position: number;
  before_key: string;
  before_width: number;
  before_height: number;
  after_key: string;
  after_width: number;
  after_height: number;
  clean_key: string;
  clean_bytes: number;
  clean_mime: string;
  alt: string;
};

type MediaRow = {
  state: AlbumState;
  object_key: string;
  content_type: string;
};

type DownloadRow = {
  state: AlbumState;
  object_key: string | null;
  content_type: string;
  object_bytes: number | null;
};

type ByteRange = { offset: number; length: number; end: number };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function commonHeaders(): Headers {
  return new Headers({
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
}

function plain(message: string, status: number, extra?: HeadersInit): Response {
  const headers = commonHeaders();
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  if (extra) {
    for (const [key, value] of new Headers(extra)) headers.set(key, value);
  }
  return new Response(message, { status, headers });
}

function countMarker(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

async function renderShell(
  request: Request,
  env: Env,
  head: string,
  body: string,
  cacheControl: string,
  robots?: string,
): Promise<Response> {
  const shellUrl = new URL("/_shell/album.html", request.url);
  const shellResponse = await env.ASSETS.fetch(shellUrl);
  if (!shellResponse.ok) {
    console.error(JSON.stringify({ event: "album_shell_missing", status: shellResponse.status }));
    return plain("Page template is temporarily unavailable", 503, { "Retry-After": "60" });
  }
  const shell = await shellResponse.text();
  if (countMarker(shell, "<!--HEAD-->") !== 1 || countMarker(shell, "<!--BODY-->") !== 1) {
    console.error(JSON.stringify({ event: "album_shell_invalid" }));
    return plain("Page template is temporarily unavailable", 503, { "Retry-After": "60" });
  }
  const headers = commonHeaders();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", cacheControl);
  if (robots) headers.set("X-Robots-Tag", robots);
  return new Response(shell.replace("<!--HEAD-->", head).replace("<!--BODY-->", body), { headers });
}

function pageHead(input: {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageMime?: string;
}): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const canonical = escapeHtml(input.canonical);
  const image = input.image ? escapeHtml(input.image) : undefined;
  const socialImage = image
    ? `\n  <meta property="og:image" content="${image}">\n  <meta property="og:image:secure_url" content="${image}">\n  <meta property="og:image:type" content="${escapeHtml(input.imageMime ?? "image/jpeg")}">\n  <meta property="og:image:width" content="${input.imageWidth ?? 1200}">\n  <meta property="og:image:height" content="${input.imageHeight ?? 630}">\n  <meta property="og:image:alt" content="${escapeHtml(input.imageAlt ?? input.title)}">\n  <meta name="twitter:image" content="${image}">`
    : "";
  return `<title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <meta name="robots" content="${escapeHtml(input.robots)}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${canonical}">${socialImage}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">`;
}

/* Albums are dated by the day they were published, in UTC so every reader sees one date. */
function albumDate(createdAt: number): { label: string; iso: string } | null {
  const date = new Date(createdAt * 1000);
  if (!Number.isFinite(date.getTime()) || createdAt <= 0) return null;
  return {
    label: new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date),
    iso: date.toISOString().slice(0, 10),
  };
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** One frame for the album: the median photo ratio, clamped to a sane range. */
function albumStageRatio(photos: PhotoRow[]): string {
  const ratios = photos
    .filter((photo) => photo.after_width > 0 && photo.after_height > 0)
    .map((photo) => photo.after_width / photo.after_height)
    .sort((a, b) => a - b);
  const median = ratios[Math.floor((ratios.length - 1) / 2)] ?? 4 / 3;
  return Math.min(2.2, Math.max(0.62, median)).toFixed(4);
}

async function getAlbum(env: Env, id: string): Promise<AlbumRow | null> {
  return env.DB.prepare(
    `SELECT id, title, note, state, photo_count, cover_mime, cover_width,
            cover_height, zip_key, created_at
       FROM albums WHERE id = ?1`,
  ).bind(id).first<AlbumRow>();
}

async function renderGallery(request: Request, env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, title, state, price_cents, currency, photo_count,
            gallery_key, gallery_width, gallery_height, created_at
       FROM albums
      WHERE featured = 1 AND state IN ('locked', 'unlocked') AND gallery_key IS NOT NULL
      ORDER BY created_at DESC LIMIT 100`,
  ).all<GalleryRow>();
  const cards = result.results.map((album) => {
    const status = album.state === "locked"
      ? ` · ${album.price_cents > 0 ? formatPrice(album.price_cents, album.currency) : "Watermarked preview"}`
      : "";
    const title = escapeHtml(album.title);
    const date = albumDate(album.created_at);
    const galleryVersion = encodeURIComponent(album.gallery_key.split("/").pop() ?? album.gallery_key);
    return `<a class="gallery-card" href="/gallery/${album.id}">
      <img class="gallery-preview" src="/media/${album.id}/gallery.jpg?v=${galleryVersion}" width="${album.gallery_width ?? 960}" height="${album.gallery_height ?? 720}" loading="lazy" decoding="async" alt="Before and after: ${title}">
      <span class="gallery-card-copy"><h2>${title}</h2><p class="gallery-meta"><span>${album.photo_count} ${album.photo_count === 1 ? "photo" : "photos"}${status}</span>${date ? `<time datetime="${date.iso}">${date.label}</time>` : ""}</p></span>
    </a>`;
  }).join("");
  const body = `<main class="wrap gallery-page" id="main-content" tabindex="-1">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>&rsaquo;</span><span>Gallery</span></nav>
    <header class="head center gallery-head"><span class="eyebrow">Before &amp; after</span><h1>Restoration gallery</h1><p class="lead">Real photo restorations and upscales created with UScale.</p></header>
    ${cards ? `<div class="gallery-grid">${cards}</div>` : '<div class="gallery-empty">No featured albums yet.</div>'}
  </main>`;
  const canonical = `${new URL(request.url).origin}/gallery`;
  return renderShell(request, env, pageHead({
    title: "Photo restoration gallery — UScale",
    description: "Explore real before-and-after photo restorations and AI upscales created with UScale.",
    canonical,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
  }), body, "public, max-age=0, s-maxage=60");
}

async function handleGallery(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(`${new URL(request.url).origin}/gallery`, { method: "GET" });
  if (request.method === "GET") {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
  }
  const response = await renderGallery(request, env);
  if (request.method === "GET" && response.ok) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return request.method === "HEAD" ? new Response(null, response) : response;
}

async function handleAlbum(request: Request, env: Env, albumId: string): Promise<Response> {
  const album = await getAlbum(env, albumId);
  if (!album) return plain("Album not found", 404, { "X-Robots-Tag": "noindex, nofollow" });
  if (album.state === "deleted") return plain("Album removed", 410, { "X-Robots-Tag": "noindex, nofollow" });

  const photos = await env.DB.prepare(
    `SELECT id, position, before_key, before_width, before_height, after_key,
            after_width, after_height, clean_key, clean_bytes, clean_mime, alt
       FROM photos WHERE album_id = ?1 ORDER BY position`,
  ).bind(albumId).all<PhotoRow>();
  if (photos.results.length !== album.photo_count) {
    console.error(JSON.stringify({ event: "album_photo_count_mismatch", albumId }));
    return plain("Album is temporarily unavailable", 503, { "Retry-After": "60", "X-Robots-Tag": "noindex, nofollow" });
  }

  const unlocked = album.state === "unlocked";
  const stageRatio = albumStageRatio(photos.results);
  const slides = photos.results.map((photo, index) => {
    const sized = photo.after_width > 0 && photo.after_height > 0;
    const photoRatio = (sized ? photo.after_width / photo.after_height : 4 / 3).toFixed(4);
    return `<article class="album-slide" data-album-slide style="--photo-ar:${photoRatio}"${index === 0 ? "" : " hidden"}>
      <div class="cmp-wrap" data-keep-pos="1">
        <div class="cmp" role="group" aria-label="Original and result: ${escapeHtml(photo.alt)}">
          <img class="a-img" src="/media/${album.id}/${photo.id}/after.webp" width="${photo.after_width}" height="${photo.after_height}" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" alt="${escapeHtml(photo.alt)}">
          <img class="b" src="/media/${album.id}/${photo.id}/before.webp" width="${photo.before_width}" height="${photo.before_height}" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" alt="Original scan: ${escapeHtml(photo.alt)}">
          <span class="cmp-bar" aria-label="Drag to compare"></span>
          <span class="cmp-tag l">Original</span><span class="cmp-tag r">Result</span>
        </div>
      </div>
    </article>`;
  }).join("");

  const details = photos.results.map((photo, index) => {
    const download = unlocked
      ? `<a class="btn btn-g" href="/download/${album.id}/${photo.id}">${ICON_DOWNLOAD}Download this photo</a>`
      : "";
    const all = unlocked && album.zip_key && album.photo_count > 1
      ? `<a class="btn btn-p" href="/download/${album.id}/all.zip">${ICON_ARCHIVE}Download all ${album.photo_count} photos</a>`
      : "";
    const actions = download || all ? `<div class="album-actions">${download}${all}</div>` : "";
    return `<div class="album-detail" data-album-detail${index === 0 ? "" : " hidden"}>
      <h2>${escapeHtml(photo.alt)}</h2>${actions}
    </div>`;
  }).join("");

  const pageControl = photos.results.map((_, index) =>
    `<button type="button" class="album-dot${index === 0 ? " is-active" : ""}" data-album-dot="${index}" aria-label="Show photo ${index + 1}" aria-pressed="${index === 0 ? "true" : "false"}"></button>`,
  ).join("");

  const locked = unlocked ? "" : `<div class="album-locked"><strong>This album shows watermarked previews.</strong><br>Full-resolution downloads open once the album is unlocked.</div>`;
  const date = albumDate(album.created_at);
  const removalSubject = encodeURIComponent(`Removal request for album ${album.id}`);
  const removalBody = encodeURIComponent(`Please remove https://upscales.app/gallery/${album.id}`);
  const body = `<main class="wrap album-page" id="main-content" tabindex="-1">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>&rsaquo;</span><a href="/gallery">Gallery</a><span>&rsaquo;</span><span>${escapeHtml(album.title)}</span></nav>
    <header class="head center album-head"><span class="eyebrow">Before &amp; after</span><h1>These photos were restored and enhanced with UScale.</h1>${locked}</header>
    <section class="album-viewer" data-album-carousel tabindex="0" aria-label="Photo album">
      <div class="album-stage" data-album-stage style="--album-ar:${stageRatio}">
        <div class="album-slides">${slides}</div>
        <button class="album-ctl album-prev" type="button" data-album-previous aria-label="Previous photo"${album.photo_count === 1 ? " disabled" : ""}>${ICON_PREVIOUS}</button>
        <button class="album-ctl album-next" type="button" data-album-next aria-label="Next photo"${album.photo_count === 1 ? " disabled" : ""}>${ICON_NEXT}</button>
        <button class="album-ctl album-zoom" type="button" data-album-expand aria-label="Expand photo">${ICON_EXPAND}</button>
        <button class="album-ctl album-close" type="button" data-album-collapse aria-label="Close expanded photo" hidden>${ICON_CLOSE}</button>
      </div>
      ${album.photo_count > 1 ? `<nav class="album-controls" aria-label="Album controls">
        <div class="album-page-control" aria-label="Choose photo">${pageControl}</div>
        <span class="album-counter" data-album-counter aria-live="polite">1 / ${album.photo_count}</span>
      </nav>` : ""}
      <div class="album-details">${details}</div>
    </section>
    <div class="album-foot">${date ? `<span class="album-date">${ICON_CALENDAR}<time datetime="${date.iso}">${date.label}</time></span>` : ""}<a class="album-more" href="/gallery">${ICON_GALLERY}See more examples in the gallery</a><a class="album-remove" href="mailto:${SUPPORT_EMAIL}?subject=${removalSubject}&body=${removalBody}">${ICON_FLAG}Request removal</a></div>
  </main>`;
  const origin = new URL(request.url).origin;
  const canonical = `${origin}/gallery/${album.id}`;
  const description = album.note || `Compare ${album.photo_count} restored ${album.photo_count === 1 ? "photo" : "photos"} from UScale.`;
  const response = await renderShell(request, env, pageHead({
    title: `${album.title} — UScale`,
    description,
    canonical,
    robots: "noindex,nofollow,noarchive",
    image: `${origin}/media/${album.id}/cover.jpg`,
    imageAlt: album.title,
    imageWidth: album.cover_width,
    imageHeight: album.cover_height,
    imageMime: album.cover_mime,
  }), body, "private, no-store", "noindex, nofollow, noarchive");
  return request.method === "HEAD" ? new Response(null, response) : response;
}

async function mediaRow(env: Env, albumId: string, photoId: string | null, variant: "before" | "after" | "cover" | "gallery"): Promise<MediaRow | null> {
  if (variant === "cover") {
    return env.DB.prepare(
      `SELECT state, cover_key AS object_key, cover_mime AS content_type
         FROM albums WHERE id = ?1`,
    ).bind(albumId).first<MediaRow>();
  }
  if (variant === "gallery") {
    return env.DB.prepare(
      `SELECT state, gallery_key AS object_key, gallery_mime AS content_type
         FROM albums WHERE id = ?1 AND gallery_key IS NOT NULL`,
    ).bind(albumId).first<MediaRow>();
  }
  const column = variant === "before" ? "p.before_key" : "p.after_key";
  return env.DB.prepare(
    `SELECT a.state, ${column} AS object_key, 'image/webp' AS content_type
       FROM albums a JOIN photos p ON p.album_id = a.id
      WHERE a.id = ?1 AND p.id = ?2`,
  ).bind(albumId, photoId).first<MediaRow>();
}

async function handleMedia(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  albumId: string,
  photoId: string | null,
  variant: "before" | "after" | "cover" | "gallery",
): Promise<Response> {
  const row = await mediaRow(env, albumId, photoId, variant);
  if (!row) return plain("Media not found", 404, { "X-Robots-Tag": "noindex, nofollow" });
  if (row.state === "deleted") return plain("Album removed", 410, { "X-Robots-Tag": "noindex, nofollow" });

  const cacheUrl = new URL(request.url);
  cacheUrl.search = "";
  cacheUrl.searchParams.set("__r2", row.object_key);
  const cacheKey = new Request(cacheUrl, { method: "GET" });
  if (request.method === "GET") {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const etag = cached.headers.get("ETag");
      if (etag && request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: cached.headers });
      return cached;
    }
  }

  if (request.method === "HEAD") {
    const object = await env.MEDIA.head(row.object_key);
    if (!object) return plain("Media not found", 404);
    const headers = mediaHeaders(row.content_type, object);
    return new Response(null, { headers });
  }
  const object = await env.MEDIA.get(row.object_key);
  if (!object) return plain("Media not found", 404);
  const headers = mediaHeaders(row.content_type, object);
  const response = new Response(object.body, { headers });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

function mediaHeaders(contentType: string, object: R2Object): Headers {
  const headers = commonHeaders();
  headers.set("Content-Type", contentType);
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return headers;
}

function parseRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length, end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null;
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1, end };
}

async function downloadRow(env: Env, albumId: string, photoId: string | null): Promise<DownloadRow | null> {
  if (photoId === null) {
    return env.DB.prepare(
      `SELECT state, zip_key AS object_key, 'application/zip' AS content_type, zip_bytes AS object_bytes
         FROM albums WHERE id = ?1`,
    ).bind(albumId).first<DownloadRow>();
  }
  return env.DB.prepare(
    `SELECT a.state, p.clean_key AS object_key, p.clean_mime AS content_type, p.clean_bytes AS object_bytes
       FROM albums a JOIN photos p ON p.album_id = a.id
      WHERE a.id = ?1 AND p.id = ?2`,
  ).bind(albumId, photoId).first<DownloadRow>();
}

async function handleDownload(request: Request, env: Env, albumId: string, photoId: string | null): Promise<Response> {
  const row = await downloadRow(env, albumId, photoId);
  if (!row) return plain("Download not found", 404, { "X-Robots-Tag": "noindex, nofollow" });
  if (row.state === "deleted") return plain("Album removed", 410, { "X-Robots-Tag": "noindex, nofollow" });
  if (row.state !== "unlocked") return plain("Full-resolution downloads are locked", 403, { "X-Robots-Tag": "noindex, nofollow" });
  if (!row.object_key) return plain("Download not available", 404, { "X-Robots-Tag": "noindex, nofollow" });

  const head = await env.MEDIA.head(row.object_key);
  if (!head) return plain("Download not found", 404, { "X-Robots-Tag": "noindex, nofollow" });
  /* R2 is the source of truth for the body we are about to stream; the recorded byte count is
     only an integrity check, so a drifted row cannot produce a Content-Length the body misses. */
  const size = head.size;
  if (row.object_bytes !== null && row.object_bytes !== size) {
    console.error(JSON.stringify({ event: "download_size_mismatch", albumId, photoId, recorded: row.object_bytes, actual: size }));
  }
  const rangeHeader = request.headers.get("Range");
  const range = rangeHeader ? parseRange(rangeHeader, size) : undefined;
  if (rangeHeader && !range) {
    return plain("Requested range is not satisfiable", 416, { "Content-Range": `bytes */${size}` });
  }

  const headers = commonHeaders();
  headers.set("Content-Type", row.content_type);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", head.httpEtag);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  const extension = photoId === null ? "zip" : (row.object_key.split(".").pop() || "jpg");
  const filename = photoId === null ? `uscale-${albumId}.zip` : `uscale-${albumId}-${photoId}.${extension}`;
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  if (!range && request.headers.get("If-None-Match") === head.httpEtag) return new Response(null, { status: 304, headers });

  if (range) {
    headers.set("Content-Length", String(range.length));
    headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${size}`);
  } else {
    headers.set("Content-Length", String(size));
  }
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const object = await env.MEDIA.get(row.object_key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!object) return plain("Download not found", 404);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function stripeConfig(env: Env): { secretKey: string } | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  // Staging can run without Stripe configured; say so plainly rather than
  // failing inside the client with a 401 from Stripe.
  return secretKey ? { secretKey } : null;
}

/** Ensure the account has a Stripe customer, creating one on first purchase. */
async function ensureCustomer(env: Env, config: { secretKey: string }, account: Account): Promise<string> {
  if (account.stripeCustomerId) return account.stripeCustomerId;
  const customer = await createCustomer(config, { accountId: account.id, email: account.email });
  await setStripeCustomerId(env.ACCOUNTS_DB, account.id, customer.id);
  // Re-read rather than trusting the write: setStripeCustomerId only fills a
  // NULL, so a concurrent checkout may have won and stored a different id.
  const stored = await getOrCreateAccount(env.ACCOUNTS_DB, account.googleSub, account.email);
  return stored.stripeCustomerId ?? customer.id;
}

async function handleCheckout(request: Request, env: Env, identity: VerifiedIdentity): Promise<Response> {
  const config = stripeConfig(env);
  if (!config) return json({ error: "billing_unavailable" }, 503);

  let body: { packId?: unknown; amountCents?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  // A preset is just a shortcut for its price; either way the credits come from
  // quoteCredits, never from the request.
  const amountCents = typeof body.packId === "string" ? packById(body.packId)?.priceCents : body.amountCents;
  const quote = typeof amountCents === "number" ? quoteCredits(amountCents) : null;
  if (!quote) {
    return json({ error: "invalid_amount", minCents: MIN_PURCHASE_CENTS, maxCents: MAX_PURCHASE_CENTS }, 400);
  }

  const account = await getOrCreateAccount(env.ACCOUNTS_DB, identity.googleSub, identity.email);
  const origin = new URL(request.url).origin;
  try {
    const customerId = await ensureCustomer(env, config, account);
    const session = await createCheckoutSession(config, {
      accountId: account.id,
      customerId,
      packId: quote.tierId,
      credits: quote.credits,
      priceCents: quote.amountCents,
      productName: `${quote.credits.toLocaleString("en-US")} UScale credits`,
      successUrl: `${origin}/account/?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/account/?purchase=cancelled`,
    });
    return json({ url: session.url });
  } catch (error) {
    console.error(JSON.stringify({
      event: "checkout_failed",
      accountId: account.id,
      amountCents: quote.amountCents,
      detail: error instanceof Error ? error.message : "unknown",
    }));
    return json({ error: "checkout_failed" }, 502);
  }
}

/** Credit a completed Checkout session.
 *
 *  Stripe is authenticated by signature, not by bearer token, so this runs
 *  outside the /api auth gate. Everything that decides how many credits to
 *  grant comes from our own pricing table; the event supplies only which pack
 *  and whose account, and the amount is re-checked against it. */
async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "billing_unavailable" }, 503);

  let event: any;
  try {
    // Signature covers the exact bytes sent, so read text and never re-encode.
    event = await verifyWebhook(await request.text(), request.headers.get("Stripe-Signature"), secret);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "stripe_webhook_rejected",
      detail: error instanceof StripeError ? error.message : "unknown",
    }));
    return json({ error: "invalid_signature" }, 400);
  }

  // Anything else is acknowledged, not retried: Stripe resends non-2xx for days
  // and an unhandled type is not a failure.
  if (event?.type !== "checkout.session.completed") {
    return json({ received: true, ignored: event?.type ?? null });
  }

  const session = event.data?.object ?? {};
  const accountId = session.metadata?.account_id ?? session.client_reference_id;
  if (typeof accountId !== "string" || !accountId) {
    console.error(JSON.stringify({ event: "stripe_session_unattributable", sessionId: session.id ?? null }));
    // 200: retrying cannot fix a session we cannot attribute. It needs a human.
    return json({ received: true, error: "unattributable" });
  }
  if (session.payment_status !== "paid") {
    return json({ received: true, ignored: "unpaid" });
  }
  // Credits follow what was actually paid, priced by our own table. A total
  // the table would not sell, or another currency, means the session was not
  // one of ours as created, and is refused rather than guessed at.
  const quote = String(session.currency).toLowerCase() === "usd" && typeof session.amount_total === "number"
    ? quoteCredits(session.amount_total)
    : null;
  if (!quote) {
    console.error(JSON.stringify({
      event: "stripe_amount_mismatch",
      sessionId: session.id ?? null,
      got: session.amount_total ?? null,
      currency: session.currency ?? null,
    }));
    return json({ received: true, error: "amount_mismatch" });
  }
  const quoted = Number(session.metadata?.credits);
  if (Number.isFinite(quoted) && quoted !== quote.credits) {
    // Prices changed between checkout and payment. Grant what the table says
    // for the amount paid, and leave a trail so it can be reconciled.
    console.warn(JSON.stringify({ event: "stripe_quote_changed", sessionId: session.id ?? null, quoted, granted: quote.credits }));
  }

  const { applied, balance } = await recordPurchase(env.ACCOUNTS_DB, {
    accountId,
    packId: quote.tierId,
    credits: quote.credits,
    amountCents: quote.amountCents,
    currency: "usd",
    stripeSessionId: String(session.id),
    stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
  });
  console.log(JSON.stringify({
    event: applied ? "credits_purchased" : "credits_purchase_replayed",
    accountId, tier: quote.tierId, credits: quote.credits, balance,
  }));
  return json({ received: true, applied, balance });
}

const CLOUD_PATH = /^\/api\/cloud\/(creative|restore)$/;
const HISTORY_ITEM_PATH = /^\/api\/history\/([0-9a-f-]{36})$/;
const HISTORY_MEDIA_PATH = /^\/media\/history\/([0-9a-f-]{36})\/(original|result)$/;
// Generous for a phone photo; the providers downscale anything larger anyway.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Largest result copied into history. 8K JPEGs run to tens of megabytes.
const MAX_RESULT_BYTES = 80 * 1024 * 1024;
// Per-account history cap: room for hundreds of results, and a ceiling on what
// one account can put in the bucket.
const MAX_HISTORY_BYTES = 2 * 1024 * 1024 * 1024;
// Jobs one account may have running at once, counted over a window so a job the
// worker never finished cannot block the account forever.
const MAX_ACTIVE_JOBS = 3;
const ACTIVE_JOB_WINDOW_MS = 10 * 60 * 1000;
// A job still processing this long after it started has lost its request: the
// auralens call times out after 3 minutes and the history copy after 1.
const STALE_JOB_MS = 15 * 60 * 1000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ACCEPTED_IMAGE = /^image\/(jpeg|png|webp|heic|heif)$/;
const CLOUD_FIELDS = ["creativity", "resolution", "mode", "increaseResolution", "prompt"] as const;

function mediaSigningKey(env: Env): string | null {
  const secret = env.MEDIA_SIGNING_KEY;
  return secret && secret.length >= 32 ? secret : null;
}

async function historyUrls(env: Env, jobId: string): Promise<{ originalUrl: string; resultUrl: string; downloadUrl: string } | null> {
  const secret = mediaSigningKey(env);
  if (!secret) return null;
  const [originalUrl, resultUrl] = await Promise.all([
    signMediaUrl(secret, jobId, "original"),
    signMediaUrl(secret, jobId, "result"),
  ]);
  return { originalUrl, resultUrl, downloadUrl: `${resultUrl}&download=1` };
}

/** Copy a finished job's original and result into the account's history.
 *
 *  Provider result links expire (Replicate's within about an hour), so the
 *  copy happens now, not when someone opens their history. Best effort: the
 *  customer paid for a result and still gets the provider link if this fails,
 *  the job just does not appear in history. */
async function storeHistoryMedia(
  env: Env,
  accountId: string,
  jobId: string,
  image: File,
  outputUrl: string,
): Promise<{ original: StoredObject | null; result: StoredObject | null }> {
  const base = `users/${accountId}/${jobId}`;
  const originalKey = `${base}/original`;
  const resultKey = `${base}/result`;
  try {
    const response = await fetch(outputUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`result fetch returned ${response.status}`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_RESULT_BYTES) throw new Error("result too large");
    const resultMime = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim().toLowerCase();
    if (!resultMime.startsWith("image/")) throw new Error(`result is ${resultMime}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESULT_BYTES) throw new Error("result size out of range");
    await env.USER_MEDIA.put(originalKey, image, { httpMetadata: { contentType: image.type } });
    await env.USER_MEDIA.put(resultKey, bytes, { httpMetadata: { contentType: resultMime } });
    return {
      original: { key: originalKey, mime: image.type, bytes: image.size },
      result: { key: resultKey, mime: resultMime, bytes: bytes.byteLength },
    };
  } catch (error) {
    console.error(JSON.stringify({ event: "history_store_failed", jobId, detail: error instanceof Error ? error.message : "unknown" }));
    await env.USER_MEDIA.delete([originalKey, resultKey]).catch(() => undefined);
    return { original: null, result: null };
  }
}

/** Charge credits, run one cloud request, keep its result, and refund if it
 *  fails.
 *
 *  The debit happens before the call so two tabs cannot both spend the same
 *  last credits on work that has already started. Anything short of a clean
 *  result gives the credits back through failCloudJob, which refunds at most
 *  once per job. */
async function handleCloudOperation(
  request: Request,
  env: Env,
  identity: VerifiedIdentity,
  kind: CloudKind,
): Promise<Response> {
  const apiKey = env.UPSCALER_TOOL_API_KEY;
  if (!apiKey || !env.AURALENS_URL) return json({ error: "processing_unavailable" }, 503);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 256_000) {
    return json({ error: "image_too_large", maxBytes: MAX_UPLOAD_BYTES }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const image = form.get("image");
  const requestId = form.get("requestId");
  if (!(image instanceof File) || image.size === 0) return json({ error: "missing_image" }, 400);
  if (image.size > MAX_UPLOAD_BYTES) return json({ error: "image_too_large", maxBytes: MAX_UPLOAD_BYTES }, 413);
  if (!ACCEPTED_IMAGE.test(image.type)) return json({ error: "unsupported_image" }, 415);
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return json({ error: "invalid_request_id" }, 400);

  const fields: Record<string, string | undefined> = {};
  for (const name of CLOUD_FIELDS) {
    const value = form.get(name);
    fields[name] = typeof value === "string" ? value : undefined;
  }
  const parsed = parseCloudRequest(kind, fields);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const cost = creditsFor(parsed);
  const key = priceKey(parsed);

  const account = await getOrCreateAccount(env.ACCOUNTS_DB, identity.googleSub, identity.email);
  if (await countActiveJobs(env.ACCOUNTS_DB, account.id, Date.now() - ACTIVE_JOB_WINDOW_MS) >= MAX_ACTIVE_JOBS) {
    return json({ error: "too_many_active_jobs", maxActive: MAX_ACTIVE_JOBS }, 429);
  }
  if (await historyBytes(env.ACCOUNTS_DB, account.id) + image.size > MAX_HISTORY_BYTES) {
    return json({ error: "history_full", maxBytes: MAX_HISTORY_BYTES }, 409);
  }

  const started = await startCloudJob(env.ACCOUNTS_DB, {
    accountId: account.id, requestId, operation: parsed.kind, options: JSON.stringify(parsed), priceKey: key, credits: cost,
  });

  if (started.kind === "insufficient") {
    return json({ error: "insufficient_credits", balance: started.balance, required: cost }, 402);
  }
  if (started.kind === "duplicate") {
    // A retried upload with the same id is never charged twice.
    if (started.job.status === "succeeded") {
      const urls = started.job.resultKey ? await historyUrls(env, started.job.id) : null;
      return json({
        jobId: started.job.id,
        outputUrl: urls?.resultUrl ?? started.job.outputUrl,
        originalUrl: urls?.originalUrl ?? null,
        downloadUrl: urls?.downloadUrl ?? started.job.outputUrl,
        saved: Boolean(urls),
        balance: started.balance,
        charged: 0,
        replayed: true,
      });
    }
    return json({ error: started.job.status === "processing" ? "in_progress" : "already_failed", balance: started.balance }, 409);
  }

  let outputUrl: string;
  try {
    ({ outputUrl } = await runCloudRequest({ baseUrl: env.AURALENS_URL, apiKey }, parsed, image, image.name || "photo.jpg"));
  } catch (error) {
    const detail = error instanceof AuralensError ? error.message : "unknown";
    const { refunded, balance } = await failCloudJob(
      env.ACCOUNTS_DB, { id: started.job.id, accountId: account.id, credits: cost, priceKey: key }, detail,
    );
    console.error(JSON.stringify({ event: "cloud_job_failed", jobId: started.job.id, priceKey: key, detail, refunded }));
    return json({ error: "processing_failed", refunded, balance }, 502);
  }
  // Outside the try on purpose: nothing after a delivered result may trigger a
  // refund, including a failure to keep a copy of it.
  const media = await storeHistoryMedia(env, account.id, started.job.id, image, outputUrl);
  await completeCloudJob(env.ACCOUNTS_DB, started.job.id, { outputUrl, original: media.original, result: media.result });
  const urls = media.result ? await historyUrls(env, started.job.id) : null;
  console.log(JSON.stringify({ event: "cloud_job_succeeded", jobId: started.job.id, priceKey: key, charged: cost, saved: Boolean(urls) }));
  return json({
    jobId: started.job.id,
    outputUrl: urls?.resultUrl ?? outputUrl,
    originalUrl: urls?.originalUrl ?? null,
    downloadUrl: urls?.downloadUrl ?? outputUrl,
    saved: Boolean(urls),
    balance: started.balance,
    charged: cost,
  });
}

async function handleHistoryList(env: Env, identity: VerifiedIdentity): Promise<Response> {
  if (!mediaSigningKey(env)) return json({ error: "history_unavailable" }, 503);
  const account = await getOrCreateAccount(env.ACCOUNTS_DB, identity.googleSub, identity.email);
  const items = await listHistory(env.ACCOUNTS_DB, account.id);
  const withUrls = await Promise.all(items.map(async item => ({
    id: item.id,
    operation: item.operation,
    options: item.options,
    credits: item.credits,
    createdAt: item.createdAt,
    resultBytes: item.resultBytes,
    ...(await historyUrls(env, item.id))!,
  })));
  return json({ items: withUrls, usedBytes: await historyBytes(env.ACCOUNTS_DB, account.id), maxBytes: MAX_HISTORY_BYTES });
}

async function handleHistoryDelete(env: Env, identity: VerifiedIdentity, jobId: string): Promise<Response> {
  const account = await getOrCreateAccount(env.ACCOUNTS_DB, identity.googleSub, identity.email);
  const removed = await deleteHistoryItem(env.ACCOUNTS_DB, account.id, jobId);
  // Another account's item answers exactly like a missing one.
  if (!removed) return json({ error: "not_found" }, 404);
  const keys = [removed.originalKey, removed.resultKey].filter((key): key is string => Boolean(key));
  try {
    await env.USER_MEDIA.delete(keys);
  } catch (error) {
    // The row is already marked deleted, so the images are unreachable; log the
    // orphans for cleanup rather than failing a deletion the user asked for.
    console.error(JSON.stringify({ event: "history_media_delete_failed", jobId, keys, detail: error instanceof Error ? error.message : "unknown" }));
  }
  return json({ deleted: true });
}

/** Serve one history image, authorised by its signed link rather than a token. */
async function handleHistoryMedia(request: Request, env: Env, jobId: string, variant: MediaVariant): Promise<Response> {
  const noindex = { "X-Robots-Tag": "noindex, nofollow" };
  const secret = mediaSigningKey(env);
  if (!secret) return plain("Not found", 404, noindex);
  const url = new URL(request.url);
  const exp = url.searchParams.get("exp");
  if (!(await verifyMediaSignature(secret, jobId, variant, exp, url.searchParams.get("sig")))) {
    return plain("This link has expired or is not valid", 403, noindex);
  }
  const item = await getHistoryItem(env.ACCOUNTS_DB, jobId);
  const key = variant === "original" ? item?.originalKey : item?.resultKey;
  const mime = variant === "original" ? item?.originalMime : item?.resultMime;
  if (!item || item.deletedAt !== null || !key || !mime) return plain("Not found", 404, noindex);

  const headers = commonHeaders();
  headers.set("Content-Type", mime);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  // Private to this browser, and never cached past the link's own expiry.
  const remaining = Math.max(0, Number(exp) - Math.floor(Date.now() / 1000));
  headers.set("Cache-Control", `private, max-age=${Math.min(remaining, 3600)}`);
  if (url.searchParams.get("download") === "1") {
    const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    headers.set("Content-Disposition", `attachment; filename="uscale-${variant}-${jobId.slice(0, 8)}.${extension}"`);
  }

  const head = await env.USER_MEDIA.head(key);
  if (!head) return plain("Not found", 404, noindex);
  headers.set("ETag", head.httpEtag);
  if (request.method === "HEAD") {
    headers.set("Content-Length", String(head.size));
    return new Response(null, { headers });
  }
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, head.size);
    if (!range) {
      headers.set("Content-Range", `bytes */${head.size}`);
      return new Response(null, { status: 416, headers });
    }
    const object = await env.USER_MEDIA.get(key, { range: { offset: range.offset, length: range.length } });
    if (!object) return plain("Not found", 404, noindex);
    headers.set("Content-Length", String(range.length));
    headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${head.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  const object = await env.USER_MEDIA.get(key);
  if (!object) return plain("Not found", 404, noindex);
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = bearerToken(request);
  if (!token) return json({ error: "unauthorized" }, 401);

  let identity: VerifiedIdentity;
  try {
    identity = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
  } catch (error) {
    // Never echo the verification detail back: it tells an attacker which part
    // of a forged token failed.
    console.warn(JSON.stringify({ event: "token_rejected", reason: error instanceof Error ? error.message : "unknown" }));
    return json({ error: "unauthorized" }, 401);
  }

  // Called once after sign-in, then idempotent. Creating the row here rather
  // than lazily means later endpoints can assume an account exists.
  if (url.pathname === "/api/auth/session" && request.method === "POST") {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, identity.googleSub, identity.email);
    return json({ accountId: account.id, email: account.email, credits: await creditBalance(env.ACCOUNTS_DB, account.id) });
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, identity.googleSub, identity.email);
    return json({ accountId: account.id, email: account.email, credits: await creditBalance(env.ACCOUNTS_DB, account.id) });
  }

  // The price list the account page renders. Served from the same table the
  // webhook credits from, so the page cannot advertise a stale price.
  if (url.pathname === "/api/billing/packs" && request.method === "GET") {
    return json({
      packs: CREDIT_PACKS.map(pack => ({ id: pack.id, credits: pack.credits, priceCents: pack.priceCents, label: pack.label })),
      prices: CREDIT_PRICES,
      limits: { minCents: MIN_PURCHASE_CENTS, maxCents: MAX_PURCHASE_CENTS },
      device: { credits: CREDIT_PRICES.device, freeLimit: FREE_DEVICE_UPSCALES },
    });
  }

  if (url.pathname === "/api/account/activity" && request.method === "GET") {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, identity.googleSub, identity.email);
    return json({ entries: await listActivity(env.ACCOUNTS_DB, account.id) });
  }

  const cloud = CLOUD_PATH.exec(url.pathname);
  if (cloud?.[1] && request.method === "POST") {
    return handleCloudOperation(request, env, identity, cloud[1] as CloudKind);
  }

  if (url.pathname === "/api/device-upscales" && request.method === "GET") {
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, identity.googleSub, identity.email);
    return json({
      ...(await deviceAllowance(env.ACCOUNTS_DB, account.id, FREE_DEVICE_UPSCALES)),
      credits: CREDIT_PRICES.device,
      balance: await creditBalance(env.ACCOUNTS_DB, account.id),
    });
  }
  // The page confirms a finished on-device upscale here before showing it. The
  // work itself happened in the browser, so this is an honest-client limit,
  // like the apps' own local limits -- not a security boundary.
  if (url.pathname === "/api/device-upscales" && request.method === "POST") {
    let requestId: unknown;
    try {
      requestId = ((await request.json()) as { requestId?: unknown } | null)?.requestId;
    } catch {
      return json({ error: "invalid_body" }, 400);
    }
    if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return json({ error: "invalid_request_id" }, 400);
    const account = await getOrCreateAccount(env.ACCOUNTS_DB, identity.googleSub, identity.email);
    const claim = await claimDeviceUpscale(env.ACCOUNTS_DB, {
      accountId: account.id, requestId, freeLimit: FREE_DEVICE_UPSCALES, credits: CREDIT_PRICES.device,
    });
    if (claim.kind === "insufficient") {
      return json({ error: "insufficient_credits", required: CREDIT_PRICES.device, ...claim, kind: undefined }, 402);
    }
    return json({ ...claim, credits: CREDIT_PRICES.device });
  }

  if (url.pathname === "/api/history" && request.method === "GET") {
    return handleHistoryList(env, identity);
  }
  const historyItem = HISTORY_ITEM_PATH.exec(url.pathname);
  if (historyItem?.[1] && request.method === "DELETE") {
    return handleHistoryDelete(env, identity, historyItem[1]);
  }

  if (url.pathname === "/api/billing/checkout" && request.method === "POST") {
    return handleCheckout(request, env, identity);
  }

  return json({ error: "not_found" }, 404);
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const isRead = request.method === "GET" || request.method === "HEAD";
  const dynamic = url.pathname === "/gallery" || url.pathname.startsWith("/gallery/") || url.pathname.startsWith("/media/") || url.pathname.startsWith("/download/") || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_shell/");
  // /api/ is the one dynamic prefix that accepts writes: sign-in creates an
  // account row, and Stripe will POST webhooks here.
  if (dynamic && !isRead && !url.pathname.startsWith("/api/")) {
    return plain("Method not allowed", 405, { Allow: "GET, HEAD" });
  }
  if (url.pathname.startsWith("/_shell/")) return plain("Not found", 404);
  // Ahead of handleApi: Stripe authenticates with a body signature and has no
  // bearer token to send, so it must bypass that gate.
  if (url.pathname === "/api/webhooks/stripe") {
    if (request.method !== "POST") return plain("Method not allowed", 405, { Allow: "POST" });
    return handleStripeWebhook(request, env);
  }
  if (url.pathname.startsWith("/api/")) return handleApi(request, env);
  if (url.pathname === "/gallery") return handleGallery(request, env, ctx);

  const album = ALBUM_PATH.exec(url.pathname);
  if (album?.[1]) return handleAlbum(request, env, album[1]);
  const cover = COVER_PATH.exec(url.pathname);
  if (cover?.[1]) return handleMedia(request, env, ctx, cover[1], null, "cover");
  const galleryMedia = GALLERY_MEDIA_PATH.exec(url.pathname);
  if (galleryMedia?.[1]) return handleMedia(request, env, ctx, galleryMedia[1], null, "gallery");
  const historyMedia = HISTORY_MEDIA_PATH.exec(url.pathname);
  if (historyMedia?.[1] && (historyMedia[2] === "original" || historyMedia[2] === "result")) {
    return handleHistoryMedia(request, env, historyMedia[1], historyMedia[2]);
  }
  const media = MEDIA_PATH.exec(url.pathname);
  if (media?.[1] && media[2] && (media[3] === "before" || media[3] === "after")) {
    return handleMedia(request, env, ctx, media[1], media[2], media[3]);
  }
  const zip = ZIP_PATH.exec(url.pathname);
  if (zip?.[1]) return handleDownload(request, env, zip[1], null);
  const download = DOWNLOAD_PATH.exec(url.pathname);
  if (download?.[1] && download[2]) return handleDownload(request, env, download[1], download[2]);
  if (dynamic) return plain("Not found", 404);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({
        event: "unhandled_request_error",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return plain("Internal server error", 500);
    }
  },
  // Every 10 minutes (wrangler.jsonc triggers): refund jobs whose request died.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refundStaleJobs(env.ACCOUNTS_DB, Date.now() - STALE_JOB_MS).then(refunded => {
      if (refunded > 0) console.log(JSON.stringify({ event: "stale_jobs_refunded", refunded }));
    }));
  },
} satisfies ExportedHandler<Env>;

export { escapeHtml, parseRange };
