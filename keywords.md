# UScale — Keyword Research & SEO Map

Date: **2026-08-21** · Domain: **upscales.app** · App: **AI Photo Enhancer, UScale** (id 6736931330)

**Data sources**
1. **AstroMCP** (`http://127.0.0.1:8089/mcp`) — 583 tracked App Store keywords for this app across 28 stores, with `popularity` (0–100 Apple search-volume proxy), `difficulty` (0–100) and live ranking. This is *real* demand data for the exact audience that installs apps, so it drives the head-term choice in every locale.
2. **Web SERP research** — what actually ranks for the informational long-tail (`perfectcorp.com`, `cyberlink.com`, `videoproc.com` blog posts, competitor App Store pages). This drives the guide topics.

**Selection rule used:** pick terms where (a) intent ends in *"I need an app on my phone right now"*, and (b) we can plausibly rank — so we go after **long-tail informational + app-modifier** queries on the web, and reinforce the **head ASO terms** for brand/App Store consistency. We deliberately do **not** target `remini` / `rimini` / competitor brand names on the landing pages (high ASO popularity, but useless web traffic and trademark risk). The one exception is `/compare.html`, which runs the same photos through the named competitors — a factual side-by-side is the legitimate way to meet brand demand, and in German that demand is the largest single term we measured.

---

## 1. Primary keywords (English — page: `/`)

| # | Keyword | ASO popularity | ASO difficulty | Intent | Placement |
|---|---|---|---|---|---|
| 1 | **ai photo enhancer** | 52 (US) / 43 (IN) / 39 (DE) | 74 | Commercial | H1, `<title>`, meta description, OG title |
| 2 | **enhance photo quality** | 31 (US) / 30 (IN) | 65 | Commercial | H1 supporting clause, hero subhead, feature H3 |
| 3 | **unblur photo / unblur image** | 36 (GB) / 27 (US) / 22 (US) | 39–52 | Transactional | Feature card H3, FAQ #1, guide 1 |
| 4 | **photo enhancer** | 48 (GB) | 57 | Commercial | Nav, footer, alt text, JSON-LD `alternateName` |
| 5 | **video enhancer / ai video enhancer** | 47 (IN) / 32 (US) / 9 (GB) | 41–50 | Commercial | Feature card H3, guide 5 |
| 6 | **upscale image / image upscaler** | 13 + 9 (US) | 41–53 | Transactional | Feature H3, guide 4 |
| 7 | **restore old photos / old photo restore** | 16 + 12 (GB) | 19–21 | Transactional | Feature H3, FAQ #2, guide 2 |
| 8 | **photo quality enhancer / picture enhancer** | 21 (US) | 58–59 | Commercial | Hero support copy, footer |
| 9 | **fix blurry photo** | 17 (CN store, EN term) | 35 | Transactional | FAQ, guide 9 |
| 10 | **video upscaler / upscale video** | 13 + 6 | 11–21 | Transactional | Feature H3, guide 5 |
| 11 | **sharpen photo ai / sharpen images** | 17 (US) / 28 (GB `sharpen`) | 23–49 | Transactional | Feature copy, guide 1 |
| 12 | **photo resolution enhancer** | 18 (US) | 47 | Commercial | Guide 4 H2 |

**Head-term modifiers that make the difference between traffic and downloads:** `free`, `iphone`, `app`, `offline`, `without uploading`, `4k`. Every primary keyword appears at least once on the landing page in a modified form (`free ai photo enhancer for iphone`, `unblur a photo on iphone`, `upscale image to 4k free`).

### Deliberately excluded

`remini` (pop 72), `rimini` (52), `pixelup`, `enhancefox`, `bigjpg`, `waifu2x`, `photoshop express`, `meitu`, `photolab` — competitor/brand navigational terms. Fine to keep in ASO, wrong for a brand website.

---

## 2. Long-tail keywords → one guide page each (`/guides/<slug>`)

These are the money pages. Each answers a specific question, then converts into "do it in UScale in 4 steps".

