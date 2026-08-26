# 🇯🇵 Japanese keywords — `/ja/`

Part of the UScale keyword map. Shared rules, the English head terms and the
page architecture live in [`../../keywords.md`](../../keywords.md); this file holds
everything specific to this locale.

Status: live

---


**ASO popularity**, store jp, pulled 2026-08-26. 93 keywords now tracked (was 35). Note the floor: **Apple reports p5 as its minimum**, so a p5 row means *below the measurement threshold*, not *no demand* — the same caveat as a Trends zero. 57 of the 93 sit at that floor.

| Keyword | p | d | our rank | apps |
|---|---:|---:|---:|---:|
| `写真加工` | **74** | 83 | — | 250 | ← **trap, see below** |
| `remini` | **68** | 67 | 76 | 244 |
| `高画質化` | **63** | 67 | — | 247 |
| `画質を良くするアプリ` | **59** | 63 | — | 250 |
| `画像加工アプリ` | 55 | 77 | — | 249 | ← **trap** |
| `snapedit` | 44 | 58 | — | 54 |
| `ai写真` | 37 | 68 | — | 246 |
| **`ノイズ除去`** | **36** | **38** | — | 248 |
| **`スロー再生`** | **36** | 47 | — | 184 |
| `yome2x` | 33 | 40 | **20** | 24 |
| `高画質化無料` | 33 | 55 | 31 | 248 |
| `画質良くする` | 30 | 52 | 79 | 122 |
| `写真ぼかし` | 29 | 69 | — | — | ← **trap** |
| `写真復元` | 27 | 44 | — | — | ← **trap** |
| `動画高画質化` | 25 | 47 | — | 179 |
| `写真高画質` | 23 | 62 | 50 | 248 |
| `スローモーション` | 21 | 54 | 123 | 247 |
| **`写真カラー化`** | **20** | **19** | — | 219 |
| `画質良くするアプリ` / `高画質動画` | 18 | 47 / 52 | 24 / — | |
| `かんたん高画質化` | 17 | 43 | — | 70 |
| `レミニ` | 17 | 65 | 176 | 247 |
| `画像高画質化` | 14 | 56 | 67 | 247 |
| `写真高画質化` | 13 | 59 | **15** | 249 |
| `画質改善` / `写真画質` | 11 | 48 / 58 | 213 / 53 | |
| `解像度` | 10 | 51 | 83 | 250 |
| `bigjpg` | 9 | 42 | 44 | 91 |
| `picwish` / `顔補正` | 8 | 58 / 67 | — | |
| `waifu2x` | 6 | 47 | 29 | 245 |

**Four traps, and together they are the biggest thing in the market.** Japanese photo search is dominated by an intent that is not ours:
- **`写真加工` p74** — the largest single term measured, larger than `remini` and `高画質化`. It means *decorating* a photo: beauty filters, stickers, SNOW/BeautyPlus. With `画像加工アプリ` p55 behind it, this is the top of the market and it is a different product. Same shape as the Russian `оживить фото` (343k) trap.
- **`写真ぼかし` p29** — *adding* blur to hide a face, the opposite operation. Only the `ぼやけた〜` forms are ours.
- **`写真復元` p27 vs `写真修復` p5** — a 5× gap between two words that both translate as "restore". **復元 is file recovery** (deleted photos, SD cards); **修復 is repair**, which is what we do. The big number is not ours. Use 修復.

**`AI` beats `人工知能` outright** — `ai写真` p37 against `人工知能写真` p5 (floor). Latin `AI` is the only form to use in Japanese copy. Analogous to the RU `нейросеть`/`ИИ` check, but with a far clearer margin.

**The `アプリ` suffix is stem-dependent, not a universal multiplier.** It swings both ways on near-identical stems: `画質を良くする` p5 → `画質を良くするアプリ` **p59** (12× up), but `高画質化` p63 → `高画質化アプリ` p9 (7× down), and `画質良くする` p30 → `画質良くするアプリ` p18 (down). Pattern: **アプリ lifts verb-phrase stems and sinks noun stems.** So it belongs on `〜を良くする` constructions and must stay off `高画質化`.

