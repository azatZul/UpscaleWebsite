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
  'auth/account-exists-with-different-credential': 'account-exists',
  'auth/credential-already-in-use': 'already-linked-elsewhere',
  'auth/provider-already-linked': 'already-linked',
  'auth/user-not-found': 'sign-in-required',
  // Configuration faults, kept distinct from transient ones: telling someone to
  // try again when the host they are on will never be allowed to sign in wastes
  // their time and hides the actual cause from whoever has to fix it.
  'auth/unauthorized-domain': 'domain-not-allowed',
  'auth/operation-not-allowed': 'provider-disabled',
  'auth/invalid-api-key': 'misconfigured',
  'auth/api-key-not-valid': 'misconfigured',
};

export function mapErrorCode(providerCode) {
  return ERROR_CODES[providerCode] || 'unknown';
}

// Every code messageForCode must answer for. Exported so the tests cover the
// whole set rather than a list that drifts behind it.
export const IDENTITY_ERROR_CODES = Object.freeze([...new Set(Object.values(ERROR_CODES)), 'unknown']);

/** @param code one of IDENTITY_ERROR_CODES
 *  @param hostname the current host, supplied by the caller -- this module
 *         stays free of DOM globals so it can be tested in plain node. */
export function messageForCode(code, hostname) {
  switch (code) {
    case 'popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.';
    case 'cancelled':
      return 'Sign-in was cancelled.';
    case 'network':
      return 'Could not reach the sign-in service. Check your connection and try again.';
    case 'domain-not-allowed':
      return `Sign-in is not enabled for ${hostname || 'this address'}. The host has to be added to the project's authorized domains.`;
    case 'provider-disabled':
      return 'This sign-in method is not available yet.';
    case 'account-exists':
      return 'Sign in with the method you used before, then connect this sign-in method from your account.';
    case 'already-linked-elsewhere':
      return 'This sign-in method belongs to another account. Sign in to that account to use it. Your accounts have not been merged.';
    case 'already-linked':
      return 'This sign-in method is already connected to your account.';
    case 'sign-in-required':
      return 'Sign in before connecting another sign-in method.';
    case 'misconfigured':
      return 'Sign-in is misconfigured for this site. This needs a fix on our side, not a retry.';
    default:
      return 'Sign-in could not be completed. Please try again.';
  }
}

// Map a provider user record onto our own Identity.
//
// One Firebase UID owns all linked providers. Backend credits/history still
// belong to our own account ID. Provider IDs describe connection status only.
export function toIdentity(user) {
  if (!user) return null;
  if (user.isAnonymous || typeof user.uid !== 'string' || !user.uid || user.uid.length > 128) {
    throw new IdentityError('unknown', 'Signed in, but no valid user identity was returned.');
  }
  const providers = (user.providerData || []).filter(entry => entry && entry.providerId);
  return {
    uid: user.uid,
    providers: [...new Set(providers.map(entry => entry.providerId))],
    email: user.email || providers.find(entry => entry.email)?.email || null,
    emailVerified: Boolean(user.emailVerified),
    displayName: user.displayName || providers.find(entry => entry.displayName)?.displayName || null,
    photoURL: user.photoURL || providers.find(entry => entry.photoURL)?.photoURL || null,
  };
}
