# Reddit Ads conversion tracking plan

Date: 14 November 2026. Original research and design. The integration is now implemented; see [current setup and operations](reddit-ads-setup.md) for the delivered behavior and validation requirements. Details below describe the original proposal where they differ from the implementation.

## Recommendation

Use a **Sales campaign with Purchase as the optimization goal**, a Reddit Pixel for the browser funnel, and Reddit Conversions API (CAPI) for confirmed website payments. Report successful upscales as supporting custom events. Start with Standard campaign setup for explicit audience and creative tests; Max can use the same tracking later.

Scope is payments made on this website through Stripe: credit top-ups and album unlocks. App Store / Google Play purchases require an app measurement integration; a website pixel alone will not measure those purchases. The existing root `ATTRIBUTION_PLAN.md` is an older app-install proposal, not evidence of implemented web attribution. This plan follows the current Cloudflare Worker, Firebase authentication, and Stripe code and the configured production domain, `upscales.app`.

## Reddit campaign options

Reddit currently documents these objectives:

| Objective | Optimizes toward | Fit here |
| --- | --- | --- |
| Awareness and consideration | Impressions or engaged video views | Introduce the product; secondary to payment acquisition |
| Traffic | Clicks or landing page visits (beta) | Landing-page testing; payment remains a measured outcome |
| Sales | Purchase, AddToCart, SignUp, Lead, PageVisit; catalog campaigns have fewer choices | Recommended: Purchase, without a catalog |
| Lead generation | Website leads or signups | Relevant if account acquisition becomes the goal |
| App promotion | Installs or supported in-app events | Separate app-store campaign, requiring MMP postbacks |

