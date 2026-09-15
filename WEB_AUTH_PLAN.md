# Website sign-in (Firebase Auth) — Phase 0 plan

Status: Phase 0 implemented. Phase 1 (credits + billing) designed below, not built.
Worktree: `UpscaleWebsite-web-auth`, branch `web-auth`, based on `main` @ `1baa444`.
Audience: the agent implementing it.

## 1. What this is, and how it relates to AUTH_PLAN.md

`AUTH_PLAN.md` (in the repo root, untracked) is the agreed end-state design for
the whole system: Firebase identity, `auralens-server` as source of truth,
Firestore persistence, Stripe billing, and a later mobile-linking phase.

**This plan is deliberately a smaller slice than that one.** It adds only the
sign-in surface on the website:

- Firebase Auth on a standalone page, not linked from anywhere on the site.
- No `auralens-server` calls. No Stripe. No entitlement. No gating.
- No native app work.
- No user records of our own, anywhere.

Call it Phase 0: prove sign-in works on the website and get the seams right, so
Phase 1 of `AUTH_PLAN.md` (backend, entitlement, billing) can be built on top
without rework. Every decision below is checked against that document; where it
narrows something, it says so.

## 2. Fixed decisions

| # | Decision |
|---|---|
| D1 | The page lives at `/account/`, authored as `static/account/index.html`. `build.py`'s `copy_static()` unwraps `static/` into the site root verbatim, so it needs no template, no localization, and no change to `build.py`. |
| D2 | The page is `noindex, nofollow`, absent from `sitemap.xml`, and linked from nothing. Entry points come later, as a separate decision. |
| D3 | Firebase JS SDK is loaded from Google's `gstatic` CDN at a pinned version, not self-hosted. See §4 for why "just download the files" does not work here. |
| D4 | Exactly one module — `identity.js` — is allowed to import Firebase. Every other file talks to our own provider-agnostic API. This is the anti-lock-in seam and the single most important rule in this plan. |
| D5 | The app models its own `Identity` shape. `google_sub` is captured as a first-class field. `firebase_uid` is never used as an application key, stored, logged, or put in a URL. (`AUTH_PLAN.md` §3 — this is what makes leaving Firebase cheap.) |
| D6 | Google sign-in only in this phase. Apple is deferred (§9). |
| D7 | `signInWithPopup`, not `signInWithRedirect`. See §5 — redirect has a third-party-cookie problem that costs real infrastructure to solve. |
| D8 | No Firestore, no user documents, no client-side writes to anything. Firebase Auth is the only place identity lives in this phase. |
| D9 | The Firebase web config (`apiKey`, `authDomain`, `projectId`, …) is public by design and belongs in the committed source. It is not a secret. Protection comes from Firebase authorized domains plus API-key referrer restrictions, not from hiding it. |
| D11 | Identity lives in **`upscaler-e9010`** — the existing mobile Firebase project — not in `auralens-472014` as `AUTH_PLAN.md` §3 assumed. Two reasons. It is already the app's project (`GoogleService-Info.plist` binds the iOS app to it) and an app can only belong to one, so putting web identity elsewhere would quietly foreclose mobile sign-in later. And `auralens-472014` is on a different Google account that this one cannot even list. The rationale `AUTH_PLAN.md` gave for co-locating — "no cross-project setup" — turns out to be weak: see D12. |
| D12 | Cross-project token verification is nearly free, so it does not constrain where identity lives. A Firebase ID token is a plain JWT with `iss = https://securetoken.google.com/<projectId>` and `aud = <projectId>`, signed by Google with certificates at a public endpoint. Verifying one from another project needs the project ID string and nothing else — no service account, no IAM grant. Credentials are only needed for Admin SDK powers *beyond* verification (user management, custom claims, `checkRevoked`), none of which Phase 0 or the credits work uses. |
| D13 | Analytics is deliberately **not** wired up. `measurementId` is omitted from `firebase-config.js` so `getAnalytics()` cannot be called by accident — starting visitor tracking on the website is a separate decision needing the §11 privacy update first. |
| D10 | `build/build.py` stays stdlib-only, and the site build stays `python3 build/build.py` with no node step. This mirrors `docs/albums-plan.md` D13, where the album CLI's dependencies were kept out of the site build for the same reason. |

## 3. Where the code goes

```
static/account/
  index.html            signed-out and signed-in states, noindex
  account.css           page styling (reuses site.css tokens)
  account.js            page controller: renders state, wires buttons
  identity.js           THE ONLY file that imports Firebase
  identity-model.js     pure functions: provider claims -> our Identity shape
  firebase-config.js    the public web config, one file, one export
tests/account/
  identity-model.test.js  node --test, pure, no network
```

