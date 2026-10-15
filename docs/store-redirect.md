# Store redirect link

Use `https://upscales.app/go` (after deployment) for links that should send mobile
visitors straight to the app store.

- iPhone and iPad, including iPad desktop mode: immediate redirect to
  `https://apps.apple.com/app/id6736931330`.
- Android: immediate redirect to
  `https://play.google.com/store/apps/details?id=com.uscale`.
- Desktop/unknown devices: plain App Store and Google Play links.
- If a browser keeps the visitor on the redirect page, a plain store link appears
  after 1.5 seconds.
  Store links also remain available when JavaScript is disabled.

There is no custom iOS landing UI, clipboard access, click token, browser storage,
analytics request or iOS attribution in this version. The optional clipboard
landing experience is separate work and is not included in this PR.

Android retains optional `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term`, `utm_id`, `ad_id` and `adset_id` in Google's encoded `referrer` parameter.
`creative` is a fallback alias for `utm_content`. Each value is trimmed, stripped
of control characters and limited to 120 URI-encoded characters. Unknown fields
are ignored; incoming parameters cannot change the store destination.

Example:

```text
https://upscales.app/go?utm_source=reddit&utm_medium=paid_social&utm_campaign=photo_restore&utm_content=before_after&ad_id=ad_123
```

On iOS, this goes straight to the App Store with no campaign payload. On Android,
Google Play receives the campaign referrer; the app still needs to read/report
the Install Referrer to use the custom fields in analytics.

The existing build discovers `static/go/index.html` and supplies `/go` → `/go/`
and `/go/` → `/go/index.html` routes. The page is unlinked, omitted from the sitemap
and marked noindex. The production package includes its directory automatically.

Validation:

```sh
node --test tests/store_redirect.test.mjs
python3 build/build.py
python3 -m unittest discover -s tests
node scripts/package_production.mjs
```
