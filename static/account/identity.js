// The only module in the codebase that knows Firebase exists.
//
// Everything else imports these five functions and the Identity shape from
// identity-model.js. Nothing outside this file may import from gstatic, name a
// Firebase type, or read a Firebase-specific field. Replacing the provider
// later means rewriting this one file and keeping the same exports — see
// WEB_AUTH_PLAN.md §10.
import {FIREBASE_CONFIG, FIREBASE_SDK_VERSION} from './firebase-config.js';
import {IdentityError, mapErrorCode, messageForCode, toIdentity} from './identity-model.js';

let sdkPromise;
let cached = null;
let resolvedOnce = false;
let stalled = false;
// How long to wait for the provider before carrying on without it. A provider
// that fails rejects and is handled; one that goes silent -- a blocked or
// stalled SDK download -- would otherwise leave every page saying "checking
// sign-in" for ever, with nothing to click.
const RESOLUTION_DEADLINE_MS = 10_000;
let watching = false;
const listeners = new Set();

// Loaded on demand rather than at module load: the page renders its checking
// state immediately instead of waiting on ~260 KB of SDK.
function sdk() {
  if (!sdkPromise) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    sdkPromise = Promise.all([
      import(/* @vite-ignore */ `${base}/firebase-app.js`),
      import(/* @vite-ignore */ `${base}/firebase-auth.js`),
    ]).then(([app, auth]) => ({
      auth,
      instance: auth.getAuth(app.initializeApp(FIREBASE_CONFIG)),
    })).catch(() => {
      sdkPromise = undefined; // let a later attempt retry rather than stay broken
      throw new IdentityError('network', messageForCode('network'));
    });
  }
  return sdkPromise;
}

function asIdentityError(error) {
  if (error instanceof IdentityError) return error;
  const code = mapErrorCode(error && error.code);
  return new IdentityError(code, messageForCode(code, location.hostname));
}

function publish(identity, fromDeadline = false) {
  cached = identity;
  resolvedOnce = true;
  stalled = fromDeadline;
  for (const listener of listeners) listener(identity);
}

/** True when the last answer came from the deadline rather than the provider:
 *  nobody knows whether this browser is signed in, so a caller should say the
 *  check failed rather than act as though the answer were no. */
export function identityStalled() {
  return stalled;
}

async function watch() {
  if (watching) return;
  watching = true;
  setTimeout(() => { if (!resolvedOnce) publish(null, true); }, RESOLUTION_DEADLINE_MS);
  try {
    const {auth, instance} = await sdk();
    auth.onAuthStateChanged(instance, user => {
      let identity = null;
      // A signed-in user we cannot map is treated as signed out rather than
      // surfaced half-built: an Identity without a sub is not usable.
      try { identity = toIdentity(user); } catch { identity = null; }
      publish(identity);
    });
  } catch {
    watching = false;
    publish(null);
  }
}

/** Subscribe to identity changes. Fires once the provider resolves the current
 *  state, then on every change. Returns an unsubscribe function. */
export function onIdentityChanged(listener) {
  listeners.add(listener);
  if (resolvedOnce) listener(cached);
  watch();
  return () => listeners.delete(listener);
}

/** Last known identity. Synchronous, and null before the first resolution —
 *  callers that care about the difference should use onIdentityChanged. */
export function currentIdentity() {
  return cached;
}

export async function signInWithGoogle() {
  try {
    const {auth, instance} = await sdk();
    const provider = new auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(instance, provider);
    return toIdentity(result.user);
  } catch (error) {
    throw asIdentityError(error);
  }
}

export async function signInWithApple() {
  try {
    const {auth, instance} = await sdk();
    const provider = new auth.OAuthProvider('apple.com');
    // Apple returns these once, on the first sign-in, and only if asked.
    provider.addScope('email');
    provider.addScope('name');
    const result = await auth.signInWithPopup(instance, provider);
    return toIdentity(result.user);
  } catch (error) {
    throw asIdentityError(error);
  }
}

export async function signOut() {
  try {
    const {auth, instance} = await sdk();
    await auth.signOut(instance);
  } catch (error) {
    throw asIdentityError(error);
  }
}

/** An opaque bearer credential for a future backend. Callers must not parse it,
 *  read claims from it, or assume who issued it — its only job is to become an
 *  Authorization header. Null when signed out. */
export async function getAccessToken() {
  try {
    const {instance} = await sdk();
    const user = instance.currentUser;
    return user ? await user.getIdToken() : null;
  } catch (error) {
    throw asIdentityError(error);
  }
}
