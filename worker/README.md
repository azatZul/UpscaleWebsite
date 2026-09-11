# UScale albums Worker

The Worker serves the existing generated site through Cloudflare Static Assets and
handles only the dynamic album routes. The R2 bucket is private; clean media is
always gated by the album state in D1.

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

From the repository root, `scripts/deploy-cloudflare.sh staging` runs the build,
Python tests, Worker checks, remote D1 migration and deploy as one sequence. Use
`production` only after the staging smoke test; the Netlify deploy remains available
as rollback.

Migration `0001` also creates `checkouts`, `payment_events` and `refund_jobs`. Nothing
reads them yet: they are reserved for the paid-unlock stage and are deliberately kept
rather than dropped, because the migration is already applied to both remote
databases.

Run `npm run types` whenever a binding changes. Do not add provider or Cloudflare API
tokens to this Worker: administrative writes are performed by the local album CLI.
