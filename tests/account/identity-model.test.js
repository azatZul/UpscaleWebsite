import test from 'node:test';
import assert from 'node:assert/strict';
import {IdentityError, mapErrorCode, messageForCode, toIdentity, IDENTITY_ERROR_CODES, looksLikeEmailLink, withoutEmailLinkParams} from '../../static/account/identity-model.js';

const googleUser = {
  uid: 'firebase-user-123',
  email: 'person@example.com',
  emailVerified: true,
  displayName: 'Fallback Name',
  photoURL: null,
  providerData: [{
    providerId: 'google.com',
    uid: '107712345678901234567',
    email: 'person@example.com',
    displayName: 'Person Example',
    photoURL: 'https://example.com/a.jpg',
  }],
};

test('all linked providers map to one Firebase UID', () => {
  const apple = {providerId: 'apple.com', uid: 'apple-456', email: 'hidden@privaterelay.appleid.com'};
  for (const providerData of [googleUser.providerData, [apple], [...googleUser.providerData, apple]]) {
    const identity = toIdentity({...googleUser, providerData});
    assert.equal(identity.uid, googleUser.uid);
    assert.deepEqual(identity.providers, providerData.map(entry => entry.providerId));
    assert.equal('sub' in identity, false);
  }
});

test('the Firebase profile wins, with provider details as fallbacks', () => {
  assert.equal(toIdentity(googleUser).displayName, 'Fallback Name');
  assert.equal(toIdentity(googleUser).photoURL, 'https://example.com/a.jpg');
  assert.equal(toIdentity({...googleUser, displayName: null}).displayName, 'Person Example');
});

test('Apple users can have a relay email and no name or photo', () => {
  const user = {uid: 'apple-user', email: 'hidden@privaterelay.appleid.com', emailVerified: true,
    providerData: [{providerId: 'apple.com', uid: 'apple-456'}]};
  assert.deepEqual(toIdentity(user), {uid: 'apple-user', providers: ['apple.com'],
    email: user.email, emailVerified: true, displayName: null, photoURL: null});
});

test('missing provider details do not invalidate a Firebase user', () => {
  assert.equal(toIdentity({uid: 'user'}).uid, 'user');
  assert.deepEqual(toIdentity({uid: 'user', providerData: [null, {}]}).providers, []);
});

test('missing or invalid Firebase UID fails instead of falling back to Google', () => {
  for (const uid of [undefined, '', 123, 'a'.repeat(129)]) {
    assert.throws(() => toIdentity({...googleUser, uid}), {name: 'IdentityError', code: 'unknown'});
  }
  assert.throws(() => toIdentity({...googleUser, isAnonymous: true}), {name: 'IdentityError'});
});

test('linking conflicts explain how to recover without silently merging accounts', () => {
  assert.equal(mapErrorCode('auth/account-exists-with-different-credential'), 'account-exists');
  assert.equal(mapErrorCode('auth/credential-already-in-use'), 'already-linked-elsewhere');
  assert.match(messageForCode('already-linked-elsewhere'), /not been merged/);
});

test('signed out maps to null rather than throwing', () => {
  assert.equal(toIdentity(null), null);
  assert.equal(toIdentity(undefined), null);
});

test('provider error codes collapse to our own set, unknown ones included', () => {
  assert.equal(mapErrorCode('auth/popup-blocked'), 'popup-blocked');
  assert.equal(mapErrorCode('auth/popup-closed-by-user'), 'cancelled');
  assert.equal(mapErrorCode('auth/network-request-failed'), 'network');
  // Anything unrecognised must not leak the raw provider string outward.
  assert.equal(mapErrorCode('auth/some-future-code'), 'unknown');
  assert.equal(mapErrorCode(undefined), 'unknown');
});

test('every mapped code has a human message', () => {
  // Iterates the exported set, not a copy of it: a new code added to the map
  // without a message would otherwise pass unnoticed.
  for (const code of IDENTITY_ERROR_CODES) {
    assert.match(messageForCode(code, 'example.test'), /\S/, `no message for ${code}`);
  }
  assert.equal(messageForCode('not-a-real-code'), messageForCode('unknown'));
});

test('IdentityError carries a code', () => {
  const error = new IdentityError('network', 'nope');
  assert.equal(error.code, 'network');
  assert.equal(error.name, 'IdentityError');
  assert.ok(error instanceof Error);
});

test('configuration faults do not collapse into the generic retry message', () => {
  // An unauthorized host is the single most likely first-deploy failure, and
  // "please try again" is the one answer that is certainly wrong for it.
  assert.equal(mapErrorCode('auth/unauthorized-domain'), 'domain-not-allowed');
  assert.equal(mapErrorCode('auth/operation-not-allowed'), 'provider-disabled');
  assert.equal(mapErrorCode('auth/api-key-not-valid'), 'misconfigured');
  for (const code of ['provider-disabled', 'misconfigured']) {
    assert.doesNotMatch(messageForCode(code), /try again/i, `${code} must not suggest a retry`);
  }
});

test('names the host in the unauthorized-domain message, without reading the DOM', () => {
  assert.match(messageForCode('domain-not-allowed', 'staging.example.test'), /staging\.example\.test/);
  // No hostname supplied is still a sentence, not "undefined".
  assert.doesNotMatch(messageForCode('domain-not-allowed'), /undefined/);
});

test('email link errors collapse to codes a person can act on', () => {
  assert.equal(mapErrorCode('auth/invalid-email'), 'invalid-email');
  assert.equal(mapErrorCode('auth/expired-action-code'), 'link-invalid');
  assert.equal(mapErrorCode('auth/invalid-action-code'), 'link-invalid');
  assert.equal(mapErrorCode('auth/too-many-requests'), 'rate-limited');
  assert.match(messageForCode('link-invalid'), /new one/);
});

test('recognises a sign-in link landing, and strips it once used', () => {
  const landing = 'https://upscales.app/account/?next=%2Ffree-upscale%2F%3Fmode%3Drestore'
    + '&apiKey=AIza&oobCode=CODE123&mode=signIn&lang=en';
  assert.equal(looksLikeEmailLink(landing), true);
  assert.equal(looksLikeEmailLink('https://upscales.app/account/?mode=signIn'), false, 'no code, no link');
  assert.equal(looksLikeEmailLink('https://upscales.app/account/'), false);
  // ?next= survives, so finishing sign-in still returns to the tool.
  assert.equal(withoutEmailLinkParams(landing), '/account/?next=%2Ffree-upscale%2F%3Fmode%3Drestore');
});

