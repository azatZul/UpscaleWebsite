// Pure identity mapping. Deliberately imports nothing — no Firebase, no DOM —
// so it is testable in plain node and so the shape below stays independent of
// whoever is issuing tokens this month.

export class IdentityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
  }
}

// Provider error strings are mapped to this small, stable set. Nothing outside
// identity.js ever sees a raw provider code.
const ERROR_CODES = {
  'auth/popup-blocked': 'popup-blocked',
  'auth/popup-closed-by-user': 'cancelled',
  'auth/cancelled-popup-request': 'cancelled',
  'auth/user-cancelled': 'cancelled',
  'auth/network-request-failed': 'network',
};

export function mapErrorCode(providerCode) {
  return ERROR_CODES[providerCode] || 'unknown';
}

export function messageForCode(code) {
  switch (code) {
    case 'popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.';
    case 'cancelled':
      return 'Sign-in was cancelled.';
    case 'network':
      return 'Could not reach the sign-in service. Check your connection and try again.';
    default:
      return 'Sign-in could not be completed. Please try again.';
  }
}

// Map a provider user record onto our own Identity.
//
// The identifier we keep is the Google account's subject claim, read from the
// provider record — NOT the Firebase uid. That uid is meaningful only inside
// this one Firebase project; the Google sub is the same value Google returns
// when verifying its tokens directly, so users stay matchable if Firebase is
// ever swapped out. Nothing in this file reads user.uid, on purpose.
export function toIdentity(user) {
  if (!user) return null;
  const google = (user.providerData || []).find(entry => entry && entry.providerId === 'google.com');
  if (!google || !google.uid) {
    throw new IdentityError('unknown', 'Signed in, but no Google identity was returned.');
  }
  return {
    provider: 'google.com',
    sub: google.uid,
    email: google.email || user.email || null,
    emailVerified: Boolean(user.emailVerified),
    displayName: google.displayName || user.displayName || null,
    photoURL: google.photoURL || user.photoURL || null,
  };
}