| # | Slug | Target long-tail keyword | Secondary keywords | Search intent |
|---|---|---|---|---|
| 1 | `unblur-photo-iphone` | **how to unblur a photo on iPhone** | unblur photo free, make blurry picture clear, sharpen blurry image, fix out of focus photo | Informational → transactional |
| 2 | `restore-old-photos` | **how to restore old photos on your phone** | repair torn photo, remove scratches from old photo, fix faded photo, digitize old family photos | Informational → transactional |
| 3 | `colorize-black-and-white-photos` | **how to colorize black and white photos** | colorize old photos ai, add color to old photo, black and white to color | Informational |
| 4 | `upscale-image-4k` | **how to upscale an image to 4K** | increase image resolution, enlarge photo without losing quality, 4x upscale, low res to high res | Transactional |
| 5 | `enhance-video-quality` | **how to improve video quality on iPhone** | upscale video to 1080p/4k, fix grainy video, ai video enhancer free | Transactional |
| 6 | `slow-motion-video` | **how to make a video slow motion on iPhone** | turn normal video into slow motion, ai frame interpolation, smooth slow mo without recording in slo-mo | Informational → transactional |
| 7 | `brighten-dark-photos` | **how to brighten a dark photo without ruining it** | fix underexposed photo, lighten dark picture, recover shadows, night photo too dark | Informational |
| 8 | `film-negative-to-photo` | **how to convert film negatives to photos with your phone** | scan negatives with iphone, invert negative image, 35mm negative to digital | Informational |
| 9 | `fix-blurry-faces` | **how to fix blurry faces in photos** | face restoration ai, enhance face in photo, sharpen faces in group photo | Transactional |
| 10 | `upscale-anime-art` | **how to upscale anime art and drawings** | upscale pixel art, enlarge illustration without pixelation, waifu2x alternative iphone | Transactional |

Each guide carries: a direct answer paragraph (featured-snippet shaped, 40–55 words), a numbered how-to with `HowTo` JSON-LD, a "why this happens" explainer, tips, a 3-question mini-FAQ with `FAQPage` JSON-LD, `BreadcrumbList`, internal links to two sibling guides, and a download CTA.

---

## 3. Localised head terms (from AstroMCP, per store)

The 12 locales use *native* keywords pulled from their own store — not machine translations of the English terms. `p` = Apple popularity, `d` = difficulty.

### 🇪🇸 Spanish (`/es/`) — stores es, mx
`mejorar calidad de fotos` (p56 mx / p51 es, d52) · `mejorar fotos` (p45, d65) · `mejorar calidad de videos` (p45 mx / p22 es, d44) · `aclarar fotos` (p23, d55) · `arreglar fotos` (p21, d72) · `mejorador de fotos` (p20, d56) · `calidad fotos` (p18) · `mejorar fotos con ia` (p5) · `restaurar fotos antiguas`

### 🇧🇷 Portuguese (`/pt/`) — stores br, pt
`melhorar qualidade da foto` (p57, d67) · `aprimorar foto` (p48, d59) · `qualidade da foto` (p48) · `melhorar qualidade de vídeo` (p29, d55) · `limpar foto` (p26, d72) · `restaurar fotos antigas` (p6→d52) · `melhorar foto antiga` (p5, **d5** — easy win) · `realçador de fotos` (p5, d50) · `aprimorar qualidade foto grátis` (p5, d17)

### 🇫🇷 French (`/fr/`)
`améliorer la qualité photo` (p47, d46) · `unblur photo` (p35, d42) · `améliorer la qualité vidéo` (p15, d54) · `déflouter des images` (p12, **d19**) · `améliorer photo` (p9, d57) · `netteté photo` (p6) · `restaurer & améliorer photos` (p5, d23) · `agrandisseur` (p5, **d5**) · `amélioration qualité photos ia` (p7, d23)

### 🇩🇪 German (`/de/`) — live

**ASO popularity** (App Store demand): `bilder schärfer machen` (p26, d47) · `foto schärfen` (p14, d45) · `AI Foto verbessern` (p11, d45) · `bild schärfen` (p10, d59) · `fotos schärfen bilder qualität` (p7, **d21**) · `gesicht enhancer` (p5, d41) · `videoverbesserung` (p5, **d17**) · `KI Fotoverbesserung` (p5, **d13**) · `KI Bildbearbeitung` (p55, d74)

**Web demand** — Google Trends, region DE, 12 months to 2026-08-23, six comparisons stitched on the shared anchor `foto schärfen` = 1.00. The anchor is below the Trends cutoff for most weeks, so the ratios come from the final three weeks, where it clears the threshold in every batch. `bilder schärfer machen` appears in two batches independently and lands at 2.8 and 3.0, which is what validates the stitch.

