import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fundedAccount, fetchWorker, installStubs, type Stubs } from "./helpers";

let stubs: Stubs;
beforeEach(async () => { stubs = await installStubs(); });
afterEach(() => stubs.restore());

async function me(uid: string, provider: string) {
  const response = await fetchWorker('/api/me', {
    headers: { Authorization: `Bearer ${await stubs.idToken(uid, provider)}` },
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{accountId: string; credits: number}>;
}

describe('provider-independent accounts', () => {
  it('Google and Apple tokens with the same Firebase UID share account and credits', async () => {
    const uid = crypto.randomUUID();
    const account = await fundedAccount(uid, 75);
    const google = await me(uid, 'google.com');
    const apple = await me(uid, 'apple.com');
    expect(google).toMatchObject({accountId: account.id, credits: 75});
    expect(apple).toMatchObject({accountId: account.id, credits: 75});
    const row = await env.ACCOUNTS_DB.prepare('SELECT COUNT(*) AS n FROM accounts WHERE firebase_uid = ?').bind(uid).first<{n: number}>();
    expect(row?.n).toBe(1);
  });

  it('an Apple-only user can create an account without a Google identity', async () => {
    const result = await me(crypto.randomUUID(), 'apple.com');
    expect(result.accountId).toBeTruthy();
    expect(result.credits).toBe(0);
  });

  it('different Firebase UIDs never share credits even with the same email', async () => {
    const firstUid = crypto.randomUUID();
    const first = await fundedAccount(firstUid, 42);
    const second = await me(crypto.randomUUID(), 'apple.com');
    expect(second.accountId).not.toBe(first.id);
    expect(second.credits).toBe(0);
    expect((await me(firstUid, 'google.com')).credits).toBe(42);
  });
});
