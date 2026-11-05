# SEO release ledger — 2026-11-05

## Baseline and rollout

- Source baseline: `5195713`; production rollback version: `d51aac33-9782-4999-92c3-f999889a1cb9` (2026-11-04).
- A: technical SEO, custom localized 404, consent-gated marketing analytics and fixed store campaigns.
- B: image delivery, deployed separately after A passes production checks.
- C: cross-platform home positioning, deployed separately after B passes production checks.
- Each release requires its own staging checks, production version and ledger entry. No database migrations.

## Captured baseline

All 120 sitemap URLs returned 200. Full HTTP metadata and additional internal links are in `baseline-http-2026-11-05.json`.

Authenticated Search Console exports: `search-console-28-days/` and `search-console-90-days/`.
Both exports currently contain the same 16 days (2026-10-19 to 2026-11-03): 54 clicks and 1,053 impressions. Among disclosed queries, iPhone terms have 19 impressions and zero clicks; undisclosed/anonymized queries cannot be assessed. Keep iPhone in existing platform-specific titles when expanding the main page positioning.

Mobile Lighthouse, three cold-load runs per page. Medians below; all settings, timing and request data are in `performance-baseline/results.json`. CLI Lighthouse is a lab measurement, not field INP or CrUX. No Chrome DevTools trace MCP is available.

| Page | Performance | LCP | CLS |
| --- | ---: | ---: | ---: |
| `/` | 100 | 0.95 s | 0 |
| `/ru/` | 100 | 1.10 s | 0 |
| `/upscale/` | 92 | 3.39 s | 0 |
| `/guides/unblur-photo-iphone.html` | 99 | 2.18 s | 0 |
| `/gallery` | 97 | 1.81 s | 0 |

## Cloudflare change ledger

- Account: `a1c113467950b1e7b53c21a865c25576`; zone: `d67ce848a236ade26c58ec35cce4d609`.
- Before: no www DNS record and no Redirect Rules. Added proxied `A www → 192.0.2.1` (redirect-only placeholder) with automatic TTL.
- Added rule `67e4ae9cc7eb4c2d865f85a6e802bd71`: `(http.host eq "www.upscales.app")` → `concat("https://upscales.app", http.request.uri.path)`, 301, preserve query, enabled.
- Both HTTP and HTTPS www tested: one 301 to canonical HTTPS retaining path and query. Rollback: disable the newly created rule and remove only the new www record.
- Crawler settings before: Search Allow, Training Disallow, Agents Allow, Bot Preference Sync on. AI Crawl Control shows Baidu block off; PetalBot inherits Training policy. No broad WAF exceptions were added.
- Original public robots response: `robots-before.txt`; UA probes: `bot-access-before.json`. UA probes cannot establish verified-bot treatment.
- `build/crawler-policy.json` retains every original explicit Disallow except Baiduspider/PetalBot; Bot Preference Sync was switched off after the source robots file was live. Confirmed Search Allow / Training Disallow / Agents Allow remain unchanged. Public robots has one general group and preserves all 30 other explicit restrictions. UA responses before/after are identical (including ClaudeBot 403); these probes do not verify real-bot classification. See `robots-after.txt` and `bot-access-after.json`.
- After managing robots in source, review newly introduced crawlers manually; Cloudflare no longer supplies automatic robots additions.

## Attribution

Apple provider token `53683800` was read from the UScale campaign generator in App Store Connect. Campaign names: `site_home`, `site_guides`, `site_other`. Apple applies reporting thresholds and attribution windows. Google Play links carry fixed source/medium/campaign inside the encoded referrer. The existing `/go` contract is unchanged. Install Referrer ingestion by the Android application and Play Console acquisition reporting still require independent verification; website clicks are not installations.

## Acceptance and outstanding external data

Python, Node tool, Worker regression/type checks, production build and actual Wrangler routing are required. Staging must send X-Robots-Tag on static and dynamic responses, including errors. Test 404 assets at `/upscale/foo` and `/ru/upscale/foo` with COEP intact, no third-party requests, keyboard and reduced-motion behavior.

Search Console Indexing report captured before publication, last updated 2026-10-23: 7 indexed, 116 excluded (113 discovered, 2 crawled, 1 redirect). Indexed examples: `/`, `/es/`, `/fr/`, `/zh/`, `/es/guides/restore-old-photos.html`, `/es/guides/slow-motion-video.html`, `/es/terms.html`. This is a delayed report, not proof that the other languages are currently absent from the index. Individual URL Inspection and current Yandex index data remain outstanding; do not describe this as a full index audit.

## Release A validation