| Term | × anchor | Verdict |
|---|---|---|
| `remini` | 45.5 | Competitor brand — see the comparison page below |
| `ki bildbearbeitung` | 36.6 | Excluded: generative *editing* intent, Adobe/Canva SERP |
| **`bild vergrößern`** | **12.2** | Biggest usable term. Contaminated with zoom/print — qualify it |
| **`auflösung erhöhen`** | **7.5** | Clean upscaler intent |
| **`bildqualität verbessern`** | **5.1** | Best clean head term, matches the in-app label „Verbessern“ |
| `bild schärfen` | 4.6 | Singular beats the phrase form |
| `foto verbessern` | 4.4 | |
| `bild hochskalieren` | 3.9 | Correct technical term, but a third of `vergrößern` |
| `bilder schärfer machen` | 2.9 | The previous `<title>` target — the weakest of this cluster |
| `videoqualität verbessern` | 1.9 | Top video term; `video hochskalieren` is 0.55 |
| `alte fotos restaurieren` | 1.0 | Measurable — the restore guide has real demand |
| `fotos kolorieren` | 0.5 | Measurable |
| `fotoqualität verbessern` | 0.13 | **40× below `bildqualität verbessern`** — never write *Fotoqualität* |
| `ki fotoverbesserung`, `foto enhancer` | 0.0 | Germans do not search these as nouns. Removed from the H1 |
| `verwackeltes foto reparieren`, `dunkle fotos aufhellen`, `zeitlupe erstellen` | 0.0 | Below the Trends cutoff, **not** zero demand — long-tail guide plays, keep as-is |

**Reading the zeros:** Trends has a measurement floor. A flat zero means "under the floor", never "nobody searches it". The 0.0 rows above are unmeasured, not disqualified; only Keyword Planner can separate the two.

**`KI Bildbearbeitung` is deliberately not the landing-page target**, despite topping both ASO (p55) and Trends (36.6). Those rank demand, not fit. The German SERP for it is Adobe Firefly, Canva, Android and Perfect Corp — generative photo *editing*, a different intent and an unwinnable page.

**`Bild` beats `Foto` in compounds.** `bildqualität verbessern` outdraws `fotoqualität verbessern` 40:1 between two exact synonyms. Prefer *Bild-* in any compound noun that carries search intent.

Placement: `bildqualität verbessern` → home `<title>`, screenshot caption · `bilder schärft, vergrößert, restauriert` → home H1 · `auflösung erhöhen` → hero subhead and the 4K guide H1 · `bild vergrößern ohne Qualitätsverlust` → 4K guide `<title>`, card and meta description · `videoqualität verbessern` → video guide `<title>` · `alte fotos restaurieren` → restore guide `<title>`.

**`hochskalieren` stays the verb for the *product action*** — it is the in-app label („Kreatives Hochskalieren“) and every step-by-step instruction must match what the user sees on screen. But it is only a third of `vergrößern` on the web, so **SEO surfaces lead with `vergrößern` / `Auflösung erhöhen`** and the body copy switches to `hochskalieren` once the reader is on the page. The 4K guide intro contrasts the two explicitly, which is what keeps the intents from splitting.

**iPhone as the qualifier.** We cannot outrank free browser upscalers on the bare head terms — the searcher for `bild vergrößern` wants a web tool. What we can own is the same term plus the platform, so every German `<title>` and H1 now names iPhone. German body copy still says *Smartphone* where the sentence is about physically holding the phone, which is correct German and not an SEO surface.

**Competitor brands.** `remini` at 45.5 is the single largest German term measured, and `/de/compare.html` already runs the same photos through Remini, BlurBuster and EnhanceFox. That page — not the landing page — is where brand demand is captured; the §1 exclusion of brand terms still holds for `/de/`.

### 🇮🇹 Italian (`/it/`)
`migliora qualità foto` (p51, d49) · `migliora foto` (p47, d63) · `migliora qualità video` (p20, d36)

### 🇯🇵 Japanese (`/ja/`)
`高画質化` (p63, d67) · `画質を良くするアプリ` (p59, d63) · `ノイズ除去` (p36, d38) · `画質良くする` (p30, d48) · `写真高画質` (p21, d62) · `高画質動画` (p20, d52) · `写真高画質化` (p13, d59) · `ぼやけた画像修正` (p6, d48) · `古い写真を復元` (p5, **d11**) · `解像度` (p10, d51)

### 🇰🇷 Korean (`/ko/`)
`화질 개선` (p55, d52) · `고화질 변환` (p48, **d23**) · `사진 화질 개선` (p24, d46) · `사진 고화질` (p21, d48) · `사진 화질` (p17, d50)

### 🇨🇳 Simplified Chinese (`/zh/`)
`画质修复` (p62, d65) · `高清修复` (p34, d55) · `修复模糊图片` (p31, d47) · `照片修复` (p29, d67) · `老照片修复` (p25, d47) · `视频高清修复` (p5, d46) · `图片清晰放大` · `ai照片修复` (p16, d58)