**`写真` edges out `画像`, unlike German.** `写真高画質` p23 / `写真高画質化` p13 against `画像高画質化` p14 — near parity, with 写真 slightly ahead. This is *not* the German `Bild` : `Foto` 40:1 landslide; in Japanese both words are live and the choice is not load-bearing.

**Two clean gaps — high demand, low difficulty, we do not rank:**
- **`ノイズ除去` p36 / d38** — best ratio in the whole set at real volume.
- **`写真カラー化` p20 / d19** — best difficulty in the set. But see the web data: the two forms swap places there, so the *ASO* short form and the *SEO* long form are different targets.

**Slow motion is a top-five Japanese cluster**, which it is nowhere else: `スロー再生` p36 + `スローモーション` p21. In Russian slow-mo was mid-table; here it outranks every video-quality term.

**Anime upscaling is not an *ASO* play** — `イラスト高画質化`, `アニメ高画質化`, `線画拡大`, `イラスト拡大` are all at the p5 floor. But it *is* a web play: see `waifu2x` at 50 000/mo below. The demand is real and simply does not travel through App Store search.

**Competitors ranked:** `remini` p68 (we rank 76) · `snapedit` p44 (only 54 apps compete, we do not rank) · `yome2x` p33 (a Japanese upscaler, we rank **20**) · `bigjpg` p9 · `picwish` p8 · `waifu2x` p6. `レミニ` in katakana is a separate p17 entry — **brand demand must be counted in both scripts**, or it is undercounted by roughly a quarter.

**`iPhone` vs `アイフォン` is unresolved by ASO** — `iphone写真高画質` and `アイフォン写真高画質` both sit at the p5 floor. Unlike Russian, where Cyrillic `айфон` won 35:1 and earned its own FAQ entries, Japanese gives no signal here yet. Pending Trends.

**Web demand — Google Keyword Planner, region Japan, Aug 2025 – Jul 2026.** No anchor or stitching needed. The account has no active spend, so Google returns **order-of-magnitude buckets** (50 / 500 / 5 000 / 50 000) — terms inside one bucket are *the same order*, not equal, and no ranking within a bucket is readable. `Comp.` is Google's indexed competition, 0–100.

| Query | Monthly | Comp. | Against ASO |
|---|---:|---:|---|
| `waifu2x` | **50 000** | **1** | p6 — **ASO said dead, web says top bucket** |
| **`解像度 上げる`** | **50 000** | 29 | p5 floor — **invisible to ASO entirely** |
| `高画質化` | **50 000** | 15 | p63 — agrees |
| `写真 加工` | **50 000** | 22 | p74 — **trap confirmed at web scale** |
| `remini` | 5 000 | 33 | p68 |
| `picwish` | 5 000 | 10 | p8 |
| `アップスケール` | 5 000 | 23 | p5 floor |
| `高解像度化` | 5 000 | 33 | p5 floor |
| `画像 拡大` | 5 000 | 8 | p5 floor |
| **`白黒写真 カラー化`** | **5 000** | 17 | p5 — **10× its own short form here** |
| `ノイズ除去` | 5 000 | **4** | p36 — agrees, and lowest competition of the tier |
| `動画 高画質化` / `動画 画質 上げる` | 5 000 | 36 / 45 | p25 — agrees |
| `写真 高画質化` | 5 000 | 35 | p13 |
| `画像 加工 アプリ` | 5 000 | 27 | p55 — trap |
| `高画質化 無料` | 5 000 | 27 | p33. YoY **−90%** |
| `写真 カラー化` | 500 | 14 | p20 — **short form is 10× smaller on the web** |
| `スロー再生` | 500 | 3 | p36 — **ASO top-5, web bottom tier** |
| `snapedit` | 500 | 9 | p44 |
| `yome2x` | 500 | 8 | p33 |
| `レミニ` | 500 | 18 | p17 — katakana is 10× under Latin `remini` |
| `イラスト 高画質化` | 500 | 25 | p5 |
| `写真 修復` / `古い写真 修復` | 500 | 40 / 49 | p5 |
| `ピンぼけ 修正` | 500 | 53 | p5 |
| `ネガフィルム データ化` | 500 | **79** | p5 — high competition, small volume. Leave alone |
| `iphone 写真 高画質` | 50 | 2 | floor on both |
| `アイフォン 写真 高画質` | 50 | 0 | floor on both |
| `画像 高画質化 オンライン` | 50 | 28 | — |
| `ぼやけた写真 修正` | 50 | **86** | p7. Tiny and contested — skip |
| `アニメ 高画質化` · `絵 拡大` · `顔 高画質化` · `暗い写真 明るく` · `画像 サイズ 大きく` · `スローモーション 作り方` | 50 | — | bottom bucket |

