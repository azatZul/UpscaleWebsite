// Verifying a Firebase ID token needs only the project id.
//
// The token is an ordinary RS256 JWT signed by Google, and the public keys sit
// on an unauthenticated endpoint. No Admin SDK, no service account, no IAM
// grant on the identity project. That is precisely what lets identity live in
// upscaler-e9010 while this code runs in Cloudflare. Our own account ID keeps
// billing and history independent of the authentication service.

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const ISSUER_PREFIX = "https://securetoken.google.com/";
// Tolerance for clock skew between Google and the edge, in seconds.
const LEEWAY = 60;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface VerifiedIdentity {
  firebaseUid: string;
  email: string | null;
  emailVerified: boolean;
}

type Fetcher = typeof fetch;

let keyCache: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null;

export function resetKeyCache(): void {
  keyCache = null;
}

async function signingKeys(fetcher: Fetcher): Promise<Map<string, CryptoKey>> {
  if (keyCache && keyCache.expiresAt > Date.now()) return keyCache.keys;
  let response: Response;
  try {
    response = await fetcher(JWKS_URL);
  } catch {
    throw new AuthError("Could not reach the token signing keys");
  }
  if (!response.ok) throw new AuthError("Could not fetch the token signing keys");
  const body = await response.json() as { keys?: (JsonWebKey & { kid?: string })[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid) continue;
    keys.set(jwk.kid, await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    ));
  }
  if (keys.size === 0) throw new AuthError("Token signing keys were empty");
  // Google rotates these; honour its cache lifetime rather than picking one.
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  keyCache = { keys, expiresAt: Date.now() + Math.max(60, maxAge) * 1000 };
  return keys;
}

function decodeSegment(segment: string): unknown {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function base64UrlToBytes(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

/** Verify a Firebase ID token and return its Firebase user ID.
 *  Throws AuthError on anything that fails; callers should treat that as 401. */
export async function verifyIdToken(
  token: string,
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<VerifiedIdentity> {
  const parts = token.split(".");
  const [rawHeader, rawPayload, rawSignature] = parts;
  // Length check as well as the emptiness checks: a token with extra segments
  // would otherwise destructure fine and be treated as valid.
  if (parts.length !== 3 || !rawHeader || !rawPayload || !rawSignature) throw new AuthError("Malformed token");

  let header: { alg?: string; kid?: string };
  let payload: Record<string, any>;
  try {
    header = decodeSegment(rawHeader) as typeof header;
    payload = decodeSegment(rawPayload) as typeof payload;
  } catch {
    throw new AuthError("Malformed token");
  }

  // Pin the algorithm. Accepting whatever the header claims is the classic JWT
  // forgery: "none" skips verification, and HS256 lets the public key be used
  // as an HMAC secret.
  if (header.alg !== "RS256") throw new AuthError("Unexpected token algorithm");
  if (!header.kid) throw new AuthError("Token has no key id");

  const key = (await signingKeys(fetcher)).get(header.kid);
  if (!key) throw new AuthError("Unknown token signing key");

  const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, base64UrlToBytes(rawSignature), signed,
  );
  if (!valid) throw new AuthError("Token signature did not verify");

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + LEEWAY < now) throw new AuthError("Token expired");
  if (typeof payload.iat !== "number" || payload.iat - LEEWAY > now) throw new AuthError("Token issued in the future");
  if (payload.aud !== projectId) throw new AuthError("Token was issued for another project");
  if (payload.iss !== `${ISSUER_PREFIX}${projectId}`) throw new AuthError("Token has an unexpected issuer");
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) throw new AuthError("Token has no subject");
  // Anonymous/custom sessions from the shared mobile project must not unlock
  // web accounts or their free-use allowance. Enable other providers deliberately.
  const provider = payload.firebase?.sign_in_provider;
  if (!["google.com", "apple.com", "password"].includes(provider)) {
    throw new AuthError("Unsupported sign-in provider");
  }
  // "password" covers email links too. A link proves the address is theirs; an
  // email-and-password account need not, so an unverified one is refused
  // rather than trusted with an address somebody else may own.
  if (provider === "password" && payload.email_verified !== true) {
    throw new AuthError("Email address is not verified");
  }

  // Firebase keeps this UID stable across linked sign-in providers.
  // Never select an account by email or by a Google/Apple provider subject.
  return {
    firebaseUid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: payload.email_verified === true,
  };
}

/** Pull the bearer token out of a request, or null when absent. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}
