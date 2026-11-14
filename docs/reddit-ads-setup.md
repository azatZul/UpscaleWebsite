# Reddit Ads setup and operations

Implemented 14 November 2026. Pixel: `a2_i7c385uefy4v`. Production host: `upscales.app`.

Deployment verification: staging version `eb31636c-521f-4ad4-8c78-ab19a757daa0`; production version `5426bde4-7688-4bf9-9dc8-fc8543c1296d`. Both database migrations applied successfully. A consented production tool visit and a real 360 × 270 → 720 × 540 sample upscale each produced an accepted CAPI event (`delivered`, no error). The marketing browser pixel loaded with the correct ID. Independent analytics/advertising preferences and live advertising withdrawal were verified in the browser. No live payment was made; purchase behavior was validated with signed simulated Stripe events. All 333 automated checks passed (166 Worker, 72 tool, 29 account, 66 site/album/localization tests).

The merged release also supports the current `/upscale/` route, the shared marketing/tool analytics core, and all seven website languages. Consent and website measurement disclosures use provider-neutral wording. Existing album tipping, download progress, responsive images and indexing behavior are retained. Purchase optimization covers credit purchases and paid album unlocks; voluntary tips remain separate from those purchase goals.

Combined-source validation passed: 204 Worker tests, 138 tool/marketing tests, 33 account/store tests, and 88 Python tests. The missing local processing graph was regenerated with the repository's pinned preparation tools and verified against its approved size and SHA-256 before packaging; the approved graph and release configuration were not changed.

## Events and campaign choice

Choose **Sales → Purchase**, without a catalog, and select this pixel in Reddit Ads. Do not select a custom upscale event as the optimization goal: Reddit currently does not support that. See the [research and original plan](reddit-ads-integration-plan.md).

| Website action | Reddit event | Delivery |
| --- | --- | --- |
| Marketing page visit | `PageVisit` | Browser pixel; server fallback if the script fails to load |
| Tool, account or gallery page visit | `PageVisit` | Conversions API |
| New website account | `SignUp` | Conversions API, atomically with the winning account insertion |
| Successful device or creative upscale | `UpscaleCompleted` (custom) | Conversions API via same-origin relay |
| Successful restore | `RestoreCompleted` (custom) | Same-origin relay |
| Result download click | `ResultDownloaded` (custom) | Same-origin relay; browser downloads cannot prove that the file was retained |
| Stripe checkout successfully created | `CheckoutStarted` (custom) | Conversions API |
| Confirmed credit purchase or accepted album unlock | `Purchase` | Conversions API, atomically queued with the payment |

Conversions API events appear in the same Reddit data source as browser pixel events. No browser Purchase event is emitted. The payment event uses the paid Stripe session ID for deduplication and real amount/currency for revenue; spending credits is not another purchase. Repeat paid orders count as new purchases. Refunds are reconciled internally, not sent as negative purchases.

The browser tool keeps its cross-origin isolation. No external Reddit script loads on tool, account or gallery pages. Only allowlisted nonfinancial events can enter the public relay. Photos, filenames, image links, email addresses, Firebase tokens and card data are excluded. Server payment matching uses the consented Reddit click ID, original browser IP/user agent and existing Reddit first-party UUID when available. It never uses Stripe's webhook IP as the customer's address.

## Configuration

Production `worker/wrangler.jsonc` enables `REDDIT_ENABLED=true` and supplies the public `REDDIT_PIXEL_ID`. The server-only token is a Wrangler secret:

```sh
cd worker
npx wrangler secret put REDDIT_CAPI_ACCESS_TOKEN --env production
```

The browser adapter is also production-host gated. Localhost, staging, preview, fixture and analytics-debug pages never send live advertising events. Stripe test events never produce live Purchase conversions. To stop all tracking, set production `REDDIT_ENABLED=false` and deploy; browser pixel initialization also requires successful server registration. Existing stored advertising data is still removed by scheduled retention cleanup when delivery is disabled.

Both D1 databases have additive migrations: `migrations/0004_reddit_ads.sql` and `migrations-accounts/0007_reddit_ads.sql`. Apply both before deploying code. `scripts/deploy-cloudflare.sh` now migrates both databases.

## Consent and attribution

Consent v2 has independent analytics and advertising choices. Existing v1 analytics acceptance does not enable Reddit. The shared banner and disclosures are translated into all seven website languages, including the account page's English banner. Cross-tab preference changes propagate to both tracking adapters.

Ad URLs should include `utm_source=reddit`, `utm_medium=paid_social`, and stable campaign/creative names. Preserve Reddit's `rdt_cid`. After advertising consent, the site stores attribution for at most 30 days and registers a browser-bound HttpOnly context cookie. Each checkout has an immutable attribution snapshot. Account navigation and a separate Stripe tab do not depend on a thank-you page to report payment. Cross-browser attribution without matching data is not guaranteed.

Withdrawing consent stops browser delivery, revokes the server context, removes ad identifiers and matching snapshots, and discards unsent conversions. Data already sent to Reddit follows Reddit's own retention policy. A request already in flight cannot be recalled.

Album checkout URLs are shared/reused by the existing payment flow. If a different visitor reuses a session, its old payment attribution is discarded instead of crediting the wrong ad. Payments automatically queued for refund because the album was already unlocked do not emit Purchase.

## Stripe and event delivery

Keep the existing `checkout.session.completed` webhook subscribed. If delayed payment methods are offered, also subscribe the same endpoint to **`checkout.session.async_payment_succeeded`**; the Worker handles it and reports only once the session is paid. Album checkout already restricts payment methods to cards (including supported wallets).

Each accepted payment and its conversion outbox row commit in one database batch. Immediate background delivery is backed by the existing ten-minute scheduled Worker. Delivery uses a lease, stable conversion ID, the original event timestamp and backoff for temporary errors. Events older than seven days are discarded. Permanent API errors remain visible as `failed`; token/permission errors stay retryable so configuration can be repaired. Matching payloads are erased after successful delivery, on withdrawal, and at retention expiry. No raw token or match-key values are logged.

For troubleshooting, inspect **only operational columns** in each database:

```sql
SELECT status, COUNT(*) AS events
FROM reddit_outbox
GROUP BY status;

SELECT conversion_id, attempts, last_error
FROM reddit_outbox
WHERE status IN ('pending', 'failed')
ORDER BY event_at;
```

`reddit_tracking_failed` Worker logs identify the failed operation without exposing credentials. A successful API response confirms ingestion, not campaign attribution or dashboard availability. Check Reddit Events Manager for event quality, source and attribution. No campaign is created or published by the code.

## Validation

The checks include consent gating and withdrawal during registration, blocked-pixel fallback, no live preview events, public Purchase rejection, relay limits, signed paid webhooks, delayed successful payments, financial rollback, webhook replay, concurrent delivery, API errors/retry, signup insertion races, album refund exclusion and shared-checkout attribution.

Run `npm run test:tool`, `node --test tests/account/*.test.js`, `ALBUM_TESTS_REQUIRED=1 python3 -m unittest discover -s tests -v`, `npm --prefix worker run check` and `npm run build:production`. Validate a real consented PageVisit in Events Manager before starting spend. Real paid conversion attribution must be checked when an actual live purchase occurs; tests do not create live purchases.
