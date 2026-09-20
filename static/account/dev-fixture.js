// Local design preview only. account.js loads this instead of identity.js and
// api.js when the page runs on localhost with ?fixture in the URL, so the
// signed-in dashboard can be reviewed without a real Google sign-in or worker.
// It is never loaded on any other host.

const PACKS = [
  {id: 'starter', credits: 200, priceCents: 500, label: '200 credits'},
  {id: 'plus', credits: 650, priceCents: 1500, label: '650 credits'},
  {id: 'pro', credits: 1800, priceCents: 4000, label: '1,800 credits'},
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
    creative: {'2k': 10, '4k': 10, '8k': 10},
    restore: {restore: 10, colorization: 10, colorization_pro: 10, advanced_restoration: 10},
    increaseResolution: 0,
    device: 1,
  },
  device: {credits: 1, freeLimit: 10},
  limits: {minCents: 500, maxCents: 50_000},
});
export const fetchActivity = async () => ({
  entries: empty ? [] : [
    {id: 6, delta: -10, reason: 'spend', detail: 'restore:colorization_pro+hires', createdAt: now - 0.4 * hour},
    {id: 5, delta: 10, reason: 'reversal', detail: 'restore:advanced_restoration', createdAt: now - 3 * hour},
    {id: 4, delta: -10, reason: 'spend', detail: 'restore:advanced_restoration', createdAt: now - 3.1 * hour},
    {id: 3, delta: -1, reason: 'spend', detail: 'device:upscale', createdAt: now - 26 * hour},
    {id: 2, delta: 1_650, reason: 'purchase', detail: 'plus', createdAt: now - 50 * hour},
    {id: 1, delta: -385, reason: 'spend', detail: 'restore', createdAt: now - 400 * hour},
  ],
});
const sample = '/resources/appstore/icon_512.png';
let historyItems = empty ? [] : [
  {id: 'fixture-1', operation: 'restore', options: {mode: 'colorization_pro', increaseResolution: true}, credits: 10,
    createdAt: now - 0.4 * hour, resultBytes: 3_400_000},
  {id: 'fixture-2', operation: 'creative', options: {creativity: 1, resolution: '8k'}, credits: 10,
    createdAt: now - 26 * hour, resultBytes: 21_000_000},
  {id: 'fixture-3', operation: 'restore', options: {mode: 'advanced_restoration'}, credits: 10,
    createdAt: now - 400 * hour, resultBytes: 1_900_000},
].map(item => ({...item, resultUrl: sample, originalUrl: sample, downloadUrl: sample}));
export const fetchHistory = async () => ({
  items: historyItems,
  usedBytes: historyItems.reduce((sum, item) => sum + item.resultBytes * 1.3, 0),
  maxBytes: 2 * 1024 ** 3,
});
export async function deleteHistoryItem(id) {
  historyItems = historyItems.filter(item => item.id !== id);
  return {deleted: true};
}

export async function startCheckout(amountCents) {
  await new Promise(resolve => setTimeout(resolve, 600));
  throw new Error(`Fixture mode: checkout for ${amountCents} cents would redirect to Stripe here.`);
}
