// Page controller. Knows about identities, not about Firebase.
import {onIdentityChanged, signInWithGoogle, signOut} from './identity.js';
import {fetchAccount, fetchPacks, startCheckout} from './api.js';
import {OPERATION_LABELS, formatCredits, formatPrice} from './billing-format.js';

const card = document.getElementById('account');
const signInButton = document.getElementById('sign-in');
const signOutButton = document.getElementById('sign-out');
const errorBox = document.getElementById('account-error');
const avatar = document.getElementById('avatar');
const displayName = document.getElementById('display-name');
const email = document.getElementById('email');
const creditCount = document.getElementById('credit-count');
const packList = document.getElementById('pack-list');
const creditCosts = document.getElementById('credit-costs');
const purchaseConfirmed = document.getElementById('purchase-confirmed');

function showError(message) {
  errorBox.textContent = message || '';
  errorBox.hidden = !message;
}

function setBusy(busy) {
  signInButton.disabled = busy;
  signOutButton.disabled = busy;
}

function render(identity) {
  if (!identity) {
    card.dataset.state = 'signed-out';
    return;
  }
  displayName.textContent = identity.displayName || identity.email || 'Signed in';
  email.textContent = identity.displayName ? identity.email || '' : '';
  if (identity.photoURL) {
    avatar.src = identity.photoURL;
    avatar.hidden = false;
  } else {
    avatar.removeAttribute('src');
    avatar.hidden = true;
  }
  card.dataset.state = 'signed-in';
}

function renderBalance(credits) {
  creditCount.textContent = formatCredits(credits);
  creditCount.dataset.credits = String(credits);
}

function renderPacks(packs, operations) {
  packList.textContent = '';
  for (const pack of packs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pack';
    button.dataset.packId = pack.id;
    const credits = document.createElement('span');
    credits.className = 'pack-credits';
    const amount = document.createElement('b');
    amount.textContent = `${formatCredits(pack.credits)} credits`;
    const rate = document.createElement('small');
    rate.textContent = `${formatCredits(Math.round(pack.credits / (pack.priceCents / 100)))} per dollar`;
    credits.append(amount, rate);
    const price = document.createElement('span');
    price.className = 'pack-price';
    price.textContent = formatPrice(pack.priceCents);
    button.append(credits, price);
    button.addEventListener('click', () => buy(pack.id, button));
    packList.append(button);
  }
  creditCosts.textContent = Object.entries(operations)
    .filter(([operation]) => OPERATION_LABELS[operation])
    .map(([operation, cost]) => `${OPERATION_LABELS[operation]} ${cost}`)
    .join(' · ') + ' credits per photo.';
}

// Survives the round trip to Stripe in this tab, which a variable cannot: the
// page is fully reloaded on return, so the pre-purchase balance has to be
// written down somewhere before leaving.
const PENDING_KEY = 'uscale.balanceBeforePurchase';

function rememberBalance(credits) {
  try {
    window.sessionStorage.setItem(PENDING_KEY, String(credits));
  } catch { /* private mode can refuse; polling just falls back to one read */ }
}

function takeRememberedBalance() {
  try {
    const stored = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    return stored === null ? null : Number(stored);
  } catch {
    return null;
  }
}

async function buy(packId, button) {
  const buttons = [...packList.querySelectorAll('.pack')];
  buttons.forEach(candidate => { candidate.disabled = true; });
  button.textContent = 'Opening checkout…';
  showError('');
  try {
    rememberBalance(Number(creditCount.dataset.credits ?? '0'));
    const {url} = await startCheckout(packId);
    // Stripe hosts the payment form, so the card details never touch this page.
    window.location.assign(url);
  } catch (error) {
    showError(error.message);
    // Rebuild rather than un-disable: the clicked button's label was replaced.
    await loadBilling();
  }
}

async function loadBilling() {
  try {
    const [account, catalogue] = await Promise.all([fetchAccount(), fetchPacks()]);
    renderBalance(account.credits);
    renderPacks(catalogue.packs, catalogue.operations);
  } catch (error) {
    packList.textContent = '';
    showError(error.message);
  }
}

/** After returning from Stripe, the webhook may not have landed yet. Re-read the
 *  balance until it rises above what it was before checkout, rather than showing
 *  a stale figure to someone who has just paid. */
async function settlePurchase() {
  purchaseConfirmed.hidden = false;
  const before = takeRememberedBalance();
  // Without a remembered balance there is nothing to compare against, so the
  // reload that already happened is as good as it gets.
  if (before === null || !Number.isFinite(before)) return;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const account = await fetchAccount();
      renderBalance(account.credits);
      if (account.credits > before) return;
    } catch { /* keep waiting; a persistent failure falls through to the note */ }
    // Backs off, because the wait is for Stripe's webhook, not for us.
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  purchaseConfirmed.textContent = 'Payment received. Credits can take a moment to appear — reload this page shortly.';
}

function handleReturnFromStripe() {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get('purchase');
  if (!outcome) return null;
  // Drop the parameters so a reload does not replay the confirmation, and so
  // the Stripe session id does not linger in the address bar or in history.
  window.history.replaceState({}, '', window.location.pathname);
  return outcome;
}

const purchaseOutcome = handleReturnFromStripe();

// Fires once the provider resolves the current state, then on every change —
// so a returning user lands straight in the signed-in state instead of seeing
// the signed-out one flash first.
onIdentityChanged(identity => {
  showError('');
  setBusy(false);
  render(identity);
  if (!identity) return;
  loadBilling().then(() => {
    if (purchaseOutcome === 'success') return settlePurchase();
  });
});

async function run(action) {
  setBusy(true);
  showError('');
  try {
    await action();
  } catch (error) {
    // identity.js guarantees a human-readable message on every thrown error.
    showError(error.message);
    setBusy(false);
  }
}

signInButton.addEventListener('click', () => run(signInWithGoogle));
signOutButton.addEventListener('click', () => run(signOut));
