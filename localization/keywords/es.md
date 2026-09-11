# 🇪🇸 Spanish keywords — `/es/`

Part of the UScale keyword map. Shared rules, the English head terms and the
page architecture live in [`../../keywords.md`](../../keywords.md); this file holds
everything specific to this locale.

Status: researched, not yet translated

---

## Which Spanish

The Planner pull covers **Spain and Mexico together**, and the split is the first
finding of this file:

| Segment | Seed volume | Share |
|---|---:|---:|
| **Mexico** | 436 251 | **77.0%** |
| Spain | 130 349 | 23.0% |

Three quarters of the Spanish-language demand for our topic is Latin American.
The App Store agrees — the `mx` head term outranks the `es` one (p56 against
p51). **Write Latin-American-neutral Spanish**, not Peninsular: `ustedes` never
`vosotros`, `video` never `vídeo`, `computadora`/`celular` if either is ever
needed. The app already does this — `es` and `es-MX` diverge in only two of its
22 interface labels.

One `/es/` page serves both. Nothing in the data justifies a second locale.

---

## ASO — stores `es` and `mx`

Only **11 keywords are tracked in `es` and 7 in `mx`** (French had 105). This
section is therefore the weak half of the brief and the web section below
carries the placement decisions.

| Keyword | store | p | d |
|---|---|---:|---:|
| **`editar fotos`** | es | **62** | 70 | ← trap, see below
| `mejorar calidad de fotos` | mx | **56** | 63 |
| `mejorar calidad fotos` | es | **51** | 52 |
| `mejorar calidad de videos` | mx | 45 | 43 |
| `mejorar fotos` | mx / es | 45 / 26 | 64 / 65 |
| `aclarar fotos` | es | 23 | 57 |
| `mejorar calidad videos` | es | 22 | 47 |
| `arreglar fotos` | es | 21 | 72 |
| `mejorador de fotos` | mx / es | 20 / 16 | 52 / 61 |
| `calidad fotos` | es | 18 | 53 |
| `mejora la calidad de la foto` | mx | 16 | 52 |
| `enhancefox` | es | 8 | **21** |
| `mejorar foto` | es | 6 | 65 |
| `aumentar calidad fotos` | es | 5 | 60 |
| `mejorar fotos con ia` | mx | 5 | 57 |

**The field around our head terms is beautification and collage, not
enhancement.** Competitor extraction on the three biggest tracked terms returns,
in `es`: picsart 78 · fotos 72 · **ia 70** · remini 67 · collage 63 · ai 61 ·
facetune 60 · app 57 · editor fotos 53 · editar 49. In `mx`: picsart 83 · vsco 75
· remini 70 · meitu 67 · facetune 61 · maquillaje 59 · body tune 56. Seeding on
`editar fotos` instead returns inshot 74 · snapseed 71 · dazz cam 70 · body
editor 61 · filtros 51 · vintage 47 · aesthetic 34 — a different market.

**`ia` p70 beats `ai` p61 in the Spanish store**, and `vídeos` p13 against `video`
p56. Both match the web numbers below exactly, which is unusual — in French and
Japanese the store and the web disagreed.

---

## Web demand — Google Keyword Planner, Spain + Mexico, Aug 2025 – Jul 2026

Twelve seeds expanded to **1 845 keywords / 2 791 350 searches per month**.

Two caveats that apply to every number here. Planner reports **order-of-magnitude
buckets** (50 · 500 · 5 000 · 50 000 · 500 000), so a single bucket step is
printed as `−90%` or `900%` and almost none of the change columns mean anything.
And the corpus is **seeded**, so a term absent from it may be absent from the
seeds rather than from the market; the gaps at the end of this file are flagged,
not concluded.

### The head

| Keyword | Monthly | Comp. |
|---|---:|---:|
| **`mejorar calidad de imagen`** | **500 000** | 22 |
| `mejorar calidad de video` | 50 000 | 31 |
| `subir calidad de imagen` | 50 000 | **15** |
| `aumentar calidad de imagen` | 50 000 | **18** |
| `mejorar calidad imagen` | 50 000 | 29 |

`mejorar calidad de imagen` is the largest single term we have measured in any
locale — ten times the French head term and at *lower* competition. Planner
reports three further spellings (`…de image`, `…e imagen`, `mejorar la calidad de
imagenes`) in the same 500 000 bucket; they are the same query.

### The vocabulary is decided by the data, not by taste

| | Volume | Keywords | Verdict |
|---|---:|---:|---|
| **`imagen`** | **2 052 000** | 674 | |
| `foto` | 117 600 | 680 | **17× less, on the same number of phrasings** |
| `video` | 109 400 | 347 | |
| `vídeo` | 1 400 | 10 | 78:1 against the Peninsular spelling |
| **`calidad`** | **2 633 000** | 975 | **94% of the entire corpus** |
| **`mejorar`** | **2 324 800** | 767 | |
| `subir` | 219 250 | 166 | real second verb |
| `aumentar` | 99 200 | 223 | real third verb |
| `restaurar` | 43 500 | 141 | |
| `remasterizar` | 5 400 | 9 | one keyword, worth carrying |
| `ampliar` / `agrandar` | 1 750 | 17 | dead |
| `escalar` | **0** | 0 | **does not exist — my own seed returned nothing** |

