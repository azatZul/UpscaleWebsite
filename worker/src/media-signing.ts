// Short-lived signed links for private history images.
//
// History images are private, but an <img> cannot send the Firebase bearer
// token, so the API hands out links that carry their own authorisation: an
// HMAC over the job, the variant and an expiry, keyed by MEDIA_SIGNING_KEY. A
// link grants exactly one image of one job until it expires, and nothing else.

export type MediaVariant = "original" | "result";

const encoder = new TextEncoder();
const TTL_SECONDS = 3600;
// Expiry rounds up to a 15-minute boundary, so reloading a page within the
// window produces identical URLs the browser can serve from its cache.
const BUCKET_SECONDS = 900;
// Refuse links claiming an expiry further out than this could ever sign.
const MAX_FUTURE_SECONDS = TTL_SECONDS + BUCKET_SECONDS;

const importKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

const message = (jobId: string, variant: MediaVariant, exp: number) =>
  encoder.encode(`history-media:${jobId}:${variant}:${exp}`);

const toBase64Url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromBase64Url(value: string): Uint8Array | null {
  // An HMAC-SHA256 is 32 bytes, which is exactly 43 base64url characters.
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=";
  try {
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function signMediaUrl(
  secret: string,
  jobId: string,
  variant: MediaVariant,
  nowMs = Date.now(),
): Promise<string> {
  const exp = Math.ceil((Math.floor(nowMs / 1000) + TTL_SECONDS) / BUCKET_SECONDS) * BUCKET_SECONDS;
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret, "sign"), message(jobId, variant, exp));
  return `/media/history/${jobId}/${variant}?exp=${exp}&sig=${toBase64Url(signature)}`;
}

/** Constant-time check: crypto.subtle.verify does not leak where a forged
 *  signature diverges. */
export async function verifyMediaSignature(
  secret: string,
  jobId: string,
  variant: MediaVariant,
  exp: string | null,
  sig: string | null,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  const expiry = Number(exp);
  const now = Math.floor(nowMs / 1000);
  if (expiry < now || expiry > now + MAX_FUTURE_SECONDS) return false;
  const signature = fromBase64Url(sig);
  if (!signature) return false;
  return crypto.subtle.verify("HMAC", await importKey(secret, "verify"), signature, message(jobId, variant, expiry));
}

// A tile of a tiled upscale lives at the provider, not in the bucket, and the
// browser has to read its pixels to stitch the photo -- which a cross-origin
// image on this isolated page cannot do. So the worker fetches it instead, and
// this signature is what says the browser may ask for that exact URL: the
// worker signs the tiles it just produced, and accepts nothing else. Without
// it the endpoint would fetch whatever URL it was handed.
const tileMessage = (jobId: string, index: number, url: string) =>
  encoder.encode(`cloud-tile:${jobId}:${index}:${url}`);

export async function signCloudTile(secret: string, jobId: string, index: number, url: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret, "sign"), tileMessage(jobId, index, url));
  return toBase64Url(signature);
}

export async function verifyCloudTile(
  secret: string,
  jobId: string,
  index: number,
  url: string,
  sig: string,
): Promise<boolean> {
  const signature = fromBase64Url(sig);
  if (!signature) return false;
  return await crypto.subtle.verify(
    "HMAC",
    await importKey(secret, "verify"),
    signature as unknown as ArrayBuffer,
    tileMessage(jobId, index, url),
  );
}

