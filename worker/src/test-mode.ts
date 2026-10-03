// On Stripe's test keys credits are free -- anyone can pay with the published
// test card -- but the cloud jobs they buy run on real providers that bill us
// real money. So in test mode, buying credits and spending them are limited to
// the emails in TEST_ALLOWED_EMAILS: a Cloudflare secret, so only people with
// access to the Cloudflare account can change it, and changing it needs no
// redeploy. Keyed on the Stripe key rather than the environment's name, so
// test keys put on production by mistake are still locked. Live keys are open.

export interface TestModeEnv {
  STRIPE_SECRET_KEY?: string;
  TEST_ALLOWED_EMAILS?: string;
}

export function isTestMode(env: TestModeEnv): boolean {
  return /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? "");
}

/** Whether this person may buy or spend credits here. In test mode only a
 *  verified email on the list may; with no list at all, nobody may. */
export function testModeAllows(env: TestModeEnv, identity: { email: string | null; emailVerified: boolean }): boolean {
  if (!isTestMode(env)) return true;
  if (!identity.emailVerified || !identity.email) return false;
  const allowed = (env.TEST_ALLOWED_EMAILS ?? "").split(/[\s,;]+/).map(email => email.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(identity.email.toLowerCase());
}
