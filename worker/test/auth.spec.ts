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
    sub: "FIREBASE_UID_NOT_THE_KEY",
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
  it("accepts a well-formed token and returns the Google subject, not the Firebase uid", async () => {
    const identity = await verifyIdToken(await makeToken(), PROJECT, fetcher);
    expect(identity.googleSub).toBe("115204000000000004029");
    expect(identity.googleSub).not.toBe("FIREBASE_UID_NOT_THE_KEY");
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

  it("rejects a token with no Google identity, which would leave sub undefined", async () => {
    const token = await makeToken({ payload: { firebase: { identities: {}, sign_in_provider: "password" } } });
    await expect(verifyIdToken(token, PROJECT, fetcher)).rejects.toThrow(AuthError);
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
