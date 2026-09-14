# Cloud tools on the website — plan

Branch: `web-cloud-tools` (off `web-auth`). Nothing here ships to production
until it is finished: backend and infrastructure may deploy, user-facing screens
may not.

## What we are building

The `/free-upscale/` page gains paid cloud modes next to the free on-device one:

| Mode | Runs on | Cost | Options (mirroring iOS) |
|---|---|---|---|
| Upscale | this device | free | Photo / Drawing, 2× / 4×, enhance faces |
| Creative upscale | auralens → WaveSpeed upscaler | credits, by resolution | Creativity (5 steps), Resolution 2K / 4K / 8K |
| Restore | auralens → WaveSpeed Flux 2 or Replicate | credits, by mode | Mode (Restore, Restore & Colorize, Enhanced Colorize, Advanced Fix), Negative, Increased resolution, Prompt |

Paid results are saved to the user's history until they delete them.

## UX decisions

1. **One page, not a separate mode page.** A three-tile switcher sits above the
   photo card: *Upscale · Free*, *Creative upscale · Pro*, *Restore · Pro*, each
   with a one-line description. Picking a tile swaps the card's badge, options
   and button in place, and keeps the chosen photo. Deep links: `?mode=creative`
   and `?mode=restore`. A separate page would add a click and a page load for a
   three-way choice, and lose the photo when switching.
2. **Credits chip** (coin icon and balance) in the card heading once signed in.
   Signed out, the Pro tiles show "Sign in" instead.
3. **Signing in happens inline.** Choosing a Pro tile while signed out replaces
   the options with a Google sign-in panel inside the card, so the photo and
   selection survive. No redirect to `/account/`.
4. **Cloud badge instead of Private.** Cloud modes drop every "stays on your
   device" line and show a Cloud processing badge.
5. **The process button carries the price**: "Restore · 20 credits".
6. **Not enough credits** opens a top-up sheet on the same page ("This needs 20
   credits and you have 5"), reusing the account page's amount picker. The photo
   is kept in IndexedDB across the Stripe redirect and restored on return, with
   the same mode and options.
7. **Processing** reuses the status block with an indeterminate bar and elapsed
   time; cloud jobs report no real progress.
8. **Result** reuses the comparison viewer, plus "Saved to your history".
9. **History** is a section of `/account/`: a thumbnail grid opening the gallery
   viewer (comparison, download, delete).

## Details the brief did not cover

- **Provider result links expire** (Replicate after about an hour), so the worker
  copies each result into R2 straight away, with the original for comparison.
- **History images are private.** An `<img>` cannot send a bearer token, so media
  is served through short-lived signed URLs the worker issues.
- **Deletion**: per item from history, and everything on account deletion.
- **Privacy policy** currently says results are not kept; it must describe the
  history, in all six locales.
- **Pricing per option**: restore modes use different models and upscale cost
  scales with resolution, so each needs its own credit price, checked against
  the 50% margin floor.
- **auralens**: PR #4 accepts the website key on `/creative-upscale` and
  `/restore-image` only. Restore, Restore & Colorize and Enhanced Colorize call
  `/edit-flux-2-dev` and `/edit-flux-2-pro`, which need the key too.
- **Large photos**: iOS splits creative upscales into tiles on the device. The
  web starts with a size cap and a single request; browser tiling can follow.
- **Negative** restoration inverts the photo before upload, as iOS does, in the
  browser.
- **Localization**: the tool page is in six languages, so every new string is
  too. The account page is English-only for now.
- **Abuse and cost**: upload size cap, per-account rate limit, and a per-account
  history storage cap.
- **Ultimate upscale** is priced in the worker but iOS does not offer it; it
  stays out of the UI.

## Phases

1. **Backend**: per-option price table and margin tests; operation schemas in the
   worker; result copy to R2; history API (list, signed media, delete); auralens
   key on the Flux 2 endpoints.
2. **Page refactor**: mode switcher and config-driven card; on-device behaviour
   unchanged; account widgets (sign-in, balance, amount picker) extracted from
   `/account/` for reuse.
3. **Cloud flow**: inline sign-in, per-mode options, priced button, top-up sheet
   with photo persistence, processing, result.
4. **History** on `/account/`, reusing the gallery viewer.
5. **Finish**: privacy text, six-locale strings, staging end-to-end test with
   real processing once auralens is deployed.

## Pricing (proposal, needs approval)

WaveSpeed publishes base prices only and says larger outputs cost more, without
a formula. Prices below keep the 50% margin floor at the cheapest credit rate
($40 pack, 0.83 cents per credit, after Stripe) with about 2x headroom over the
base price. Recheck against the per-job charges WaveSpeed records once real
traffic exists.

Floor: credits >= provider cost in cents / 0.386.

| Option | Provider and base price | Floor | Proposed |
|---|---|---|---|
| Creative upscale 2K / 4K | WaveSpeed image-upscaler, $0.01 | 3 | 5 |
| Creative upscale 8K | same model, larger output | ~10 | 15 |
| Restore | WaveSpeed Flux 2 dev edit, $0.024 | 7 | 15 |
| Restore & Colorize | WaveSpeed Flux 2 dev edit, $0.024 | 7 | 15 |
| Enhanced Colorize | WaveSpeed Flux 2 pro edit, $0.06 | 16 | 35 |
| Advanced Fix | Replicate restore-image, ~$0.055 | 15 | 20 |
| Increased resolution | larger Flux output | — | +10 |

Creativity and the optional prompt do not change the provider price (prompt
improvement is a fraction of a cent).

## Progress

Done on `web-cloud-tools`, deployed to staging only:

1. **Backend**: option-based prices with an exhaustive 50% margin test;
   `/api/cloud/creative` and `/api/cloud/restore` routed as the iOS app routes
   them; results copied to the private `uscale-user-media` bucket; history list,
   signed image links and delete; three running jobs and 2 GB of history per
   account; a cron that refunds jobs whose request died.
2. **Page**: mode picker (Upscale · Creative upscale · Restore) with shared
   photo, status and result viewer; per-mode options, heading and badge;
   priced button; in-card sign-in (via a window on `/account/`, since the
   page's cross-origin isolation breaks Firebase's popup) and top-up (checkout
   in a new tab, photo kept).
3. **Account page**: option prices, price-key labels in activity, history grid
   with a before/after viewer, download and delete; sign-in window mode.
4. **Privacy policy**: history retention described in all six locales.
5. **auralens** PR #4: tool key accepted on all four endpoints the modes use.

## Remaining

- Merge and deploy auralens PR #4; nothing cloud runs end to end until then.
- End-to-end test on staging with a real sign-in, purchase and processing run
  in each mode (needs a person to sign in).
- Account deletion (the privacy policy promises it on request by email today).
- Browser-side tiling for creative upscale of photos over 4096 px.
- Recheck credit prices against WaveSpeed's per-job charges once traffic exists.
- Production: create the `uscale-user-media` bucket, set `MEDIA_SIGNING_KEY`,
  apply migration 0004, and decide when the screens ship.
