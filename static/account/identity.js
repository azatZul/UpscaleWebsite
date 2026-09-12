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

function publish(identity) {
  cached = identity;
  resolvedOnce = true;
  for (const listener of listeners) listener(identity);
}

async function watch() {
  if (watching) return;
  watching = true;
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
