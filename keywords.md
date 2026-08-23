# UScale — Keyword Research & SEO Map

Date: **2026-08-21** · Domain: **upscales.app** · App: **AI Photo Enhancer, UScale** (id 6736931330)

**Data sources**
1. **AstroMCP** (`http://127.0.0.1:8089/mcp`) — 583 tracked App Store keywords for this app across 28 stores, with `popularity` (0–100 Apple search-volume proxy), `difficulty` (0–100) and live ranking. This is *real* demand data for the exact audience that installs apps, so it drives the head-term choice in every locale.
2. **Web SERP research** — what actually ranks for the informational long-tail (`perfectcorp.com`, `cyberlink.com`, `videoproc.com` blog posts, competitor App Store pages). This drives the guide topics.

**Selection rule used:** pick terms where (a) intent ends in *"I need an app on my phone right now"*, and (b) we can plausibly rank — so we go after **long-tail informational + app-modifier** queries on the web, and reinforce the **head ASO terms** for brand/App Store consistency. We deliberately do **not** target `remini` / `rimini` / competitor brand names on the website (high ASO popularity, but useless web traffic and trademark risk).

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

### 🇩🇪 German (`/de/`)
`KI Bildbearbeitung` (p55, d74) · `bilder schärfer machen` (p26, d47) · `foto schärfen` (p14, d45) · `AI Foto verbessern` (p11, d45) · `bild schärfen` (p10, d59) · `fotos schärfen bilder qualität` (p7, **d21**) · `gesicht enhancer` (p5, d41) · `videoverbesserung` (p5, **d17**) · `KI Fotoverbesserung` (p5, **d13**)

### 🇮🇹 Italian (`/it/`)
`migliora qualità foto` (p51, d49) · `migliora foto` (p47, d63) · `migliora qualità video` (p20, d36)

### 🇯🇵 Japanese (`/ja/`)
`高画質化` (p63, d67) · `画質を良くするアプリ` (p59, d63) · `ノイズ除去` (p36, d38) · `画質良くする` (p30, d48) · `写真高画質` (p21, d62) · `高画質動画` (p20, d52) · `写真高画質化` (p13, d59) · `ぼやけた画像修正` (p6, d48) · `古い写真を復元` (p5, **d11**) · `解像度` (p10, d51)

### 🇰🇷 Korean (`/ko/`)
`화질 개선` (p55, d52) · `고화질 변환` (p48, **d23**) · `사진 화질 개선` (p24, d46) · `사진 고화질` (p21, d48) · `사진 화질` (p17, d50)

### 🇨🇳 Simplified Chinese (`/zh/`)
`画质修复` (p62, d65) · `高清修复` (p34, d55) · `修复模糊图片` (p31, d47) · `照片修复` (p29, d67) · `老照片修复` (p25, d47) · `视频高清修复` (p5, d46) · `图片清晰放大` · `ai照片修复` (p16, d58)

### 🇷🇺 Russian (`/ru/`)
`улучшение качества фото` (p51, d55) · `улучшить качество фото` (p45, d52) · `улучшить качество видео` (p39, d38) · `качество фото` (p36, d47) · `улучшение качества видео` (p30, **d23**) · `улучшить фото` (p29, d62) · `улучшить изображение` (p5, **d7**) · `колоризация фото` (p5, **d5**) · `фото четче` (p5, **d5**)

### 🇮🇳 Hindi (`/hi/`) — India store also converts on English terms
`video enhancer` (p47, d41) · `ai photo enhancer` (p43, d64) · `enhance photo quality` (p30, d50) · `ai enhancer` (p23, d38) · `पुरानी फोटो सुधारें` · `एआई फोटो एन्हांसर` · `छवि गुणवत्ता बढ़ाएँ` · `वीडियो क्लियर करें` · `फ़ोटो को धुंधला और साफ़ करें`
→ Hindi pages are written bilingually (Hindi copy, English technical terms kept in Latin script) because that is how the market actually searches.

### 🇹🇷 Turkish (`/tr/`)
`fotoğraf netleştirme` (p59, d48) · `yüz düzeltme` (p50, d64) · `yapay zeka video` (p45, d62) · `resim netleştirme` (p18, d38) · `fotoğraf netleştirme ücretsiz` (p19, d36) · `fotoğraf kalitesi iyileştirme` (p5, **d16**) · `fotoğraf kalitesini geliştirin` (p5, **d9**)

---

## 4. Page → keyword map (URL architecture)

```
/                                  ai photo enhancer, enhance photo quality, unblur photo (en, x-default)
/{lang}/                           localised head terms above           (11 locales)
/guides/                           "ai photo enhancer guides", hub
/guides/<slug>.html                one long-tail keyword each           (10 guides)
/{lang}/guides/                     localised hub
/{lang}/guides/<slug>.html          localised long-tail                 (10 × 11 = 110 pages)
/support_page.html                 brand + "uscale support"             (kept, redesigned)
/terms.html /privacy_policy.html   legal                                (kept, redesigned)
/sale.html                         "uscale discount / lifetime deal"    (kept, redesigned)
```

Total indexable pages: **12 landings + 12 guide hubs + 120 guides = 144**, all cross-linked with `hreflang` (12 locales + `x-default`).

## 5. On-page SEO checklist applied to every generated page

- One `<h1>` containing the primary keyword, `<h2>` per section with secondary keywords
- `<title>` ≤ 60 chars, `<meta name="description">` 140–160 chars, both keyword-led and benefit-led
- Canonical URL + full `hreflang` cluster (12 locales + `x-default`) on every page
- Open Graph + Twitter card, OG image = App Store screenshot 1
- JSON-LD: `SoftwareApplication` + `AggregateRating` (4.54 / 464) + `Offer` on landings; `HowTo` + `FAQPage` + `BreadcrumbList` on guides; `Organization` + `WebSite` site-wide
- Descriptive `alt` text on every image using the target keyword naturally
- `width`/`height` on every image, `loading="lazy"` below the fold → no CLS
- Zero render-blocking external requests (all CSS/JS inlined or same-origin, no web fonts, no trackers)
- Internal linking: landing → all 10 guides, guide → 2 sibling guides + landing + App Store
- `sitemap.xml` with `xhtml:link` alternates, `robots.txt` pointing at it