Nothing else in the repo changes. No `build.py` edit, no new npm dependency at
the repo root, no Worker route.

Why `static/` rather than a `build.py` template: the page is single-locale,
unlisted, and app-like rather than content-like. `/lab/` and `/upscale/` on the
`browser-photo-guard-preview` branch are the same shape and live in `static/`
for the same reason.

## 4. SDK delivery, and why it is not self-hosted

The obvious instinct is to download `firebase-app.js` and `firebase-auth.js`
and commit them, keeping everything first-party. **That does not work**, and it
fails silently, so it is worth stating precisely.

`firebase-auth.js` on gstatic begins with:

```js
import{_getProvider,...}from"https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"
```

The import target is an **absolute URL back to gstatic**, not a relative path.
Serving a downloaded copy from our own domain still fetches `firebase-app.js`
from Google at runtime. Self-hosting for real needs one of:

- npm + a bundler (esbuild/vite) producing a genuinely self-contained ESM file —
  which puts node in the site build and breaks D10; or
- downloading and rewriting that absolute URL — brittle, silently re-breaks on
  every version bump.

So: load both modules from gstatic at a pinned version (D3). The privacy delta
is small in any case — Firebase Auth talks to `identitytoolkit.googleapis.com`
and `securetoken.googleapis.com` at runtime regardless of where its JS came
from, so self-hosting the script would not have made sign-in first-party.

If self-hosting becomes worth it later (CSP tightening, CDN independence), the
clean route is a separate out-of-band build step that commits a bundled vendor
file, in the same spirit as the album CLI's own venv — keeping it out of
`build.py`.

## 5. Popup, not redirect

`signInWithRedirect` is the better mobile UX and would normally be the default.
It is not the default here because Firebase's redirect flow relies on the
`__/auth/handler` page on the `authDomain` — `<project>.firebaseapp.com` — and
reading state back across that origin depends on third-party cookies, which
Safari's ITP already blocks and Chrome has been phasing down. The supported fix
is to serve the auth handler from our own domain, which means proxying
`/__/auth/*` through the Worker and setting `authDomain: "upscales.app"`.

That is entirely feasible — the Worker already fronts the whole site and owns
routing — but it is infrastructure work in service of a page nobody can reach
yet. So: popup now, and if mobile popup UX turns out to be the blocker when
real entry points are added, do the Worker proxy then. The switch is confined
to `identity.js` plus one Worker route; nothing else in the plan depends on it.

## 6. The seam: `identity.js`

This is the contract the rest of the page codes against. It must not leak a
single Firebase type, name, or concept past this boundary.

```js
// identity.js — the only file importing Firebase.
export async function signInWithGoogle()        // -> Identity;  throws IdentityError
export async function signOut()                 // -> void
export function onIdentityChanged(listener)     // (Identity | null) => void; returns unsubscribe
export function currentIdentity()               // -> Identity | null  (synchronous, may be stale)
export async function getAccessToken()          // -> string  (opaque bearer, refreshed by the provider)
```

Rules that make this a real seam rather than a nominal one:

- `getAccessToken()` returns an **opaque string**. No caller parses it, inspects
  claims from it, or assumes it is a Firebase token. Its only job is to become
  an `Authorization: Bearer` header when a backend exists.
- `IdentityError` is ours, with a small stable set of `code`s
  (`popup-blocked`, `cancelled`, `network`, `unknown`). Firebase error codes get
  mapped to those inside `identity.js` and never escape it.
- No other file imports from `gstatic` or references `firebase` in any form.
  A grep for `firebase` outside `identity.js` and `firebase-config.js` should
  return nothing — worth an actual check in review.

### The Identity shape

```js
{
  provider: "google.com",
  sub: "1078…",          // the Google account's stable subject claim
  email: "a@b.com",
  emailVerified: true,
  displayName: "…" | null,
  photoURL: "…" | null,
}
```

Note what is **absent**: the Firebase UID. It is not in the shape, so it cannot
accidentally become a key. `sub` is the durable identifier — the same value
Google would return if we verified its tokens directly tomorrow, with no
Firebase in the path. That is the whole basis of the migration story in §10, and
it matches `AUTH_PLAN.md` §3's "never use `firebase_uid` as a primary key".

Extracting `sub` correctly is the one piece of real logic here: it comes from
the ID token's `firebase.identities["google.com"][0]` claim (or equivalently
`providerData[].uid`), **not** from `user.uid`. That mapping lives in
`identity-model.js` as a pure function so it can be tested without a browser or
a network (§8).