**ASO and the web disagree so sharply that they are two different plans.** This is the strongest finding of the Japanese pass and it has no parallel in German or Russian:

- **`解像度 上げる` 50 000/mo sits at the ASO floor.** Together with `高解像度化` and `アップスケール` (5 000 each, both p5), the entire resolution cluster is invisible to the App Store and large on the web. This is the German `bild vergrößern` lesson repeating exactly — and it means **the 4K guide, not the landing page, is the biggest Japanese SEO opportunity**.
- **`スロー再生` is the mirror image**: ASO p36 (a top-five cluster) against 500/mo on the web. Slow motion sells *inside the App Store* and is not a search topic. It belongs in app copy and ASO, not in an SEO page target.
- **`remini` p68 against 5 000/mo web.** In Germany `remini` was the single largest *web* term (45.5× anchor) and justified the comparison page. In Japan it is an App Store brand only, so `/ja/compare.html` carries far less SEO weight than its German counterpart.

**`waifu2x` 50 000/mo at competition index 1.** The highest-volume, lowest-competition term measured. It is navigational — people want that specific free tool — so it is brand demand and belongs on the comparison page, not the landing page, exactly as `remini` is handled elsewhere. Note the generic forms around it are small (`イラスト高画質化` 500, `アニメ高画質化` 50): the cluster is real but **concentrated in the brand**, so the anime guide should meet it by naming waifu2x, not by targeting `アニメ高画質化`.

**Colorization flips between the two channels.** ASO: `写真カラー化` p20 beats `白黒写真カラー化` p5. Web: `白黒写真 カラー化` 5 000 beats `写真 カラー化` 500. Both are true — they measure different populations. **The guide `<title>` takes the long form; in-app and store copy take the short one.**

**No `iPhone` / `アイフォン` decision to make.** Both sit in the bottom bucket at 50/mo, on top of both being at the ASO floor. Unlike Russian — where Cyrillic `айфон` beat Latin 35:1 and earned dedicated `locales: ["ru"]` FAQ records — **the platform qualifier is simply not a Japanese search behaviour.** Do not port that mechanism to `/ja/`.

**The browser-tool split exists, but it is spelled `サイト`, not `オンライン`** — see the expansion data below. Reading it off `オンライン` alone would have missed it by a factor of seventy.

### Expansion corpus — Keyword Planner ideas, region Japan, same period

**4 863 queries** from six seeds (`高画質化`, `写真高画質化`, `画像拡大`, `動画高画質化`, `ノイズ除去`, `写真加工`). Total volume **3 579 850/mo**. Note Planner emits particle permutations as separate rows (`画像 加工` / `画像 の 加工` / `加工 画像` / `画像 を 加工`) — they share a competition index, which is how the duplicates are spotted; 4 863 rows collapse to ~4 567 real queries.

**Two-thirds of Japanese photo search is not our product.**

| Cluster | Monthly | Share |
|---|---:|---:|
| `加工` decorate | 1 701 800 | **47.5%** |
| `編集` edit | 337 350 | 9.4% |
| `モザイク` mosaic | 137 700 | 3.8% |
| `コラージュ` collage | 117 050 | 3.3% |
| `ぼかし` add blur | 100 650 | 2.8% |
| **`高画質` — ours** | **324 450** | **9.1%** |
| `イラスト` | 98 850 | 2.8% |
| `ノイズ` | 70 000 | 2.0% |
| `拡大` | 39 600 | 1.1% |

