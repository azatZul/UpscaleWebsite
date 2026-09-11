import test from 'node:test';
import assert from 'node:assert/strict';
import {IdentityError, mapErrorCode, messageForCode, toIdentity} from '../../static/account/identity-model.js';

const googleUser = {
  uid: 'FIREBASE_UID_MUST_NOT_BE_USED',
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

test('identity is keyed on the Google subject claim, never the Firebase uid', () => {
  const identity = toIdentity(googleUser);
  assert.equal(identity.sub, '107712345678901234567');
  assert.equal(identity.provider, 'google.com');
  // The whole migration story depends on this: the Firebase uid must not appear
  // anywhere in the shape, under any key.
  assert.ok(!Object.values(identity).includes(googleUser.uid));
  assert.equal('uid' in identity, false);
});

test('provider fields win over the top-level fallbacks, which still apply', () => {
  const identity = toIdentity(googleUser);
  assert.equal(identity.displayName, 'Person Example');
  assert.equal(identity.photoURL, 'https://example.com/a.jpg');
  const sparse = {...googleUser, providerData: [{providerId: 'google.com', uid: '1', displayName: null}]};
  assert.equal(toIdentity(sparse).displayName, 'Fallback Name');
  assert.equal(toIdentity(sparse).email, 'person@example.com');
});

test('a missing Google identity fails loudly instead of yielding an undefined sub', () => {
  assert.throws(() => toIdentity({uid: 'x', providerData: []}), {name: 'IdentityError', code: 'unknown'});
  assert.throws(() => toIdentity({uid: 'x', providerData: [{providerId: 'apple.com', uid: 'a'}]}),
    {name: 'IdentityError', code: 'unknown'});
  // A provider entry with no uid is just as unusable as no entry at all.
  assert.throws(() => toIdentity({uid: 'x', providerData: [{providerId: 'google.com'}]}),
    {name: 'IdentityError', code: 'unknown'});
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
  for (const code of ['popup-blocked', 'cancelled', 'network', 'unknown']) {
    assert.match(messageForCode(code), /\S/);
  }
  assert.equal(messageForCode('not-a-real-code'), messageForCode('unknown'));
});

test('IdentityError carries a code', () => {
  const error = new IdentityError('network', 'nope');
  assert.equal(error.code, 'network');
  assert.equal(error.name, 'IdentityError');
  assert.ok(error instanceof Error);
});
