// Page controller. Knows about identities and the worker API, not Firebase.
// A localhost-only fixture stands in for sign-in and the worker, so the
// signed-in design can be reviewed without real credentials. See dev-fixture.js.
const fixtureMode = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).has('fixture');
const {onIdentityChanged, signInWithGoogle, signOut} = await import(fixtureMode ? './dev-fixture.js' : './identity.js');
const {deleteHistoryItem, fetchAccount, fetchActivity, fetchHistory, fetchPacks, startCheckout} =
  await import(fixtureMode ? './dev-fixture.js' : './api.js');
import {
  describeActivity, describeHistoryItem, formatBytes, formatCredits, formatDelta, formatPrice, parseDollars, priceList,
  quoteCredits,
} from './billing-format.js';

const $ = id => document.getElementById(id);
const main = $('main-content');
const errorBox = $('account-error');
const signInButton = $('sign-in');
const signOutButton = $('sign-out');
const creditCount = $('credit-count');
const balanceHint = $('balance-hint');
const operationCosts = $('operation-costs');
const amountOptions = $('amount-options');
const customField = $('custom-amount-field');
const customInput = $('custom-amount');
const customHelp = $('custom-help');
const quoteCreditsEl = $('quote-credits');
const checkoutButton = $('checkout');
const activityList = $('activity-list');
const activityEmpty = $('activity-empty');
const purchaseNotice = $('purchase-notice');
const historyGrid = $('history-grid');
const historyEmpty = $('history-empty');
const historyUsage = $('history-usage');
const viewer = $('history-viewer');

// Read by site.js on every other page to draw the header account button
// without loading the auth SDK there.
const HINT_KEY = 'uscale-account';
// Survives the round trip to Stripe, which fully reloads this page.
const PENDING_KEY = 'uscale.balanceBeforePurchase';

const state = {catalogue: null, selection: null, balance: null};

function store(fn) {
  try { return fn(); } catch { return null; }
}

function showError(message) {
  errorBox.textContent = message || '';
  errorBox.hidden = !message;
}

function initialOf(identity) {
  return (identity.displayName || identity.email || '?').trim().charAt(0).toUpperCase();
}

function renderIdentity(identity) {
  if (!identity) {
    main.dataset.state = 'signed-out';
    store(() => localStorage.removeItem(HINT_KEY));
    return;
  }
  $('display-name').textContent = identity.displayName || identity.email || 'Your account';
  $('email').textContent = identity.displayName ? identity.email || '' : '';
  const avatar = $('avatar');
  $('avatar-initial').textContent = initialOf(identity);
  if (identity.photoURL) {
    avatar.src = identity.photoURL;
    avatar.hidden = false;
    avatar.onerror = () => { avatar.hidden = true; };
  } else {
    avatar.hidden = true;
  }
  store(() => localStorage.setItem(HINT_KEY, JSON.stringify({
    signedIn: true,
    photo: identity.photoURL || null,
    initial: initialOf(identity),
  })));
  main.dataset.state = 'signed-in';
}

function renderBalance(credits) {
  state.balance = credits;
  // The header shows the balance under Account on every page.
  store(() => {
    const hint = JSON.parse(localStorage.getItem(HINT_KEY) || 'null');
    if (hint?.signedIn && hint.credits !== credits) {
      localStorage.setItem(HINT_KEY, JSON.stringify({...hint, credits}));
      window.dispatchEvent(new Event('uscale:account-hint'));
    }
  });
  creditCount.textContent = formatCredits(credits);
  const prices = state.catalogue?.prices;
  if (!prices) return;
  const upscale = prices.creative?.['4k'];
  const restore = prices.restore?.restore;
  if (!upscale || !restore) return;
  if (credits < Math.min(upscale, restore)) {
    balanceHint.textContent = 'Add credits to start using cloud enhancements.';
  } else if (upscale === restore) {
    // The two cost the same, so naming both twice over would just repeat a figure.
    balanceHint.textContent = `Enough for about ${formatCredits(Math.floor(credits / upscale))} photos.`;
  } else {
    balanceHint.textContent = `Enough for about ${formatCredits(Math.floor(credits / upscale))} creative upscales or ${formatCredits(Math.floor(credits / restore))} restorations.`;
  }
}

