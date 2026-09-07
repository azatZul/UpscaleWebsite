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
            gallery_width, gallery_height, created_at
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
    return `<a class="gallery-card" href="/gallery/${album.id}">
      <img class="gallery-preview" src="/media/${album.id}/gallery.jpg" width="${album.gallery_width ?? 1280}" height="${album.gallery_height ?? 960}" loading="lazy" decoding="async" alt="Before and after: ${title}">
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

  const cleanUrl = new URL(request.url);
  cleanUrl.search = "";
  const cacheKey = new Request(cleanUrl, { method: "GET" });
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

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const isRead = request.method === "GET" || request.method === "HEAD";
  const dynamic = url.pathname === "/gallery" || url.pathname.startsWith("/gallery/") || url.pathname.startsWith("/media/") || url.pathname.startsWith("/download/") || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_shell/");
  if (dynamic && !isRead) return plain("Method not allowed", 405, { Allow: "GET, HEAD" });
  if (url.pathname.startsWith("/_shell/")) return plain("Not found", 404);
  if (url.pathname.startsWith("/api/")) return plain("Not found", 404);
  if (url.pathname === "/gallery") return handleGallery(request, env, ctx);

  const album = ALBUM_PATH.exec(url.pathname);
  if (album?.[1]) return handleAlbum(request, env, album[1]);
  const cover = COVER_PATH.exec(url.pathname);
  if (cover?.[1]) return handleMedia(request, env, ctx, cover[1], null, "cover");
  const galleryMedia = GALLERY_MEDIA_PATH.exec(url.pathname);
  if (galleryMedia?.[1]) return handleMedia(request, env, ctx, galleryMedia[1], null, "gallery");
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
} satisfies ExportedHandler<Env>;

export { escapeHtml, parseRange };