## 7. What the page does

Two states, one page, no routing.

**Signed out** — a short explanation that this is an early sign-in preview, one
"Continue with Google" button, and the existing privacy line. On success the
page swaps to the signed-in state; on failure it shows a mapped, human error
(popup blocked reads differently from network failure).

**Signed in** — email, display name and avatar if the provider gave them, and a
"Sign out" button. Nothing else: there is no entitlement to show, no
subscription, and no account data of ours to display, because none of that
exists yet in this phase. Resisting the urge to invent placeholder account UI
here is deliberate — it would be UI for a data model that hasn't been designed.

State is restored on load via `onIdentityChanged`, so a returning signed-in user
lands directly in the signed-in state. Firebase's SDK owns session persistence
and silent token refresh; we add no session of our own, consistent with
`AUTH_PLAN.md` §3's "no custom session/JWT".

## 8. Testing

`identity-model.js` holds the claims→Identity mapping as pure functions, tested
with `node --test tests/account/*.test.js` — no dependencies, no network, no
browser, so it does not pull anything into the site build. Cover at minimum:

- a well-formed Google token payload maps to the right `sub`, not `user.uid`;
- a payload missing `firebase.identities` fails loudly rather than silently
  producing an Identity with an undefined `sub`;
- Firebase error codes map onto our `IdentityError` codes, with unknown codes
  falling through to `unknown` rather than leaking the raw string.

The sign-in flow itself (popup, real Google account) is verified by hand on the
deployed preview — it needs a real browser and a real Google account, and
mocking it would test the mock.

## 9. Console setup (a human has to do this)

None of this is code, and the implementation is blocked on it:

1. Decide the Firebase project. `AUTH_PLAN.md` §3 assumes GCP `auralens-472014`
   so the backend can later verify tokens with no cross-project setup — this
   plan should use the same project for that reason, but **confirm it exists and
   has Firebase Auth enabled** before building against it.
2. Register a Web App in that project; copy its config into
   `firebase-config.js`.
3. Enable the Google sign-in provider.
4. Add authorized domains: `upscales.app`, plus whatever preview hostname the
   branch deploys to. Sign-in fails on any domain not in this list.
5. Restrict the browser API key to those referrers.

**Apple sign-in is deferred (D6)** because it is not just a toggle: it needs an
Apple Developer Services ID, a key, and a verified return URL, and `AUTH_PLAN.md`
wants it eventually. Adding it later touches only `identity.js` and one button.

## 10. What is and isn't locked in