Stripping the decorate/edit/mosaic/collage/blur families leaves **2 150 queries and 1 204 900/mo** — that is the addressable Japanese market, and it is the number to plan against, not the 3.6 M headline.

**`アプリ` is 47% of the entire corpus (1 682 700/mo).** This is the most favourable structural fact in any locale we have measured. Japanese users search for *an app* by default, where Russians searched for a browser tool: RU `онлайн` was 748 k and drained roughly half of the head term away from the App Store. Japan inverts that. The suffix belongs on SEO surfaces here in a way it does not in German or Russian — subject to the ASO caveat above that it lifts verb-phrase stems and sinks noun stems.

| Modifier | Monthly | Share |
|---|---:|---:|
| `アプリ` | 1 682 700 | **47.0%** |
| `無料` | 458 800 | 12.8% |
| **`サイト`** | **214 700** | **6.0%** |
| `iphone` | 83 400 | 2.3% |
| `AI` | 62 800 | 1.8% |
| `スマホ` | 18 100 | 0.5% |
| `アイフォン` | 3 150 | 0.1% |
| `オンライン` | 3 050 | 0.1% |
| `人工知能` | **0** | — |

**`サイト` 214 700 against `オンライン` 3 050 — 70:1.** The browser-tool intent is real and sits at the very head: `高画質化 サイト` and `画質良くする サイト` are both in the **top 50 000 bucket, level with the bare terms**. The earlier reading that Japan has no browser-tool leak was drawn from `オンライン` and was wrong. It leaks — just through a different word, and at 6% rather than Russian's ~50%, so the conclusion that Japanese demand is more addressable survives on a corrected basis.

**`iPhone` beats `アイフォン` 26:1 (83 400 : 3 150)** — the exact mirror of Russian, where Cyrillic `айфон` won 35:1. Settled: keep Latin `iPhone` everywhere in Japanese, and **do not port the `locales: ["ru"]` FAQ mechanism to `/ja/`**. `人工知能` returns a literal zero across 4 863 queries, closing the AI question for good.

**`方法` is the guide-page signal.** Japanese wraps how-to intent in `〜方法`, and those queries land at 5 000 with our exact topics: `保存した画像を高画質にする方法`, `画質良くする方法`, `写真を高画質にする方法`, `動画を高画質にする方法` (**YoY +900%**). Guide `<title>`s should carry `方法`, which is what `how to` is doing in the English ones.

**Phrasing that works, and phrasing that does not.** `ぼやけた画像を鮮明に` 5 000 and `荒い画像を綺麗にする` 5 000, against `ぼやけた写真 修正` at 50/mo with competition **86**. Same intent, four orders of magnitude apart: pair **画像 with 鮮明/綺麗**, not **写真 with 修正**.

**Cheapest real terms** (5 000/mo, competition index in brackets): `ノイズ除去` **[4]** · `画像拡大` [8] · `画像高画質` [9] · `画像綺麗にする` [14] · `写真レタッチ` [14] · `動画高画質化サイト` [17].

**Video is the fastest-growing cluster** — `動画を高画質にする方法` and `動画画質良くする` both at **YoY +900%**, off a 5 000/mo base.

**Two adjacent clusters we do not serve.** `写真合成` (compositing) at 5 000 shows the lowest competition in the whole corpus once qualified — `iphone写真合成` **[1]**, `写真合成iphone` **[5]** — and `写真イラスト化` / `写真アニメ化` (style transfer) sit at 5 000 apiece. Both are cheap, iPhone-qualified traffic for features UScale does not have. Recorded as a **product** observation, not an SEO target; writing pages for them would be a bait-and-switch.

**Seed bias.** `復元`, `修復`, `カラー`, `スロー` return literal zero in the corpus above — an artefact of the six seeds, not evidence. Covered by the second pull below.

### Second expansion — seeded on the guide clusters

598 queries, **292 700/mo**, seeds `写真修復` · `白黒写真カラー化` · `スロー再生` · `解像度上げる`.

