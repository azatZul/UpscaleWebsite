# 🇷🇺 Russian keywords — `/ru/`

Part of the UScale keyword map. Shared rules, the English head terms and the
page architecture live in [`../../keywords.md`](../../keywords.md); this file holds
everything specific to this locale.

Status: live

---


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