Source: [Campaign objectives](https://business.reddithelp.com/articles/Knowledge/Ad-campaign-objectives).

Standard provides manual campaign/ad-group controls. Max (currently beta) automates bidding, audience and creative selection and supports traffic, sales, leads and app promotion. Both can use the same website conversion source. Simple Create, bulk import and the Ads API are other setup methods, rather than additional business goals. Sources: [About campaigns](https://business.reddithelp.com/s/article/about-campaigns), [Max campaigns](https://business.reddithelp.com/articles/Knowledge/max-campaigns).

**Critical constraint:** custom events cannot currently be campaign optimization goals. `UpscaleCompleted` is useful for reporting, but cannot directly train an upscale-optimized campaign. Do not relabel an upscale as `Lead`, `SignUp` or `Purchase`. Only already-shared conversion events can be selected. The saved sales goal is permanent; duplicate the relevant campaign/ad group to change it. Source: [Sales goals](https://business.reddithelp.com/articles/Knowledge/Conversion-Goals).

## Current implementation and integration points

| Existing code | What it gives us / planned change |
| --- | --- |
| `assets/site.js`, `build/build.py`, `localization/home.json`, `localization/legal.json` | Shared consent and generated pages. Add advertising preference, disclosure and shared tracking loader. |
| `src/tool/analytics.js` | Consent-aware Amplitude analytics. Keep its detailed product events; use a separate Reddit adapter with an explicit event allowlist. |
| `src/tool/main.js` — `trackOutcome()` | On-device completion already distinguishes success, failure, cancellation and interruption. Emit the Reddit completion event only for success. |
| `src/tool/cloud.js` — `run()` | Successful cloud event follows tile stitching. Hook here so a failed stitch does not count as a delivered upscale. |
| `src/tool/topup.js`, `src/tool/account-link.js` | Tool top-up creates checkout in another tab. Carry attribution context in the checkout request. |
| `static/account/account.js`, `static/account/api.js` | Separate account-page checkout entry point. Must use the same context contract. |
| `worker/src/index.ts` — `handleCheckout()` and Stripe webhook handler | Creates checkout and verifies paid credit purchases; store checkout attribution and queue conversions here. |
| `worker/src/accounts.ts` — `recordPurchase()` | Idempotent purchase/credit writes in `ACCOUNTS_DB`. Add conversion outbox write to the same atomic batch. |
| `worker/src/album-checkout.ts` — `confirmAlbumPayment()` | Shared confirmation path for webhook and browser return. Queue only the payment whose outcome is `unlocked`, in the same `DB` batch. |
| `static/_headers`, `worker/src/index.ts` — `commonHeaders()` | Upscaler uses cross-origin isolation; dynamic pages have restrictive script/connect policies. Verify the loader under both. |

The account page currently interprets `?purchase=success` as a display notice and polls for balance changes. Neither the query string nor an increased balance proves that a specific order was paid. Do not use either as a Purchase trigger.

## Event contract

| Real action | Reddit event | Source in initial implementation | Counting rule |
| --- | --- | --- | --- |
| Consented page load | `PageVisit` | Browser pixel | Once per document load, across marketing, tool, account and album pages |
| A new account is created | `SignUp` | Server CAPI | Once per account; requires a real creation signal, not every login or `/api/me` call |
| A usable upscale result is ready | `Custom` / `UpscaleCompleted` | Browser pixel | Once per successful processing run, covering device and creative upscale |
| A restored result is ready | `Custom` / `RestoreCompleted` | Browser pixel | Once per successful restore run |
| A Stripe checkout session is successfully created | `Custom` / `CheckoutStarted` | Server CAPI | Once per checkout session, from both top-up entry points and album checkout |
| A website payment is verified and its benefit committed | `Purchase` | Server CAPI | Once per accepted Stripe session; actual paid amount and currency |
| The result is saved/downloaded | `Custom` / `ResultDownloaded` | Browser pixel | On successful delivery to the browser; not proof the user retained the file |

`CheckoutStarted` is custom because there is no actual shopping cart. Do not manufacture `AddToCart` events just to unlock a goal. `SignUp` should be included only once account-creation semantics are made explicit and tested; current `getOrCreateAccount()` does not return whether insertion occurred.

The pixel custom-event format is `rdt('track', 'Custom', {customEventName: 'UpscaleCompleted', conversionId: runId})`. Keep names stable and below 64 characters. Send only documented Reddit metadata. Retain mode, scale, duration, errors and other detailed diagnostics in Amplitude rather than forwarding the entire analytics payload. Source: [Manual pixel events](https://business.reddithelp.com/articles/Knowledge/manual-conversion-events-with-the-reddit-pixel).

Each run gets a new ID when processing starts; retries that create a new user-requested run get a new ID. A completion callback cannot emit twice for the same run. Failed/cancelled/interrupted operations never emit a success conversion. No photo contents, filenames, image URLs or signed media links go to Reddit.

## Attribution from ad click to payment

1. Ad destination includes explicit campaign labels, for example `https://upscales.app/free-upscale/?utm_source=reddit&utm_medium=paid_social&utm_campaign=web_purchase_test&utm_content=creative_a`. Use the landing mode that matches the ad promise. Paid-feature ads should clearly lead toward creative/restore and top-up; free-upscale ads should be judged on downstream payment too.
2. Preserve Reddit's `rdt_cid` through redirects and locale routing. Reddit uses it as the click identifier; UTMs are our reporting labels, not a replacement. Source: [Click ID testing](https://business.reddithelp.com/s/article/Generate-a-Test-Ad-URL-link).
3. After advertising consent, persist a first-party attribution record with the click ID, captured time, campaign labels and expiry. Proposed retention: 30 days, configurable and disclosed. Preserve first touch for internal reporting and update most recent Reddit touch on a new genuine Reddit click; ordinary navigation must not overwrite it. This storage policy does not extend Reddit's selected attribution window.
4. Register that context through a same-origin endpoint and return an opaque context ID bound to the browser session. Link it to the authenticated account when available. Validate lengths, origin and permitted fields. Treat client attribution as measurement input, never proof of payment.
5. Both credit checkout callers pass the context ID. Album checkout receives it through the same-origin cookie/form flow. Server validates ownership/binding and records an immutable checkout snapshot: consent version, attribution, safe source URL, actual browser user agent/IP when available, product type and Stripe session ID. An expired or foreign context is ignored.
6. When Stripe confirms payment, use the saved snapshot. Do not use the webhook request's IP or user agent as the customer's identity. Send click ID and available consented match keys; omit missing keys. If adding email matching, follow Reddit's documented canonicalization/hashing rules and disclose that sharing. Do not enable automatic email collection initially.

Same-browser navigation, authentication and the extra Stripe tab should preserve context. Cross-browser email sign-in or payment on another device may lose click-level linkage; optional consented email/external-ID matching can improve it, but is not a guarantee. Sources: [Match keys](https://business.reddithelp.com/articles/Knowledge/about-match-keys), [CAPI integration](https://ads-api.reddit.com/docs/v3/guides/programs/capi/direct-integration).

## Payment reliability and revenue

- Credit purchases: require verified Stripe signature, `payment_status=paid`, accepted amount/currency, correct account linkage, and explicit live/test-mode validation. Album confirmation already validates mode; apply equivalent protection to credit conversions. A checkout click, session creation or return URL is insufficient.
- Album purchases: use `confirmAlbumPayment()` for both webhook and return processing. Report only the accepted unlock payment; omit duplicate payments automatically marked for refund.
- Create the purchase conversion in a durable outbox in the same transaction/batch as the accepted purchase. Credit outbox lives in `ACCOUNTS_DB`; album outbox lives in `DB`. There is no assumed cross-database transaction.
- Stable unique ID: `purchase:<stripe-session-id>`. Add a unique constraint. Do not rely only on `applied === true` followed by an external HTTP call: a crash between those operations would lose a conversion permanently.
- Dispatch promptly after commit; use the existing scheduled Worker as recovery for unsent rows. Record original event time, attempt count, next attempt, delivered timestamp and redacted error. Lease rows to prevent overlapping dispatch; retry timeouts, rate limits and temporary failures with backoff. Inspect API acceptance, not only HTTP status. Alert on permanent failures or old unsent events.
- Send value in currency base units: `$9.99` is `9.99`, not `999`; currency `USD`, item count `1`, product metadata identifying `credit_topup` or `album_unlock`. Report the actual charged total, not credit quantity or an estimated lifetime value. Credit spending later is not another purchase.
- Count legitimate repeat payments in purchase revenue. Separately report first paying customers and repeat top-ups internally. Stripe remains the financial source of truth; reconcile refunds/disputes there and in internal net-revenue reports. Do not invent negative Purchase events or assume Reddit automatically reverses a refunded conversion.

CAPI uses `POST /api/v3/pixels/{pixel_id}/conversion_events`, bearer authentication and the current v3 `data.events` schema: `type.tracking_type`, `metadata.conversion_id`, `metadata.value`, `metadata.currency`, `click_id`, `event_at` in milliseconds, and `action_source=WEBSITE`. Store its access token only as a Worker secret. Source: [Conversion events API](https://ads-api.reddit.com/docs/v3/operations/Post%20Conversion%20Events).

Initial Purchase is server-only. It still appears under the same Reddit Pixel/data source and can power the Purchase goal. This avoids a browser return dependency and browser/server purchase duplication. Funnel events are browser-only, while CheckoutStarted and SignUp are server-only.

Optional later: add a browser Purchase copy only after an authenticated/checkout-bound receipt endpoint verifies the exact paid session and returns trusted value, currency and conversion ID. Never expose another account's receipt. Capture the session ID before the current account-page URL cleanup. Browser `conversionId` and CAPI `metadata.conversion_id` must match, as must event type and channel. Suppress late browser replay. Reddit requires overlapping copies within two days for deduplication; CAPI events must arrive within seven days of occurrence. Sources: [Deduplication](https://business.reddithelp.com/articles/Knowledge/event-deduplication), [CAPI requirements](https://business.reddithelp.com/articles/Knowledge/Conversions-API).

## Consent and page compatibility

The existing v1 preference has only `analytics`. Proposed v2 has independent `analytics` and `advertising` choices. Existing analytics acceptance must not silently enable Reddit advertising tracking. Preserve that preference and request the new choice. Gate the pixel, attribution persistence, match keys and server conversions on advertising consent; do not replay actions from before that consent.

Synchronize consent to the server context so webhook delivery does not depend on browser state. Withdrawal disables browser emission, clears ad identifiers and revokes linked contexts/pending outbox items before dispatch. Recheck current eligibility at dispatch; historical financial records remain separate. Handle consent changes across tabs. Update localized banner text and privacy disclosure to describe Reddit, advertising measurement, matching, retention and settings.

Load the Reddit script once through a shared adapter on every relevant page, after consent. Keep production tracking disabled on localhost, previews, staging, fixtures and Stripe test sessions. Use a separate test pixel/test configuration with Events Manager testing when available. Missing configuration, blocked scripts and network failures must leave processing, checkout and credits working.

Verify the third-party pixel against `Cross-Origin-Embedder-Policy: require-corp` on localized and default upscaler routes. Do not remove browser isolation needed by the processing engine. If the pixel is incompatible there, use a consented same-origin event relay to CAPI for tool events, with rate limits and an allowlist; no client-supplied Purchase events. Review dynamic album CSP and allow only the required observed Reddit endpoints if browser tracking is used there. Avoid broad wildcard policy changes.

## Delivery and campaign launch

1. Add advertising consent and the attribution context contract; deploy migrations before code that uses them.
2. Add the shared pixel adapter and successful-result hooks. Keep Amplitude independently functional. Add CAPI client, checkout context persistence, both durable outboxes and recovery dispatch. Make SignUp creation semantics explicit.
3. Validate staging with test configuration, then verify production events in Reddit Events Manager before publishing paid campaigns. Use [Pixel Helper](https://business.reddithelp.com/s/article/Reddit-Pixel-Helper-Chrome-extension) and [Events Manager](https://business.reddithelp.com/articles/Knowledge/verify-events-in-the-events-manager).
4. Create **Standard → Sales → Purchase**, no catalog, with the exact same pixel ID as the integration. Suggested initial attribution: seven-day click / one-day view; review click-through and view-through separately. Reddit recommends at least $100/day for Purchase and PageVisit on lower budgets; that is platform guidance, not a promised performance threshold. Choose spend based on acceptable acquisition cost and margin. Source: [Standard setup guidance](https://business.reddithelp.com/articles/Knowledge/Set-up-a-Reddit-Ads-Campaign).
5. If purchases are too sparse, run a separate PageVisit or genuine SignUp goal experiment while continuing to report purchases. Compare cost per paying customer and revenue; a cheaper proxy result does not establish better payment acquisition. Do not split a small test budget across many goals. Max Sales/Purchase can be tested later with the same events.
6. Report landing visits, successful upscales, signups, checkout starts, purchases, purchase value, cost per purchase and ROAS. Internally add first-customer acquisition cost and net revenue after processing costs/refunds. Use UTMs for the internal funnel and Reddit attribution for its dashboard; expect their attribution models and counts to differ.

### Acceptance checks

- No advertising script, persistent ad context or CAPI event before consent or after rejection; an existing v1 analytics opt-in remains ad-disabled. Withdrawal works across tabs and for queued events.
- Exactly one successful completion per device/creative/restore run; none for failures, cancellation, interruption or a failed tile stitch. Saving is distinct from processing.
- Both checkout entry points retain the same click context through authentication, locale routing and Stripe's extra tab. Checkout errors do not create CheckoutStarted.
- A paid credit order reports once even if the customer never returns. Repeated webhook delivery, concurrent dispatch, request timeout, process crash and a return/webhook race cannot lose or multiply the conversion.
- Album accepted unlock reports once; refund-bound duplicate payment does not. Bad signatures, invalid amount/currency, unpaid, expired/cancelled and test-mode sessions never produce live Purchase.
- `$9.99` is received as `9.99 USD`. Revenue reconciles to accepted Stripe sessions, with refunds separately visible internally.
- Third-party tracking works under tool isolation and album CSP, or the relay fallback is verified. Disabled/blocked Reddit tracking does not affect photos, sign-in, checkout or balance.

Implementation inputs still needed: production Reddit Pixel ID, CAPI conversion access token installed securely, test configuration, campaign destination/offer and the chosen budget. No Reddit account configuration, ad publishing or production deployment has been performed as part of this research.