### 🇷🇺 Russian (`/ru/`) — live

**ASO popularity** (App Store demand): `улучшение качества фото` (p51, d55) · `улучшить качество фото` (p45, d52) · `улучшить качество видео` (p39, d38) · `качество фото` (p36, d47) · `улучшение качества видео` (p30, **d23**) · `улучшить фото` (p29, d62) · `улучшить изображение` (p5, **d7**) · `колоризация фото` (p5, **d5**) · `фото четче` (p5, **d5**)

**Web demand — Yandex Wordstat, Russia, all devices, 25 Jul – 25 Aug 2026.** Broad match, so a parent count contains its children (`улучшить фото` 321k contains `улучшить качество фото` 254k). Absolute monthly counts, no anchor and no stitching needed. 4 678 distinct queries exported; Google Trends RU was pulled alongside and agreed on ordering.

| Query | Monthly | Note |
|---|---:|---|
| `улучшить фото` | 321 134 | cluster head |
| **`улучшить качество фото`** | **254 124** | the money phrase — **5.7× the noun form** |
| `восстановить фото` | 68 511 | partly "recover deleted photos" — do not target bare |
| `увеличить фото` | 52 360 | |
| **`улучшить качество видео`** | **49 120** | video guide, already targeted |
| `улучшение качества фото` | 44 769 | ← the old `<title>` form |
| `замедленное видео` / `замедлить видео` | 27 445 / 26 683 | slow-motion guide |
| `размытое фото` | 24 407 | |
| **`реставрация фото`** | **21 306** | 4.5× `восстановить старое фото` |
| `увеличить разрешение фото` | 9 992 | **11× `повысить разрешение`** (915) |
| `увеличить картинку` + `улучшить качество картинки` | 8 736 + 7 938 | *картинка* was absent from the copy |
| `remini` | 10 675 | `pixelup` and `enhancefox` are 33 each — negligible in RU |
| `восстановить старое фото` | 4 708 | |
| `апскейл фото` | 4 080 | jargon, real but small |
| `увеличить фото без потери качества` | 4 002 | already the 4K title |
| `слоу мо` | 3 967 | |
| `улучшить четкость фото` | 2 033 | beats `улучшить резкость фото` (1 222) |
| `убрать размытие с фото` | 1 852 | note **с** фото, not **на** фото |
| `улучшить лицо на фото` | 1 169 | |
| `колоризация фото` / `раскрасить черно белое фото` | 752 / 750 | |
| `осветлить темное фото` | 116 | long tail, left alone |
| plёnka / негатив | ~0 | no measurable RU demand, left alone |

**Excluded as wrong intent** — the two biggest numbers in the export are traps:
- `оживить фото` **342 976** — the largest query in the whole corpus, and it means *animating* a face (Deep Nostalgia / MyHeritage). Its child queries carry no restoration modifiers at all. UScale does not animate photos.
- `размыть фото` **19 670** — the opposite operation. People want to *add* blur. Only `убрать размытие` (1 852) and `размытое фото` (24 407) are ours.

**`нейросеть` vs `ИИ`: effectively tied** — 79 238 vs 85 341 across the corpus. The earlier hypothesis that `нейросеть` dominates was wrong; `ИИ` is marginally ahead. But `нейросеть` appeared **zero** times in the Russian copy against 26 for `ИИ`, so it was pure unclaimed demand and now carries the home `<title>` while `ИИ` keeps the guide titles.

**Intent split — `онлайн` is 748 176 of the corpus.** Roughly half of `улучшить качество фото` (130 658 of 254 124) is `онлайн`, i.e. people who want a browser tool, not an App Store listing. The addressable slice is the qualified one: `айфон|iphone|ios` 22 631, `приложение` 13 202, `телефон` 7 144. Head numbers massively overstate what an iOS app can win — same lesson as German `bild vergrößern`.

**`айфон` belongs in the copy, never in a title.** `как замедлить видео на айфоне` is 4 483 against 128 for the Latin spelling of the same question — 35:1 for Cyrillic. But `айфон` is colloquial and a page title is a brand surface, so **every `<title>`, H1 and card title keeps `iPhone`**. The Cyrillic form is carried instead by Russian-only FAQ entries phrased the way people actually ask, on the three pages where the query is big enough to matter: home (`как улучшить качество фото на айфоне`, 1 009 + 1 244 for the `улучшить фото` variant), slow motion (4 483) and video quality (488). These are real answers that also feed the existing FAQPage JSON-LD — not a list of keyword variants, which would be stuffing and would earn a penalty rather than traffic.

