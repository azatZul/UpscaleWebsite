# UScale albums Worker

The Worker serves the production package in `.deploy-dist` through Cloudflare Static Assets and
handles only the dynamic album routes. The R2 bucket is private; clean media is
always gated by the album state in D1.

`npm run build:production` rebuilds the public browser tool and site, then packages
only public assets into `.deploy-dist`. The packaging step excludes the engineering
lab, raw model directory, benchmark fixtures, source maps and hidden files, and
rejects any asset over Cloudflare's 25 MiB per-file limit.

Static Assets uses `html_handling=none` to preserve existing `.html` canonical URLs.
The build emits explicit `_redirects` rewrites for `/`, locale homes and guide
indexes; these remain static requests without Worker invocations.

## Local setup

```bash
python3 ../build/build.py
npm install
npx wrangler d1 migrations apply uscale-albums-local --local
npm run check
npx wrangler dev
```

`wrangler.jsonc` contains separate local, staging and production bindings. The local
database ID is a deliberate zero-UUID placeholder; staging and production point at
real D1 databases. The `upscales.app/*` route exists only in the production
environment.

From the repository root, `scripts/deploy-cloudflare.sh staging` runs the production build,
Python tests, Worker checks, remote D1 migration and deploy as one sequence. Use
`production` only after the staging smoke test; the Netlify deploy remains available
as rollback.

## Search indexing and HTTPS

The public `/upscale/` page and its translated versions allow indexing and appear
in `sitemap.xml` when the browser tool bundle is available. Preview packaging still
adds a site-wide `noindex` header. Account pages and individual albums remain
excluded from indexing.

For the production domain, enable **SSL/TLS → Edge Certificates → Always Use HTTPS**
in the Cloudflare dashboard for `upscales.app`. This is a zone setting, separate
from the Worker deployment. It redirects HTTP before static assets or dynamic
routes are served, without routing every asset through the Worker. The static
`_redirects` file cannot select requests by scheme.
See [Cloudflare's Always Use HTTPS documentation](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/).

Verify both the root and a localized tool URL without following redirects:

```bash
curl -I 'http://upscales.app/'
curl -I 'http://upscales.app/ru/upscale/?mode=device&utm_source=https-check'
```

Both responses should return a permanent redirect to the same HTTPS URL,
preserving the path and query string.

Enabled on `upscales.app` on 2026-10-20. Verified HTTP 301 at the root and at
`/ru/upscale/?mode=device&utm_source=https-check`, with the full path and query
preserved; following the localized URL reaches HTTP 200 after one redirect.

## Paid album unlocks

A locked album that is for sale shows an "Unlock" button. A visitor pays on Stripe
Checkout without an account, and the album opens for everyone with its link:
downloads, the ZIP, and clean previews in place of the watermarked ones. The code is
in `src/album-checkout.ts`.

- **For sale** means locked, priced at $0.50 or more, and every clean preview twin
  present in D1 (`unlocked_after_key` on each photo, `unlocked_cover_key`, and
  `unlocked_gallery_key` when there is a gallery card). Prices and twins are set by
  the album CLI (`set-price`, `migrate-unlock-previews`).
- **One payable session per album.** `POST /gallery/<id>/unlock` writes the attempt to
  `checkouts` before calling Stripe; a partial unique index allows one creating-or-open
  attempt per album. The attempt id is the Stripe idempotency key and the stored form
  body is resent byte for byte, so a crash at any point recovers the same session. An
  old session is closed in Stripe (after reading what it really is) before another is
  made.
- **Confirmation** comes from the `checkout.session.completed` webhook or from the
  success redirect, whichever is first. One D1 batch unlocks the album, records the
  payment in `payment_events`, and queues a refund in `refund_jobs` when the payment
  did not unlock it (paid after a manual unlock, or after deletion).
- **Refunds** are pushed by the 10-minute cron until Stripe reports them succeeded or
  failed; `album_refund_failed` in the logs needs a human. A refund or chargeback of an
  album payment does not lock the album again.
- **`STRIPE_MODE`** (`live` in production, `test` elsewhere) is the only mode album
  payments accept: a key or an event from the other mode is refused, so test keys can
  never unlock a production album. No extra webhook events need enabling.

Migration `0003` replaces the `checkouts`, `payment_events` and `refund_jobs` tables
that `0001` reserved but never used. Before applying it to a remote database, check
that all three are still empty:

```bash
npx wrangler d1 execute uscale-albums --env production --remote --command \
  "SELECT (SELECT COUNT(*) FROM checkouts) AS c, (SELECT COUNT(*) FROM payment_events) AS p, (SELECT COUNT(*) FROM refund_jobs) AS r"
```

Run `npm run types` whenever a binding changes. Do not add provider or Cloudflare API
tokens to this Worker: administrative writes are performed by the local album CLI.
