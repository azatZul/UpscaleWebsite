# Firebase identity and Apple sign-in

Updated 20 September 2026. Implemented on
`codex/auth-google-style-apple-assessment`, based on `web-cloud-tools`.

## Staging deployment

Deployed on 20 September 2026 to
`https://uscale-site-staging.sharrikk.workers.dev/account/`, including the latest
pricing changes from `web-cloud-tools` (`8dd7d1a`). Worker version:
`aa0632b6-bc7b-4154-ab10-cd1b699b58e3`.

Migration 0006 and the Firebase UID mapping are applied to all three staging
accounts. A comparison with the pre-migration snapshot confirmed unchanged
account IDs, profile data, Stripe references, and every related table, with
valid foreign keys. A private SQL backup is retained locally under `.tmp/`.
Production was not modified, and Firebase provider settings were not changed.

Validation: 99 worker tests, 23 account tests, TypeScript checking, and the full
preview build passed after merging pricing updates. The deployed auth files
match the tested build; the Google light button renders and Apple is hidden.
Missing/invalid API credentials return 401. Explicit linking was checked with
the local fixture. Live Apple OAuth remains untested until credentials exist.

## Current design

- Firebase project: `upscaler-e9010`, shared with the mobile app.
- One Firebase UID identifies the user across linked Google and Apple providers.
- `accounts.firebase_uid` is a unique authentication lookup. `accounts.id`
  remains our own ID for credits, Stripe, history, and free-use limits.
- The worker verifies the signed Firebase token, project/issuer, expiry, UID,
  and supported sign-in provider. Anonymous/custom sessions cannot create web
  accounts or claim the free-use allowance.
- The browser identity has `uid` and a list of connected `providers`; it handles
  Apple relay email addresses and missing names/photos.
- The backend never joins accounts based on email. Different Firebase UIDs
  remain different accounts, even if their email addresses match.

## Apple is prepared, disabled

Per the user's instruction, `APPLE_SIGN_IN_ENABLED` in
`static/account/firebase-config.js` is **false**. Apple is not configured in
Firebase; the live provider API still lists only Google. The Apple button and
connection controls are hidden. The adapter also refuses disabled providers.

The prepared code uses `OAuthProvider('apple.com')` with name/email scopes and
Firebase popup sign-in. Once enabled, a signed-in user can explicitly connect
Google or Apple in the account page. The explanation next to the buttons makes
clear that connecting a method associates it with the profile, credits, and
history. Firebase performs the linking, then the adapter refreshes the token
and publishes the updated connection status. A credential already attached to
another account produces an actionable error; no account merge is attempted.

For local design/interaction review only, use:
- `/account/?fixture=signed-out&apple` for both buttons.
- `/account/?fixture&apple` for the connection controls.

These fixtures cannot run on a deployed hostname.

## Apple is configured (28 September 2026)

- Services ID `com.graz.upscaler.web`, team `RE82W8HD52`, key ID `34WCRZLAM8`,
  entered in the Firebase console by the owner. The key stays out of Git.
- Checked from outside, with no Apple login: Apple's authorize page names the
  app "UScale" for this Services ID with the Firebase return URL, answers
  `invalid_client` for an unknown ID and `403` for an unregistered return URL.
  Firebase's `accounts:createAuthUri` now returns an Apple URL with
  `client_id=com.graz.upscaler.web` and that return URL.
- A real Apple sign-in with Hide My Email completed in the browser.
- `APPLE_SIGN_IN_ENABLED` is now true on `web-cloud-tools`.

## Remaining Apple setup (original checklist)

The Firebase CLI and Google Cloud CLI are authenticated. The local account has
`firebaseauth.configs.get` and `firebaseauth.configs.update`. Provider settings
can be updated through Identity Toolkit REST using the CLI access token and
`x-goog-user-project: upscaler-e9010`. Firebase/Cloudflare access cannot create
resources in the Apple Developer account.

Before enabling Apple, obtain:
1. An Apple primary App ID with Sign in with Apple enabled, on the intended
   developer team (reuse the native app grouping).
2. A web Services ID associated with that App ID.
3. Team ID, Key ID, and a secure local `.p8` private-key file.
4. Apple's web domain/return URL registration, including:
   - Domain: `upscaler-e9010.firebaseapp.com`
   - Return URL: `https://upscaler-e9010.firebaseapp.com/__/auth/handler`
5. Private email relay sender registration if sending emails to hidden Apple
   addresses. Default Firebase sender: `noreply@upscaler-e9010.firebaseapp.com`.

Then create/update `apple.com` at
`https://identitytoolkit.googleapis.com/v2/projects/upscaler-e9010/defaultSupportedIdpConfigs`:
set `clientId` to the Services ID, and populate
`appleSignInConfig.codeFlowConfig.{teamId,keyId,privateKey}`. Preserve existing
bundle IDs and other provider settings. Keep private keys out of Git/browser
code. Enable the provider, flip the site flag, and verify real Apple sign-in,
repeat sign-in, Hide My Email, cancellation, and explicit linking. This needs
an Apple user to complete authentication/2FA; fixtures cannot verify OAuth.

The existing authorized domains include the production website, Firebase auth
host, localhost, and `uscale-site-staging.sharrikk.workers.dev`.

## Development database transition

Migration `0006_firebase_identity.sql` renames `google_sub` to `firebase_uid`.
It marks pre-existing identifiers with `legacy-google:` so they cannot silently
be interpreted as Firebase UIDs. New accounts use actual Firebase UIDs.

For existing development accounts, look up the old Google subject via the
Firebase admin `accounts:lookup` API (`federatedUserId`, provider `google.com`).
Update the marked identifier to the returned `localId` using the existing
account ID. Do not guess from email. Our three staging accounts all matched
Firebase users during preflight. This preserves their account IDs and related
data without introducing a permanent migration compatibility layer.

Apply the migration and one-time mapping together with the worker update in
staging. Old worker versions expect `google_sub` and cannot run against the new
schema. Before any future production rollout, take a database backup, perform
the same mapping if accounts exist, and deploy the compatible worker. Do not
roll back the worker alone after applying this migration.

Merging two existing Firebase/UScale accounts, unlinking providers, and redirect
sign-in are intentionally outside this change. Redirects need additional
cross-origin storage and photo-state handling on this website.

## References

- [Firebase account linking](https://firebase.google.com/docs/auth/web/account-linking)
- [Firebase Apple authentication](https://firebase.google.com/docs/auth/web/apple)
- [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Provider configuration REST API](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects.defaultSupportedIdpConfigs)
- [Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web)
