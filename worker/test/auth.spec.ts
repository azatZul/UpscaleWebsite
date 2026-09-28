import { beforeEach, describe, expect, it } from "vitest";

import { AuthError, bearerToken, resetKeyCache, verifyIdToken } from "../src/auth";

const PROJECT = "upscaler-e9010";
const KID = "test-key-1";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

let keyPair: CryptoKeyPair;
let jwks: string;

async function setup() {
  keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  jwks = JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] });
}

const fetcher = (async () => new Response(jwks, {
  headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" },
})) as unknown as typeof fetch;

async function makeToken(overrides: { header?: object; payload?: object; signature?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: KID, typ: "JWT", ...overrides.header };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: "firebase-user-123",
    iat: now - 10,
    exp: now + 3600,
    email: "person@example.com",
    email_verified: true,
    firebase: { identities: { "google.com": ["115204000000000004029"] }, sign_in_provider: "google.com" },
    ...overrides.payload,
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${overrides.signature ?? b64url(new Uint8Array(signature))}`;
}

beforeEach(async () => {
  await setup();
  resetKeyCache();
});

describe("verifyIdToken", () => {
  it("accepts an email sign-in whose address is verified", async () => {
    const identity = await verifyIdToken(await makeToken({ payload: {
      email: "reader@example.com", email_verified: true,
      firebase: { identities: { email: ["reader@example.com"] }, sign_in_provider: "password" },
    } }), PROJECT, fetcher);
    expect(identity).toMatchObject({ email: "reader@example.com", emailVerified: true });
  });

  it("refuses an email sign-in whose address was never verified", async () => {
    await expect(verifyIdToken(await makeToken({ payload: {
      email: "someone-else@example.com", email_verified: false,
      firebase: { identities: { email: ["someone-else@example.com"] }, sign_in_provider: "password" },
    } }), PROJECT, fetcher)).rejects.toThrow("Email address is not verified");
  });

  it("returns the Firebase UID rather than a provider subject", async () => {
    const identity = await verifyIdToken(await makeToken(), PROJECT, fetcher);
    expect(identity.firebaseUid).toBe("firebase-user-123");
    expect(identity.firebaseUid).not.toBe("115204000000000004029");
    expect(identity.email).toBe("person@example.com");
    expect(identity.emailVerified).toBe(true);
  });

  it("rejects a token minted for another Firebase project", async () => {
    const token = await makeToken({ payload: { aud: "someone-elses-project" } });
    await expect(verifyIdToken(token, PROJECT, fetcher)).rejects.toThrow(AuthError);
  });

  it("rejects a mismatched issuer even when the audience is right", async () => {
    const token = await makeToken({ payload: { iss: "https://evil.example.com/upscaler-e9010" } });
    await expect(verifyIdToken(token, PROJECT, fetcher)).rejects.toThrow(AuthError);
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    await expect(verifyIdToken(await makeToken({ payload: { iat: past, exp: past + 60 } }), PROJECT, fetcher))
      .rejects.toThrow(AuthError);
  });

  it("refuses alg=none and alg swapping instead of trusting the header", async () => {
    await expect(verifyIdToken(await makeToken({ header: { alg: "none" } }), PROJECT, fetcher)).rejects.toThrow(AuthError);
    await expect(verifyIdToken(await makeToken({ header: { alg: "HS256" } }), PROJECT, fetcher)).rejects.toThrow(AuthError);
  });

  it("rejects a tampered signature", async () => {
    await expect(verifyIdToken(await makeToken({ signature: b64url(new Uint8Array(256)) }), PROJECT, fetcher))
      .rejects.toThrow(AuthError);
  });

  it("rejects an unknown signing key rather than skipping verification", async () => {
    await expect(verifyIdToken(await makeToken({ header: { kid: "not-a-key" } }), PROJECT, fetcher))
      .rejects.toThrow(AuthError);
  });

  it("accepts Apple-only tokens and preserves the UID when providers are linked", async () => {
    for (const firebase of [
      { identities: { "apple.com": ["apple-456"] }, sign_in_provider: "apple.com" },
      { identities: { "google.com": ["google-789"], "apple.com": ["apple-456"] }, sign_in_provider: "google.com" },
      { identities: { "google.com": ["google-789"], "apple.com": ["apple-456"] }, sign_in_provider: "apple.com" },
    ]) {
      const identity = await verifyIdToken(await makeToken({ payload: { firebase } }), PROJECT, fetcher);
      expect(identity.firebaseUid).toBe("firebase-user-123");
    }
  });

  it("rejects an absent, empty, non-string, or oversized Firebase UID", async () => {
    for (const sub of [undefined, "", 123, "a".repeat(129)]) {
      await expect(verifyIdToken(await makeToken({ payload: { sub } }), PROJECT, fetcher)).rejects.toThrow(AuthError);
    }
  });

  it("rejects anonymous and unsupported sessions from the shared Firebase project", async () => {
    for (const provider of ['anonymous', 'custom', undefined]) {
      const token = await makeToken({ payload: { firebase: {sign_in_provider: provider} } });
      await expect(verifyIdToken(token, PROJECT, fetcher)).rejects.toThrow(AuthError);
    }
  });

  it("rejects malformed tokens, including one with extra segments", async () => {
    for (const bad of ["", "a.b", `${await makeToken()}.extra`, "not-a-token"]) {
      await expect(verifyIdToken(bad, PROJECT, fetcher)).rejects.toThrow(AuthError);
    }
  });
});

describe("bearerToken", () => {
  it("reads the header case-insensitively and ignores anything else", () => {
    const of = (value?: string) => new Request("https://x/", value ? { headers: { Authorization: value } } : undefined);
    expect(bearerToken(of("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
    expect(bearerToken(of("bearer abc"))).toBe("abc");
    expect(bearerToken(of("Basic abc"))).toBeNull();
    expect(bearerToken(of("Bearer   "))).toBeNull();
    expect(bearerToken(of())).toBeNull();
  });
});