Mechanically these are `{"localizations": {"ru": ...}, "locales": ["ru"]}` records at a free FAQ index; `_compact` in `build/localization_catalog.py` closes the gap left by the entries that are `excludedLocales: ["ru"]`, so English and German pages are untouched (6 questions each, Russian 4).

**The slow-motion guide was the worst miss.** It was titled `Как сделать плавное замедленное видео на iPhone` — `плавн*` totals **433** across all 4 678 queries, while `замедлить видео` is 26 683 and the айфон-qualified form alone is 4 483. Retargeted to `Как замедлить видео на iPhone`. Adjacent finding: CapCut owns a large share of this cluster (`как замедлить видео в кап куте` and variants, ~5k combined).

Placement: `улучшить качество фото` + `нейросеть` → home `<title>` · `увеличивайте разрешение` → home H1 (was `повышайте`, 11× weaker) · `реставрация старых фото` → restore guide · `как замедлить видео` → slow-motion guide · `убрать размытие с фото` → unblur guide · `улучшить лицо на фото` → faces guide · `картинка` → 4K guide description · `айфон` → Russian-only FAQ entries only.

**Already correct before this pass, confirmed by the data:** `увеличить фото без потери качества` in the 4K title (4 002, exact match), `улучшить качество видео` in the video title (49 120, exact match), and `iPhone` throughout rather than `смартфон`.

### 🇮🇳 Hindi (`/hi/`) — India store also converts on English terms
`video enhancer` (p47, d41) · `ai photo enhancer` (p43, d64) · `enhance photo quality` (p30, d50) · `ai enhancer` (p23, d38) · `पुरानी फोटो सुधारें` · `एआई फोटो एन्हांसर` · `छवि गुणवत्ता बढ़ाएँ` · `वीडियो क्लियर करें` · `फ़ोटो को धुंधला और साफ़ करें`
→ Hindi pages are written bilingually (Hindi copy, English technical terms kept in Latin script) because that is how the market actually searches.

### 🇹🇷 Turkish (`/tr/`)
`fotoğraf netleştirme` (p59, d48) · `yüz düzeltme` (p50, d64) · `yapay zeka video` (p45, d62) · `resim netleştirme` (p18, d38) · `fotoğraf netleştirme ücretsiz` (p19, d36) · `fotoğraf kalitesi iyileştirme` (p5, **d16**) · `fotoğraf kalitesini geliştirin` (p5, **d9**)

---

## 4. Page → keyword map (URL architecture)

```
/                                  ai photo enhancer, enhance photo quality, unblur photo (en, x-default)
/{lang}/                           localised head terms above           (de, ru)
/guides/                           "ai photo enhancer guides", hub
/guides/<slug>.html                one long-tail keyword each           (10 guides)
/{lang}/guides/                     localised hub
/{lang}/guides/<slug>.html          localised long-tail                 (10 pages per locale)
/support_page.html                 brand + "uscale support"             (kept, redesigned)
/terms.html /privacy_policy.html   legal                                (kept, redesigned)
/sale.html                         "uscale discount / lifetime deal"    (kept, redesigned)
```

Current indexable set: **48 pages** — English, German and Russian versions of the landing, guide hub, 10 guides, comparison, support, terms and privacy pages. `/sale.html` is `noindex,follow` in every locale and stays out of the sitemap. A locale joins the indexable `hreflang` cluster automatically once it is translated in every section file under `localization/`; locales without translated content cannot be built.

## 5. On-page SEO checklist applied to every generated page

- One `<h1>` containing the primary keyword, `<h2>` per section with secondary keywords
- `<title>` ≤ 60 chars, `<meta name="description">` 140–160 chars, both keyword-led and benefit-led
- Canonical URL + reciprocal `hreflang` cluster for every translated locale, plus `x-default`
- Open Graph + Twitter card, OG image = App Store screenshot 1
- JSON-LD: `MobileApplication` + `AggregateRating` (4.6 / 1,579) + `Offer` on landings; `HowTo` + `FAQPage` + `BreadcrumbList` on guides; `Organization` + `WebSite` site-wide
- Descriptive `alt` text on every image using the target keyword naturally
- `width`/`height` on every image, `loading="lazy"` below the fold → no CLS
- Zero render-blocking external requests (all CSS/JS inlined or same-origin, no web fonts, no trackers)
- Internal linking: landing → all 10 guides, guide → 2 sibling guides + landing + App Store
- `sitemap.xml` with `xhtml:link` alternates, `robots.txt` pointing at it
