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
  // Email link sign-in.
  'auth/invalid-email': 'invalid-email',
  'auth/missing-email': 'invalid-email',
  'auth/invalid-action-code': 'link-invalid',
  'auth/expired-action-code': 'link-invalid',
  'auth/too-many-requests': 'rate-limited',
  'auth/quota-exceeded': 'rate-limited',
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
      return `Sign-in isn't enabled for ${hostname || 'this address'}. Add it to the Firebase authorized domains.`;
    case 'provider-disabled':
      return 'This sign-in method is not available yet.';
    case 'account-exists':
      return 'This email already has an account. Sign in the way you did before, then add this method from your account.';
    case 'already-linked-elsewhere':
      return 'This sign-in method is used by another account. Sign in there instead — your accounts have not been merged.';
    case 'already-linked':
      return 'This sign-in method is already connected to your account.';
    case 'sign-in-required':
      return 'Sign in before connecting another sign-in method.';
    case 'misconfigured':
      return 'Sign-in is unavailable because of a problem on our side.';
    case 'invalid-email':
      return 'Enter a valid email address.';
    case 'link-invalid':
      return 'This sign-in link has expired or was already used. Request a new one below.';
    case 'rate-limited':
      return 'Too many attempts. Wait a few minutes, then try again.';
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

// The query parameters a sign-in link adds to the page it opens. Once the link
// has been used -- or has failed -- they are dead weight in the address bar,
// and a reload would try the spent code again.
const EMAIL_LINK_PARAMS = ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl', 'tenantId'];

/** The same URL without the sign-in link's parameters; anything else, such as
 *  ?next=, is kept. */
export function withoutEmailLinkParams(href) {
  const url = new URL(href);
  for (const name of EMAIL_LINK_PARAMS) url.searchParams.delete(name);
  return url.pathname + url.search + url.hash;
}

/** Cheap check, no SDK needed: does this URL look like a sign-in link landing? */
export function looksLikeEmailLink(href) {
  const params = new URL(href).searchParams;
  return params.get('mode') === 'signIn' && Boolean(params.get('oobCode'));
}
