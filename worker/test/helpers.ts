// Shared stubs for tests that drive authenticated requests through the worker:
// a Firebase signing key, and fetch stand-ins for Google's JWKS, the auralens
// processing service, and the provider link a result is copied from.
import { env, exports } from "cloudflare:workers";

import { getOrCreateAccount, grantCredits } from "../src/accounts";
import { resetKeyCache } from "../src/auth";

const PROJECT = "upscaler-e9010";
const KID = "shared-test-key";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
export const AURALENS = "https://auralens-406817559814.us-central1.run.app";
export const RESULT_URL = "https://cdn.example/result.jpg";
export const RESULT_BYTES = 2048;

export interface AuralensCall {
  url: string;
  path: string;
  auth: string | null;
  fields: Record<string, string>;
  files: string[];
}

export interface Stubs {
  auralensCalls: AuralensCall[];
  setAuralensResponder(responder: () => Response): void;
  setResultResponder(responder: () => Response): void;
  idToken(googleSub: string): Promise<string>;
  restore(): void;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function installStubs(): Promise<Stubs> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  ) as CryptoKeyPair;
  resetKeyCache();
  const auralensCalls: AuralensCall[] = [];
  let auralensResponder = () => Response.json({ output_url: RESULT_URL });
  let resultResponder = () => new Response(new Uint8Array(RESULT_BYTES).fill(7), { headers: { "content-type": "image/jpeg" } });
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === JWKS_URL) {
      const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
      return Response.json({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] });
    }
    if (request.url.startsWith(AURALENS)) {
      const form = await request.formData();
      const fields: Record<string, string> = {};
      const files: string[] = [];
      form.forEach((value, name) => {
        if (typeof value === "string") fields[name] = value;
        else files.push(name);
      });
      auralensCalls.push({ url: request.url, path: new URL(request.url).pathname, auth: request.headers.get("Authorization"), fields, files });
      return auralensResponder();
    }
    if (request.url === RESULT_URL) return resultResponder();
    throw new Error(`Unexpected fetch in test: ${request.url}`);
  }) as typeof fetch;

  return {
    auralensCalls,
    setAuralensResponder: responder => { auralensResponder = responder; },
    setResultResponder: responder => { resultResponder = responder; },
    async idToken(googleSub: string) {
      const now = Math.floor(Date.now() / 1000);
      const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
      const signingInput = `${encode({ alg: "RS256", kid: KID, typ: "JWT" })}.${encode({
        iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "uid", iat: now - 10, exp: now + 3600,
        email: "cloud@example.com", firebase: { identities: { "google.com": [googleSub] } },
      })}`;
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput));
      return `${signingInput}.${b64url(new Uint8Array(signature))}`;
    },
    restore: () => { globalThis.fetch = realFetch; },
  };
}

export const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://upscales.app${path}`, init));

export async function fundedAccount(googleSub: string, credits: number) {
  const account = await getOrCreateAccount(env.ACCOUNTS_DB, googleSub, "cloud@example.com");
  if (credits > 0) {
    await grantCredits(env.ACCOUNTS_DB, { accountId: account.id, amount: credits, reason: "grant", idempotencyKey: `seed:${googleSub}` });
  }
  return account;
}

export function cloudForm(
  requestId: string,
  fields: Record<string, string> = {},
  image: { type?: string; bytes?: number; omit?: boolean } = {},
): FormData {
  const form = new FormData();
  if (!image.omit) {
    form.append("image", new File([new Uint8Array(image.bytes ?? 64).fill(3)], "photo.jpg", { type: image.type ?? "image/jpeg" }));
  }
  form.append("requestId", requestId);
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return form;
}