function renderOperationCosts(prices) {
  operationCosts.textContent = '';
  for (const row of priceList(prices)) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = row.label;
    const price = document.createElement('b');
    price.textContent = `${row.extra ? '+' : ''}${formatCredits(row.credits)} credits`;
    item.append(name, price);
    operationCosts.append(item);
  }
}

function optionButton({key, price, credits, bonus, custom}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `amount-option${custom ? ' is-custom' : ''}`;
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', 'false');
  button.dataset.key = key;
  const priceEl = document.createElement('span');
  priceEl.className = 'amount-price';
  priceEl.textContent = price;
  button.append(priceEl);
  if (credits) {
    const creditsEl = document.createElement('span');
    creditsEl.className = 'amount-credits';
    creditsEl.textContent = credits;
    button.append(creditsEl);
  }
  if (bonus) {
    const bonusEl = document.createElement('span');
    bonusEl.className = 'amount-bonus';
    bonusEl.textContent = bonus;
    button.append(bonusEl);
  }
  button.addEventListener('click', () => select(key));
  return button;
}

function renderAmountOptions() {
  const {packs, limits} = state.catalogue;
  amountOptions.textContent = '';
  for (const pack of packs) {
    const quote = quoteCredits(pack.priceCents, packs, limits);
    amountOptions.append(optionButton({
      key: pack.id,
      price: formatPrice(pack.priceCents),
      credits: `${formatCredits(pack.credits)} credits`,
      bonus: quote && quote.bonusPercent > 0 ? `+${quote.bonusPercent}%` : '',
    }));
  }
  amountOptions.append(optionButton({key: 'custom', price: 'Custom amount', custom: true}));
  customHelp.textContent = `Whole dollars, ${formatPrice(limits.minCents)} to ${formatPrice(limits.maxCents)}.`;
  // Default to the middle pack: the first one with a bonus, as most billing pages do.
  const suggested = packs.find(pack => (quoteCredits(pack.priceCents, packs, limits)?.bonusPercent ?? 0) > 0) || packs[0];
  select(suggested.id);
}

function selectedAmountCents() {
  const {packs} = state.catalogue;
  if (state.selection === 'custom') return parseDollars(customInput.value);
  return packs.find(pack => pack.id === state.selection)?.priceCents ?? null;
}

function select(key) {
  state.selection = key;
  for (const button of amountOptions.querySelectorAll('.amount-option')) {
    button.setAttribute('aria-checked', String(button.dataset.key === key));
  }
  customField.hidden = key !== 'custom';
  if (key === 'custom') customInput.focus();
  updateQuote();
}

function updateQuote() {
  const {packs, limits} = state.catalogue;
  const amountCents = selectedAmountCents();
  const quote = amountCents === null ? null : quoteCredits(amountCents, packs, limits);
  const typing = state.selection === 'custom';
  const invalid = typing && customInput.value.trim() !== '' && !quote;

  customInput.closest('.money-input').classList.toggle('is-invalid', invalid);
  customHelp.classList.toggle('is-invalid', invalid);
  customHelp.textContent = invalid
    ? `Enter a whole-dollar amount from ${formatPrice(limits.minCents)} to ${formatPrice(limits.maxCents)}.`
    : quote && quote.bonusPercent > 0 && typing
      ? `Includes a ${quote.bonusPercent}% bonus.`
      : `Whole dollars, ${formatPrice(limits.minCents)} to ${formatPrice(limits.maxCents)}.`;

  quoteCreditsEl.textContent = quote ? `${formatCredits(quote.credits)} credits` : '—';
  checkoutButton.disabled = !quote;
  checkoutButton.textContent = quote ? `Continue to payment · ${formatPrice(quote.amountCents)}` : 'Continue to payment';
}