| Cluster | Monthly | Head term | Comp. |
|---|---:|---|---:|
| **`解像度`** | **167 350** | `解像度を上げる` **50 000** | 29 |
| **`スロー`** | **49 150** | `動画スロー再生` 5 000 | **4** |
| `カラー` | 30 900 | `白黒写真カラー化` 5 000 | 17 |
| `修復` + `復元` | **4 650** | `写真修復` 500 | 40 |

**`解像度を上げる` is the largest addressable Japanese term we have found** — 50 000/mo, the only top-bucket entry in this pull, confirming the direct lookup. `photoshop解像度上げる` at 5 000 sits inside the cluster, which tells us the intent is *"I need a tool for this"* — an app answer competes directly.

**Slow motion is the best opportunity in the entire Japanese dataset, and the earlier reading of it was wrong.** `スロー再生` bare is 500/mo, which is what the direct lookup measured and why it was written off as an App-Store-only topic. The *qualified* forms are ten times that and essentially uncontested: `動画スロー再生` 5 000 **[4]**, `動画をスローにする方法` 5 000 **[9]**, and **`iphone動画スロー再生` 5 000 at competition index [0]**. Real volume, iPhone-qualified, zero competition, and phrased in the `方法` guide pattern. Nothing else in Japanese combines all four.

**Colorization confirms the long form.** `白黒写真カラー化` 5 000 [17] is the head and every variant below it is 500, including the short `写真カラー化` [14]. The `<title>` takes the long form, as noted above.

**Restoration is not a Japanese topic — and what exists is not ours.** 4 650/mo across 39 queries, nothing above 500. The composition settles it: `写真修復サービス`, `カメラのキタムラ写真修復` (a camera-store chain), `古い写真復元値段` ("price"). This is demand for a **paid lab service**, not an app. Contrast Russian, where `реставрация фото` was 21 306 and genuinely ours. **Deprioritise the restore guide for `/ja/`.**

**`アプリ` dominance is cluster-specific, not global.** It is 47% of the head corpus but **0.3%** of this one, where `方法` (5.3%) and `サイト` (4.2%) lead instead. App-shopping language belongs to the `高画質化` head; the technical guide topics are how-to language. Do not paste `アプリ` into every Japanese title.

---

### Placement map for `/ja/`

| Page | Target | Monthly | Comp. |
|---|---|---:|---:|
| `/` home | `高画質化` + `画質を良くする` + `アプリ` | 50 000 ×2 | 15 / 19 |
| `upscale-image-4k` | **`画像の解像度を上げる方法`** | **50 000** | 29 |
| `slow-motion-video` | **`動画をスローにする方法`** / `iphone動画スロー再生` | 5 000 | **9 / 0** |
| `enhance-video-quality` | `動画を高画質にする方法` (**YoY +900%**) | 5 000 | 42 |
| `unblur-photo-iphone` | `ぼやけた画像を鮮明に` / `荒い画像を綺麗にする` | 5 000 | 47 / 39 |
| `colorize-black-and-white-photos` | `白黒写真カラー化` | 5 000 | 17 |
| `upscale-anime-art` | reference `waifu2x` by name; `イラスト高画質化` | 500 | 25 |
| `compare.html` | `waifu2x` **50 000** · `remini` · `picwish` 5 000 | | 1 / 33 / 10 |
| `restore-old-photos` | **deprioritise** — 4 650 total, service intent | | |
| `fix-blurry-faces` · `brighten-dark-photos` · `film-negative-to-photo` | leave as translated; all ≤500 with no usable head | | |

**Unserved gap: `ノイズ除去` 5 000/mo at competition [4]**, ASO p36 / d38, and we rank nowhere. It is the best demand-to-difficulty ratio in either channel and **no guide page covers it** — the closest is `unblur-photo-iphone`, which targets a different defect. A dedicated noise-reduction guide is the one page worth *adding* for Japanese rather than translating.

**Rules for the Japanese copy**, all evidence-backed above: `iPhone` in Latin, never `アイフォン` · `AI` in Latin, never `人工知能` · `方法` in guide titles · `画像` + `鮮明`/`綺麗`, never `写真` + `修正` · `アプリ` on the home page only · avoid `加工` and `編集` entirely, they carry 57% of the market and none of it is ours.

