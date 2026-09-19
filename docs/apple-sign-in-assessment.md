# Apple sign-in through the existing Firebase project

Assessed 19 September 2026 against `web-cloud-tools` at `3eb63ca`.
This is an assessment; Apple sign-in has not been enabled or implemented.

## Verified current state

- The website uses Firebase project `upscaler-e9010`, also used by the mobile app.
- A live, read-only Identity Toolkit API query returned only `google.com`, enabled.
- Authorized domains already include `upscales.app`, `www.upscales.app`,
  `upscaler-e9010.firebaseapp.com`, `upscaler-e9010.web.app`, `localhost`, and
  `uscale-site-staging.sharrikk.workers.dev`.
- The current local Google Cloud account has `firebaseauth.configs.get` and
  `firebaseauth.configs.update`, confirmed with `testIamPermissions`.
- Both Firebase CLI and Google Cloud CLI are installed and authenticated.
  The installed Firebase CLI exposes user import/export but no provider-config command.
- No remote configuration was changed during this assessment.

## What I can do

1. Implement the Apple button and `signInWithApple()` in the existing Firebase
   adapter using `OAuthProvider('apple.com')`, with email/name scopes. Keep
   Firebase-specific code confined to `static/account/identity.js`.
2. Generalize the identity model, provider-specific error messages, fixtures,
   backend account lookup, and tests. Support missing names/photos and Apple's
   private relay addresses. Apple supplies a name only on initial authorization.
3. Migrate the account identity storage while preserving account IDs, Stripe
   customers, credits, free-use counts, and history. See the migration below.
4. Configure and enable Apple's provider via the Identity Toolkit REST API,
   authenticated using the existing CLI login, once the Apple credentials exist.
   No Firebase Console work is necessary from you for this part.
5. Check authorized domains, implement the sign-in/cancellation/error flows,
   and test desktop and mobile browsers. A real Apple sign-in still requires
   you to complete the Apple account authentication/2FA.

## What you need to supply or complete on Apple's side

Use an Apple Developer team with permission to manage Certificates, Identifiers
& Profiles. Firebase credentials cannot administer that Apple account.

1. Confirm the existing UScale primary App ID and team; enable Sign in with
   Apple on that App ID if necessary. Reuse the intended app grouping so web
   and native Apple identities can align later.
2. Create or reuse a **Services ID** for web sign-in, associated with that
   primary App ID. This Services ID becomes Firebase's OAuth `clientId`.
3. Register `upscaler-e9010.firebaseapp.com` as the authentication domain and
   this exact return URL:

   `https://upscaler-e9010.firebaseapp.com/__/auth/handler`

   Include the website domains in Apple's web configuration where applicable.
4. Create or reuse a Sign in with Apple private key for the primary App ID.
   Supply the **Team ID**, **Services ID**, **Key ID**, and a secure local path
   to the downloaded **`.p8` private key**. The private key belongs only in
   Firebase's server-side provider configuration, never in browser code or Git.
5. If Firebase or another service will email Apple relay addresses, register
   the relevant sender/domain with Apple's private email relay. For default
   Firebase auth emails this is `noreply@upscaler-e9010.firebaseapp.com`.

I can assist with the Apple setup using an authorized Apple session, but the
Firebase API/CLI cannot create those Apple resources. Existing Apple-side
configuration has not been inspected in this task.

## Why this is more than another button

`static/account/identity-model.js` rejects users without `google.com` provider
data. `worker/src/auth.ts` rejects Firebase tokens without a Google subject.
`worker/src/accounts.ts` and the original accounts migration require a unique,
non-null `google_sub`. Multiple routes in `worker/src/index.ts` depend on it.
Simply enabling Apple would therefore still prevent Apple-only users from
using their account, credits, history, and processing features.

Recommended migration: add an `account_identities` table with a unique
`(provider, subject)` key pointing to the existing `accounts.id`; backfill
Google identities, and remove the requirement that every account contain a
Google subject. Retain the project's deliberate provider-independent account
ID design. Do not replace existing account IDs with Firebase UIDs or synthetic
Google IDs. Plan the D1 migration and rollback before deployment.

For people using both providers, linking must preserve one credit balance.
Do not merge accounts on matching email alone; use verified credentials and
explicit linking consent, including Apple's anonymized-data requirements.
Two existing funded accounts require a deliberate conflict/merge policy.

Keep popup sign-in initially, matching the current architecture. If mobile
testing requires redirect sign-in, account for Firebase's cross-origin storage
restrictions and preservation of the selected photo; switching to redirects
without that work can lose state or fail in privacy-restrictive browsers.

## API configuration details

The existing read endpoints are:

- `GET https://identitytoolkit.googleapis.com/v2/projects/upscaler-e9010/defaultSupportedIdpConfigs`
- `GET https://identitytoolkit.googleapis.com/admin/v2/projects/upscaler-e9010/config`

Use `Authorization: Bearer <CLI access token>` and
`x-goog-user-project: upscaler-e9010` (required by the local Google Cloud login).
Keep tokens and private keys out of output and command history.

Create `apple.com` through `defaultSupportedIdpConfigs.create` if absent,
or use `patch` with an explicit update mask if it already exists. Set:

- `enabled: true`
- `clientId: <Apple Services ID>`
- `appleSignInConfig.codeFlowConfig.teamId: <Team ID>`
- `appleSignInConfig.codeFlowConfig.keyId: <Key ID>`
- `appleSignInConfig.codeFlowConfig.privateKey: <contents of .p8>`

Preserve any existing mobile bundle IDs and unrelated provider settings. The
native Apple provider config accepts the private key directly; do not build
an ad hoc client-secret rotation mechanism into the website.

## Scope and validation

This is a moderate authentication/backend change, with account migration and
linking as the main complexity. A planning estimate is 1–2 engineering days
after credentials are ready for basic Apple sign-in, migration, and browser
checks; merging existing accounts or adding reliable redirects is additional
scope. This is an estimate, not a measured delivery commitment.

Validate existing Google accounts and balances after migration, new Apple
users, repeat sign-in, Hide My Email, missing name/photo, popup cancellation,
disabled provider errors, rejected invalid tokens, and account-link conflicts.
Deploy schema/backend support before exposing the Apple button.

## Sources

- [Firebase: Apple authentication for web](https://firebase.google.com/docs/auth/web/apple)
- [Identity Toolkit provider configuration API and Apple fields](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects.defaultSupportedIdpConfigs)
- [Apple: configure Sign in with Apple for the web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web)
- [Apple: create a Sign in with Apple private key](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key)
- [Google sign-in branding guidelines](https://developers.google.com/identity/branding-guidelines)