async function checkout() {
  const amountCents = selectedAmountCents();
  if (amountCents === null) return;
  checkoutButton.disabled = true;
  checkoutButton.textContent = 'Opening secure checkout…';
  showError('');
  try {
    store(() => sessionStorage.setItem(PENDING_KEY, String(state.balance ?? 0)));
    const {url} = await startCheckout(amountCents);
    window.location.assign(url);
  } catch (error) {
    store(() => sessionStorage.removeItem(PENDING_KEY));
    showError(error.message);
    updateQuote();
  }
}

function renderActivity(entries) {
  activityList.textContent = '';
  activityEmpty.hidden = entries.length > 0;
  const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'});
  for (const entry of entries) {
    const item = document.createElement('li');
    if (entry.delta > 0) item.classList.add('is-credit');
    const icon = document.createElement('span');
    icon.className = 'activity-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = entry.delta > 0 ? '+' : '−';
    const text = document.createElement('span');
    text.className = 'activity-text';
    const title = document.createElement('b');
    title.textContent = describeActivity(entry);
    const time = document.createElement('time');
    time.dateTime = new Date(entry.createdAt).toISOString();
    time.textContent = dateFormat.format(entry.createdAt);
    text.append(title, time);
    const delta = document.createElement('span');
    delta.className = 'activity-delta';
    delta.textContent = formatDelta(entry.delta);
    item.append(icon, text, delta);
    activityList.append(item);
  }
}

async function loadActivity() {
  try {
    renderActivity((await fetchActivity()).entries);
  } catch {
    // Activity is informational; a failure here should not hide the balance.
    activityEmpty.textContent = 'Activity could not be loaded right now.';
    activityEmpty.hidden = false;
  }
}

async function loadDashboard() {
  try {
    const [account, catalogue] = await Promise.all([fetchAccount(), fetchPacks()]);
    state.catalogue = catalogue;
    renderOperationCosts(catalogue.prices);
    renderAmountOptions();
    renderBalance(account.credits);
  } catch (error) {
    showError(error.message);
  }
  await Promise.all([loadActivity(), loadHistory()]);
}

function showNotice(outcome, message) {
  purchaseNotice.textContent = message;
  purchaseNotice.dataset.outcome = outcome;
  purchaseNotice.hidden = false;
}

/** After Stripe, the webhook may land a moment after the redirect. Re-read the
 *  balance until it rises above what it was before checkout. */
async function settlePurchase() {
  showNotice('success', 'Payment received. Adding your credits…');
  const before = Number(store(() => sessionStorage.getItem(PENDING_KEY)) ?? NaN);
  store(() => sessionStorage.removeItem(PENDING_KEY));
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const account = await fetchAccount();
      renderBalance(account.credits);
      if (!Number.isFinite(before) || account.credits > before) {
        showNotice('success', 'Payment received. Your credits have been added.');
        await loadActivity();
        return;
      }
    } catch { /* keep waiting */ }
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  showNotice('success', 'Payment received. Credits can take a moment to appear — reload this page shortly.');
}

function takeReturnOutcome() {
  const outcome = new URLSearchParams(window.location.search).get('purchase');
  // Drop the parameters so a reload does not replay the notice, and the Stripe
  // session id does not linger in the address bar.
  if (outcome) window.history.replaceState({}, '', window.location.pathname);
  return outcome;
}

const returnOutcome = takeReturnOutcome();
let dashboardLoaded = false;

// Tools send people here to sign in with ?next=<path>. Only a same-origin path
// is honoured, so the parameter cannot bounce anyone to another site.
function safeNext(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const target = new URL(value, window.location.origin);
    return target.origin === window.location.origin ? target.pathname + target.search + target.hash : null;
  } catch {
    return null;
  }
}
const nextUrl = safeNext(new URLSearchParams(window.location.search).get('next'));
if (nextUrl) {
  $('auth-heading').textContent = 'Sign in to continue';
  document.querySelector('.auth-lead').textContent = 'Sign in to upscale your photos. You get 10 free upscales on your device.';
}