The single most useful sentence in this file: **the Spanish user does not ask to
enlarge, upscale or enhance an image. They ask to raise its *quality*.** 94% of
the corpus contains `calidad`. Any title without it is off-market.

`foto` and `imagen` have the same number of distinct phrasings and a 17-fold
volume gap — the same shape as French `image`/`photo`, only steeper.

### Modifiers

| | Volume | Share |
|---|---:|---:|
| `gratis` | 84 600 | 3.0% |
| `online` / `en línea` | 78 700 | 2.8% |
| **`ia`** | **60 000** | 2.2% |
| `4k` / `hd` | 16 950 | 0.6% |
| `app` / `aplicación` / `programa` | 16 700 | 0.6% |
| `iphone` / `celular` / `móvil` / `android` | **1 550** | **0.1%** |

**`IA`, never `AI`, never `inteligencia artificial`** — 60 000 : 1 900 : 1 350.
`con ia` alone is 19 800/mo and reads naturally in a title.

**Do not put iPhone in Spanish titles.** 0.1% of the corpus, the lowest of any
locale we have measured — below even French, where the slow-motion guide was the
one exception. Here there is no exception.

Accents are stripped in typed queries (`imagenes` 572 050 against `imágenes` 250;
`resolucion` 52 250 against `resolución` 11 200). That is a keyboard artefact,
not a spelling. **Prose is written correctly with accents; only measured keyword
strings follow the search spelling.**

### Traps

**`editar fotos` is the biggest ASO term in `es` and worth nothing on the web.**
`editar` / `editor` / `edición` total 1 900/mo — **0.1%** of the corpus, and
`retoque` another 950. Compare French, where `retouche` was 54% of the market and
had to be avoided in copy: in Spanish the editing market simply is not in our
neighbourhood at all. Keep `editar fotos` in ASO, keep it off the website.

**`cámara lenta` as a bare noun is an editing-software query.** 2 050/mo total
(0.1%), and the expansion is almost entirely tool-modified: capcut · after
effects · premiere · davinci resolve · filmora · imovie · final cut · sony
vegas. The seed `cámara lenta video` itself returns 50/mo. The verbal form
`poner un video en cámara lenta` is a different query and does work — see the
second pull below.

**Photoshop absorbs the how-to intent.** `restaurar fotos antiguas photoshop` 500
· `aumentar resolucion de imagen photoshop` and eleven more Photoshop variants at
50. The restoration and resolution guides must answer the question directly
enough that a reader does not go looking for the desktop route.

### What the market is worth, page by page

| Cluster | Best form | Monthly | Comp. |
|---|---|---:|---:|
| Image quality | `mejorar calidad de imagen` | **500 000** | 22 |
| Video quality | `mejorar calidad de video` | **50 000** | 31 |
| Resolution / 4K | `aumentar resolución de imagen` · `agrandar imagen` · `remasterizar imagen` · `calidad de imagen hd` | 5 000 each | 32 / **6** / 28 / **1** |
| Old photos | `restaurar fotos antiguas` · `restaurar foto con ia` · `restauracion de fotos` | 5 000 each | 50 / 59 / 53 |
| Blur / pixelation | `mejorar nitidez de imagen` · `despixelar imagen` · `arreglar imagen pixelada` · `convertir imagen borrosa a hd online` | 500 each | 31 / 23 / 25 / **18** |
| Dark photos | `foto oscura` · `foto muy oscura` | 500 each | **0** |
| Anime | `mejorar calidad de imagen anime` · `…waifu2x` | 50 | **1** |
| Colorize | `colorear foto antigua online` | 50 | 47 |
| Faces | — | **no data** | |
| Negatives | — | **no data in the expansion** | |
| Competitor brands | not seeded in this pull | | |

The last four rows are superseded by the second pull below — the first corpus
under-reported them because it was never seeded on them.

Two seeds returned **no volume at all**: `colorear fotos en blanco y negro` and
`mejorar rostros foto`. Both are below Planner's reporting threshold.

### Second pull — 12 seeds, Spain + Mexico, 29 Aug 2026

Seeded on the vocabulary the first corpus revealed. **162 050/mo across the 12
seeds**, and the split moves toward Spain (Mexico 92 917 / 57%, Spain 69 133 /
43%) because the brand queries are more Peninsular. Seeds only this time — no
idea expansion, so there is no long tail inside these clusters.

| Seed | Monthly | Comp. |
|---|---:|---:|
| `picsart` | **50 000** | **7** |
| `snapseed` | **50 000** | 26 |
| `remini` | **50 000** | 41 |
| **`imagen borrosa`** | **5 000** | **1** |
| `topaz photo ai` | 5 000 | 67 |
| `colorear fotos antiguas` | 500 | 35 |
| `dar color a una foto` | 500 | 32 |
| `digitalizar negativos` | 500 | **92** |
| `poner un video en camara lenta` | 500 | 22 |
| `iluminar foto oscura` | 50 | 17 |
| `mejorar cara borrosa` | **no data** | |
| `pasar negativos a fotos` | **no data** | |