- Python: 84 checks, including one optional model-suite skip (run separately below). Node tool/marketing: 131 passed. Worker types/typecheck/regressions: 169 passed.
- Production package built with existing PNG and Photo 4× release gates, 359 files / 146.3 MiB. Production Wrangler dry run passed.
- Installed Wrangler 4.129.0 and final staging: all 141 route checks passed. Staging version `1ef87c45-a667-4282-8861-21634f6acdd2`.
- Isolated browser checks: dark theme, mobile touch/reduced motion, keyboard Home/End and JavaScript disabled passed. All 404 subresources returned 200, no third-party requests or page errors, COEP require-corp retained. See `404-browser-qa.json`.
- No photo processing/model code changed. Existing processing regression and packaging gates passed; a new full image corpus benchmark was not necessary for this release.


Release A published to production on 2026-11-05, commit `d58798e`, version `e4078899-f631-4286-84c6-d6f107e73102`. All 141 production routing checks passed (`production-a-routes.json`). The user removed the seven-day release pauses on 2026-11-05: correct platform availability and image delivery promptly, retaining separate commits, deployments and rollback points. The 7/28-day measurements remain observational follow-ups. Rollback A: `cd worker && npx wrangler rollback d51aac33-9782-4999-92c3-f999889a1cb9 --env production`; restore separately changed Cloudflare settings if appropriate.


## Prepared release B (not published to production)

Responsive variants cover hero, frame, guide cards, showcase, comparisons and tool mode previews. Sizes follow the existing CSS, candidates never upscale a source. WebP quality 90; if it would exceed the original byte size, the original is retained as the candidate. Original files remain available. Hero alternatives load on pointer/focus/selection rather than on page load. Both before/after candidates are updated when switching; crossfade still discards stale requests. No critical CSS or photo processing changes. No extra hero preload: there was no measured need with a baseline home LCP around one second.

The first hero result uses 960 px / 89,470 bytes on a 390px DPR2 device, compared with the previous 222,206-byte original. On 1440px DPR1 it selects 1440px. Keyboard/touch switching and absence of unsolicited alternate loads passed (`images-browser-qa.json`). A separate existing browser processing UI suite passed for import/process/PNG download with no errors (`processing-ui.json`).

After A, the same 15 production mobile Lighthouse runs have median LCP: home 1.12s, Russian home 1.09s, tool 3.41s, guide 2.05s, gallery 2.08s. CLS is zero for all. The tool still exceeds the 2.5s LCP target; no field INP conclusion is available. These are lab observations, not a causal SEO outcome (`performance-after-a.json`).

B staging version `da86f663-eed8-4bd1-ba34-65dee2323241`; 141 routing checks passed before the final tool-preview-only asset addition, and final production build/model gates passed. Run reusable browser checks with an installed Playwright runtime: `USCALE_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs USCALE_TEST_CHANNEL=chrome node scripts/check_image_delivery.mjs` and `node scripts/check_404_browser.mjs` with the same environment. Set `USCALE_TEST_ORIGIN` to staging when required.


## Prepared release C (not published to production)

Seven home pages use platform-neutral H1 and matching social descriptions. Existing iPhone-specific titles retain iPhone and add Android; French/Spanish neutral titles are preserved. A separate visible line lists iPhone, iPad, Android and Apple-silicon Mac and states that features vary. Existing on-device/cloud distinctions remain. Guide editorial copy, titles/descriptions, URLs, social image descriptions and dates are preserved; all 70 guide bodies and head metadata were compared between the old and new home contexts. Shared footer branding is now platform-neutral. Android guides are deferred.

`page_updated.home` is the only date source changed; all seven home sitemap entries show 2026-11-05. At C publication, set that shared value to the actual release date and rebuild. Guide dates must stay unchanged. Mobile checks passed on all seven locales (`home-positioning-qa.json`).

A final review also fixed the pre-existing browser tool host classification: only `upscales.app` may send analytics; localhost and every preview/staging host log locally. Node regression covers saved consent on five non-production hosts. Actual staging browser with consent=true emitted debug screen/tap events and made zero Amplitude requests. This correction belongs to the amended A commit `3367611` and is inherited by B/C. Production A version after correction: `92d7e215-1406-43e2-90f6-ccc6172e11b0`.

Final checks after inheriting the A analytics correction: 86 Python tests (one existing optional skip), 132 Node tool/marketing tests, 169 Worker tests/typecheck, production build/model release gates. Final production A routing: 141/141. Staging C retains noindex on static/dynamic/error responses.

The optional model-conversion suite was then run in its existing isolated environment (`.web-model-work/photo4x/venv`) rather than skipped: all 3 tests passed. Latest staging C version: `b1117ac8-0dec-4218-adde-ef98ee810736`; all 141 routes and live browser 404/image checks passed.

Automatic rollout/follow-up was proposed but has not been enabled: unattended future production deployments require separate explicit confirmation. Until granted, B/C publication and the 7/28-day follow-ups remain manual. No background job was created.

Production-browser consent QA passed with all Amplitude requests and store navigation intercepted: zero analytics before consent/after rejection, one tap per click after acceptance, no query in payload and no events after revocation (`consent-browser-qa.json`). No real QA events were sent to Amplitude.