onIdentityChanged(identity => {
  if (nextUrl && identity) {
    renderIdentity(identity);
    main.dataset.state = 'checking';
    window.location.replace(nextUrl);
    return;
  }
  showError('');
  signInButton.disabled = false;
  signOutButton.disabled = false;
  renderIdentity(identity);
  if (!identity || dashboardLoaded) return;
  dashboardLoaded = true;
  loadDashboard().then(() => {
    if (returnOutcome === 'success') return settlePurchase();
    if (returnOutcome === 'cancelled') {
      store(() => sessionStorage.removeItem(PENDING_KEY));
      showNotice('cancelled', 'Checkout was cancelled. Nothing was charged.');
    }
  });
});

async function run(button, action) {
  button.disabled = true;
  showError('');
  try {
    await action();
  } catch (error) {
    showError(error.message);
    button.disabled = false;
  }
}

signInButton.addEventListener('click', () => run(signInButton, signInWithGoogle));
signOutButton.addEventListener('click', () => run(signOutButton, async () => {
  await signOut();
  dashboardLoaded = false;
}));
customInput.addEventListener('input', updateQuote);
customInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !checkoutButton.disabled) checkout();
});
checkoutButton.addEventListener('click', checkout);

// History: results kept from the paid cloud modes. Images load through
// short-lived signed links the worker issues with the list.
let viewing = null;

function renderHistory({items, usedBytes, maxBytes}) {
  historyGrid.textContent = '';
  historyEmpty.hidden = items.length > 0;
  historyUsage.textContent = items.length ? `${formatBytes(usedBytes)} of ${formatBytes(maxBytes)} used` : '';
  const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'});
  for (const item of items) {
    const entry = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    const image = document.createElement('img');
    image.src = item.resultUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    const label = document.createElement('span');
    label.className = 'history-label';
    label.textContent = describeHistoryItem(item);
    const time = document.createElement('time');
    time.dateTime = new Date(item.createdAt).toISOString();
    time.textContent = dateFormat.format(item.createdAt);
    button.append(image, label, time);
    button.addEventListener('click', () => openViewer(item));
    entry.append(button);
    historyGrid.append(entry);
  }
}

async function loadHistory() {
  try {
    renderHistory(await fetchHistory());
  } catch {
    historyGrid.textContent = '';
    historyUsage.textContent = '';
    historyEmpty.textContent = 'Your history could not be loaded right now.';
    historyEmpty.hidden = false;
  }
  if (window.location.hash === '#history') $('history').scrollIntoView({block: 'start'});
}

function setSplit(value) {
  $('viewer-original').style.clipPath = `inset(0 ${100 - value}% 0 0)`;
  $('viewer-divider').style.left = `${value}%`;
}

function openViewer(item) {
  viewing = item;
  $('viewer-title').textContent = describeHistoryItem(item);
  const when = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(item.createdAt);
  $('viewer-meta').textContent = `${when} · ${formatCredits(item.credits)} credits`;
  $('viewer-result').src = item.resultUrl;
  $('viewer-original').src = item.originalUrl;
  $('viewer-download').href = item.downloadUrl;
  $('viewer-slider').value = '50';
  setSplit(50);
  $('viewer-delete').disabled = false;
  viewer.showModal();
}

$('viewer-slider').addEventListener('input', event => setSplit(Number(event.target.value)));
$('viewer-close').addEventListener('click', () => viewer.close());
viewer.addEventListener('close', () => {
  $('viewer-result').removeAttribute('src');
  $('viewer-original').removeAttribute('src');
  viewing = null;
});
$('viewer-delete').addEventListener('click', async () => {
  const item = viewing;
  if (!item || !window.confirm('Delete this photo from your history? This can’t be undone.')) return;
  $('viewer-delete').disabled = true;
  try {
    await deleteHistoryItem(item.id);
    viewer.close();
    await loadHistory();
  } catch (error) {
    $('viewer-delete').disabled = false;
    showError(error.message);
  }
});