Four things change because of this pull:

**`imagen borrosa` is the best ratio in the locale** — 5 000/mo at competition
**1**. Ten times the volume of `mejorar nitidez de imagen` and effectively
uncontested. It becomes the unblur guide's title target.

**Brand demand is real and cheap: 155 000/mo.** `picsart` at competition **7** is
the cheapest large term anywhere in this locale, `snapseed` 26, `remini` 41.
`compare.html` is not the weak surface I assumed from the first corpus — it is
the second-biggest opportunity on the site.

**Slow motion has a verbal form after all.** `poner un video en camara lenta`
500/mo at competition 22, against 50/mo for the bare noun. The page survives, but
only if it is titled with the verb; `cámara lenta` alone still belongs to CapCut.

**`digitalizar negativos` is a trap of the French `négatif photo` shape.**
500/mo, but competition **92** — the highest number in either pull. That is a
paid digitisation-service market bidding against us, not people looking for a
phone app. Do not target it.

**Faces are confirmed absent.** `mejorar rostros foto` returned nothing in the
first pull and `mejorar cara borrosa` nothing in the second. Two independent
seedings — this is a fact about the market, not a gap in the seeds.

---

### Placement map for `/es/`

| Page | Target | Monthly | Comp. |
|---|---|---:|---:|
| `/` home | **`mejorar calidad de imagen`** + `con IA` + `gratis` | **500 000** | 22 |
| `compare.html` | `picsart` **50 000** · `snapseed` **50 000** · `remini` **50 000** · `topaz photo ai` 5 000 | **155 000** | **7**–67 |
| `enhance-video-quality` | **`mejorar calidad de video`** — the second-largest single term in the locale | **50 000** | 31 |
| `unblur-photo-iphone` | **`imagen borrosa`** — best ratio in the locale; `mejorar nitidez` and `despixelar` in the body. **Drop iPhone from the title** | **5 000** | **1** |
| `upscale-image-4k` | `aumentar resolución de imagen`; `agrandar imagen` and `remasterizar imagen` in the body | 5 000 | 6–32 |
| `restore-old-photos` | **`restaurar fotos antiguas`** + `con IA` — promote, unlike French | 5 000 | 50 |
| `colorize-black-and-white-photos` | **`colorear fotos antiguas`** + `dar color a una foto` | 1 000 | 32–35 |
| `brighten-dark-photos` | **`foto oscura`** — 500/mo at competition **0**; `iluminar foto oscura` in the body | 500 | **0** |
| `slow-motion-video` | **`poner un video en cámara lenta`** — the verb form only; the bare noun belongs to CapCut | 500 | 22 |
| `upscale-anime-art` | name waifu2x, as in French | 50 | 1 |
| `film-negative-to-photo` | **no viable target** — `digitalizar negativos` is a paid-scanning market at competition 92 | | |
| `fix-blurry-faces` | **no data in either pull** — write it for internal linking, not for search | | |

The shape of this locale differs from every other one we have measured. In
French the comparison page carried the locale and restoration was dropped; in
Japanese the comparison page was the weak surface. Here **both** poles are
strong — a 500 000/mo head term *and* 155 000/mo of cheap brand demand — while
the two guides that anchor other locales, faces and negatives, have no market at
all.

**Rules for the Spanish copy**, all evidence-backed above:

- **`calidad` belongs in almost every title** — 94% of the market contains it
- **`imagen` over `foto` on every SEO surface** — 17:1
- **`video`, never `vídeo`** — 78:1, and it matches the app
- **`IA`, never `AI`, never `inteligencia artificial`** — 32:1:0.7
- **`mejorar` first, `subir` and `aumentar` as the variants**; never `escalar`,
  avoid `ampliar` and `agrandar` outside the 4K guide
- **`gratis` and `online` are the two modifiers that exist**; `app` is 0.6% and
  cannot be leaned on
- **Never put iPhone in a Spanish title** — 0.1%, no exceptions in this locale
- **Avoid `editar`, `editor` and `retoque` entirely** — the ASO head term has no
  web counterpart and the words point at a different market
- Latin-American register: `ustedes`, no `vosotros`, no Peninsular spellings
- Accents in prose always; only measured keyword strings follow search spelling
- Spanish runs 20–25% longer than English — `meta.title` ≤ 60 and
  `meta.description` ≤ 160 will bind, and `mejorar calidad de imagen` alone is 25
  characters

---

## Open items

1. **ASO is under-measured** — 18 tracked keywords against French's 105. A
   candidate list is ready to add to the tracker.
2. **The second pull has no idea expansion**, only the 12 seeds. The clusters it
   opened — brands, `imagen borrosa`, colorization, the slow-motion verb form —
   have no measured long tail, so the guide titles below the head term are
   chosen from a single data point each.
