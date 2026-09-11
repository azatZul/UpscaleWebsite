// Page controller. Knows about identities, not about Firebase.
import {onIdentityChanged, signInWithGoogle, signOut} from './identity.js';

const card = document.getElementById('account');
const signInButton = document.getElementById('sign-in');
const signOutButton = document.getElementById('sign-out');
const errorBox = document.getElementById('account-error');
const avatar = document.getElementById('avatar');
const displayName = document.getElementById('display-name');
const email = document.getElementById('email');

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

// Fires once the provider resolves the current state, then on every change —
// so a returning user lands straight in the signed-in state instead of seeing
// the signed-out one flash first.
onIdentityChanged(identity => {
  showError('');
  setBusy(false);
  render(identity);
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