The point of §6 is that leaving Firebase costs one file. Concretely, migration
looks like: reimplement `identity.js` against Google's OIDC endpoints directly
(or Auth.js, Clerk, Ory, WorkOS — the seam doesn't care), keep the same five
exports and the same `Identity` shape, and match existing users by `sub`, which
is Google's identifier and unchanged by the move. No other file is touched, and
no stored data has to be rewritten, because in this phase we store nothing.

Things that *would* create lock-in, listed so they don't get added casually:

- Keying anything on `user.uid` — the reason D5 exists.
- Firebase **custom claims** for application state (entitlement, roles). They
  live inside the Firebase token and have no equivalent elsewhere; that state
  belongs in the backend's own store per `AUTH_PLAN.md` §3.
- **Firestore security rules as the authorization layer.** Rules are not
  portable; authorization belongs in code the backend owns.
- Anonymous accounts and account-linking, whose semantics are Firebase-specific.
- Firebase Hosting-specific auth helpers — irrelevant here anyway, since the
  site is served by the Cloudflare Worker.

The token choice is not a lock-in risk: a Firebase ID token is a standard JWT
signed by Google, so a future backend can verify it with Google's public keys
without the Admin SDK if it ever wants to.

## 11. Privacy copy

`localization/legal.json` already lists Firebase as a subprocessor, but for
app analytics, crash reporting and performance — not authentication, and not on
the website. Once this page is reachable by real users, that wording needs
extending across all six locales. It is **not** needed while the page is
unlinked and `noindex`, but it is a hard gate on adding entry points later.
Flagging it here so it doesn't get discovered at launch.

## 12. Sequence

1. Console setup (§9) — blocks everything.
2. `firebase-config.js`, `identity-model.js` + its tests. Pure, no browser.
3. `identity.js` against the contract in §6.
4. `static/account/index.html` + `account.css` + `account.js` — both states.
5. Verify by hand: sign in, reload (state restores), sign out, popup blocked,
   offline. Check the `firebase` grep from §6 comes back clean.
6. Deploy the branch to a preview host, add that hostname to Firebase authorized
   domains, and re-verify sign-in there — sign-in cannot be fully verified
   locally, since authorized domains are checked against the real origin.

## 13. Open questions

- **Firebase project**: confirm `auralens-472014` is right and Auth is enabled.
- **Page path**: `/account/` assumed. `/sign-in/` is the alternative if the page
  should read as an action rather than a place — worth settling now, since
  changing it later means a redirect.
- **Apple sign-in**: confirmed as deferred, or wanted in this phase after all?
- **Preview hosting**: the `browser-photo-guard-preview` branch deploys to a
  Cloudflare Pages project (`uscale-photo-preview`). Reuse that pattern for this
  branch, or deploy the Worker to a preview environment instead? This decides
  which hostname goes into Firebase authorized domains in §9.4.

---

# Phase 1 — credits and billing (designed, not built)

This supersedes `AUTH_PLAN.md`'s subscription framing: the model is **prepaid
credits**, not a recurring subscription, and there is no mobile track.

## P1.1 The question that decides the architecture

Not "GCP or Cloudflare" — **where the debit happens relative to the money being
spent.** The expensive act is the Replicate/Wavespeed call inside
`auralens-server` (`/creative-upscale`, `/restore-image`, `/edit-flux-*`). The
balance check and debit have to be enforced at that moment. Put the ledger
anywhere else and every job becomes a distributed transaction across two clouds
on the hot path.

## P1.2 Options considered

| | Ledger location | Hot-path cost |
|---|---|---|
| A | `auralens-server` + Firestore | local transaction, same process |
| B | Cloudflare Worker + D1, server calls it per job | cross-cloud hop, shared secret, split-brain cases |
| B′ | Cloudflare issues a short-lived signed voucher; server verifies offline and settles async | no hot-path hop, but a hand-rolled capability-token protocol plus settlement reconciliation |
| C | Metering vendor (Orb / Lago / Stripe meters) | overkill at this stage |

**Chosen: A.** The debit is a local Firestore transaction in the same process
that calls Replicate; the Admin SDK verifies the ID token in the same place;
`google-cloud-storage` is already a dependency so GCP credentials are wired.
The real cost is that `auralens-server` stops being stateless, which is
currently a genuine virtue of it.

B′ is the strongest version of the Cloudflare idea and worth revisiting if
statelessness becomes load-bearing — it keeps the server stateless and avoids
the hop, at the price of building voucher signing, key rotation and settlement
reconciliation.

## P1.3 Corrections to earlier assumptions

- **We do not store payment methods. Stripe does.** We store a
  `stripe_customer_id` string next to the user and nothing else. Card details
  never touch our infrastructure; Checkout / the Payment Element keep us in PCI
  SAQ-A. Repeat top-ups charge the Customer's saved PaymentMethod server-side by
  ID.
- **Firestore is not the risk; client-authored balances are.** With rules
  `allow read: if request.auth.uid == uid; allow write: if false`, and all
  writes going through the Admin SDK (which bypasses rules), Firestore is a
  perfectly safe ledger. The invariant is: balance mutations originate only from
  a Stripe webhook or from the processing service. That is equally true of D1 or
  Postgres — it is not a property of Firestore.

## P1.4 Authorization shape

Mobile keeps `X-Signature` untouched. Web sends
`Authorization: Bearer <Firebase ID token>`, verified per request.

Web endpoints go on **their own route prefix** (`/web/v1/…`) rather than
sniffing headers on the shared routes: different auth, different quota
semantics, different rate limits, and it structurally prevents a web token
reaching a route with no credit check.

## P1.5 The parts that bite later

- Credits are granted **only** by the Stripe webhook, never by the browser
  reporting success — and keyed on the Stripe event ID, because replays are
  routine rather than exceptional.
- Concurrent requests double-spending: a read-then-write balance check is wrong,
  this needs a real transaction.
- Debit-then-fail: choose explicitly between reserve→settle/refund and
  debit-up-front-refund-on-failure. Skipping this decision is how free GPU time
  gets given away.
- Client retries need an idempotency key, or a retry double-charges.
- Refunds and chargebacks: decide whether balance may go negative.

## P1.6 Prerequisite that is not code

`auralens-472014` is on a different Google account and is **not accessible from
`azat.zulkarnyaev@gmail.com`** (`gcloud projects describe` returns permission
denied). Everything in Phase 1 — enabling Firestore, adding Stripe secrets,
deploying — happens inside that project. Access has to be sorted before this
phase starts. Phase 0 was unblocked by this only because it touches nothing on
the server.
