// Local design preview only. account.js loads this instead of identity.js and
// api.js when the page runs on localhost with ?fixture in the URL, so the
// signed-in dashboard can be reviewed without a real Google sign-in or worker.
// It is never loaded on any other host.

const PACKS = [
  {id: 'starter', credits: 500, priceCents: 500, label: '500 credits'},
  {id: 'plus', credits: 1650, priceCents: 1500, label: '1,650 credits'},
  {id: 'pro', credits: 4800, priceCents: 4000, label: '4,800 credits'},
];
const now = Date.now();
const hour = 3_600_000;
const params = new URLSearchParams(location.search);
const empty = params.get('fixture') === 'empty';

const identity = {
  provider: 'google.com', sub: 'fixture', email: 'alex@example.com', emailVerified: true,
  displayName: 'Alex Morgan', photoURL: null,
};

export function onIdentityChanged(listener) {
  setTimeout(() => listener(params.get('fixture') === 'signed-out' ? null : identity), 250);
  return () => {};
}
export const currentIdentity = () => identity;
export async function signInWithGoogle() { location.search = '?fixture'; }
export async function signOut() { location.search = '?fixture=signed-out'; }
export const getAccessToken = async () => 'fixture';

export const fetchAccount = async () => ({accountId: 'fixture', email: identity.email, credits: empty ? 0 : 1_235});
export const fetchPacks = async () => ({
  packs: PACKS,
  prices: {
    creative: {'2k': 5, '4k': 5, '8k': 15},
    restore: {restore: 15, colorization: 15, colorization_pro: 35, advanced_restoration: 20},
    increaseResolution: 10,
  },
  limits: {minCents: 500, maxCents: 50_000},
});
export const fetchActivity = async () => ({
  entries: empty ? [] : [
    {id: 6, delta: -45, reason: 'spend', detail: 'restore:colorization_pro+hires', createdAt: now - 0.4 * hour},
    {id: 5, delta: 20, reason: 'reversal', detail: 'restore:advanced_restoration', createdAt: now - 3 * hour},
    {id: 4, delta: -20, reason: 'spend', detail: 'restore:advanced_restoration', createdAt: now - 3.1 * hour},
    {id: 3, delta: -15, reason: 'spend', detail: 'creative:8k', createdAt: now - 26 * hour},
    {id: 2, delta: 1_650, reason: 'purchase', detail: 'plus', createdAt: now - 50 * hour},
    {id: 1, delta: -385, reason: 'spend', detail: 'restore', createdAt: now - 400 * hour},
  ],
});
export async function startCheckout(amountCents) {
  await new Promise(resolve => setTimeout(resolve, 600));
  throw new Error(`Fixture mode: checkout for ${amountCents} cents would redirect to Stripe here.`);
}
