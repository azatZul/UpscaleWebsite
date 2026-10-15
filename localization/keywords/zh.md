# 🇨🇳 Simplified Chinese keywords — `/zh/`

Part of the UScale keyword map. Shared rules, the English head terms and the
page architecture live in [`../../keywords.md`](../../keywords.md); this file holds
everything specific to this locale.

Status: researched 2026-10-15

---

## Which Chinese

Simplified only (`zh-Hans`, mainland China). The app ships both `zh-Hans` and
`zh-Hant`, but the store we measured is `cn`, and Traditional would be a second
locale with its own vocabulary (解析度 / 影片 / 升級 — the app's own zh-Hant
labels already differ). Not in scope.

The app is live in the China store as **UScale 画质修改器**, subtitle
「修复模糊图片，高清修复更清晰」, annual subscription **¥189.00**.

**Google is not the search engine here.** Baidu is. Keyword Planner still
returns mainland numbers, but they are the VPN minority and almost every
term lands in the same bucket — read them as *which word wins*, never as
volume. No Baidu Index data has been pulled yet (see open items).

## ASO — store `cn`, pulled 2026-10-15

118 keywords tracked (was 23). **80 of 118 sit at the p5 floor**, which in this
store is unusually many: every guide topic — slow motion, colorize, faces,
negatives, anime, brighten, video — is at the floor in every phrasing we
tried. Only the general quality cluster and the traps clear it.

| Keyword | p | d | our rank | apps |
|---|---:|---:|---:|---:|
| `醒图` | 91 | 91 | — | 232 | ← trap (beauty editor) |
| `美图秀秀` | 90 | 91 | — | 213 | ← trap |
| `美图` | 76 | 92 | — | 212 | ← trap |
| `黄油相机` | 69 | 84 | — | 228 | ← trap |
| `美颜` | 67 | 93 | — | 228 | ← trap |
| `稿定设计` | 66 | 69 | — | 91 | ← trap (design templates) |
| `p图` | 65 | 82 | — | 240 | ← trap |
| `修图` | 64 | 83 | — | 240 | ← trap |
| `证件照` | 63 | 65 | — | 239 | ← trap (ID photos) |
| **`画质修复`** | **62** | 66 | 59 | 234 |
| `你我当年` | 61 | 53 | 211 | 245 | ← competitor (old-photo app) |
| `去水印` | 61 | 71 | — | 243 | ← trap |
| `remini` | 60 | 57 | — | 243 |
| `抠图` | 52 | 64 | — | 241 | ← trap |
| `修图神器` | 52 | 86 | 192 | 239 | ← trap |
| `数据恢复` | 39 | 43 | — | 219 | ← trap (file recovery) |
| `unblur photo` | 35 | 15 | 48 | 241 |
| **`高清修复`** | **34** | 57 | 16 | 238 |
| **`修复模糊图片`** | **31** | 48 | 51 | 169 |
| `照片修复` | 29 | 70 | 183 | 248 |
| `照片编辑` | 27 | 80 | — | 236 | ← trap |
| **`老照片修复`** | **25** | 44 | — | 244 |
| `图片修复` | 25 | 62 | — | 237 |
| `画质修改器` | 25 | 63 | **3** | 247 |
| `清晰` | 24 | 51 | — | 231 |
| `ai修复` | 17 | 48 | — | 248 |
| `ai照片修复` | 16 | 51 | 215 | 246 |
| `清晰度` | 14 | 52 | — | 225 |
| `picwish` | 9 | 50 | — | 247 |
| `waifu2x` | 7 | 21 | 20 | 181 |
| `bigjpg` | 6 | 36 | 114 | 134 |

At the floor (p5), selection: 画质增强 · 提高画质 · 照片变清晰 · 图片变清晰 ·
模糊照片变清晰 · 去模糊 · 无损放大 · 图片放大 · 提高分辨率 · 超分辨率 ·
黑白照片上色 · 老照片上色 · 照片上色 · 视频画质修复 · 视频变清晰 · 视频修复 ·
慢动作 · 视频慢放 · 视频补帧 · 补帧 · 照片变亮 · 暗光修复 · 人脸修复 ·
人像修复 · 底片 · 负片转正片 · 胶片扫描 · 动漫高清 · 二次元高清 · 佐糖 ·
照片恢复 · 模糊处理 · 打码.

Competitor-word extraction (`extract_competitors_keywords` on 画质修复 /
高清修复 / 老照片修复) only returns single tokens, but one is useful:
**`人工智能` p40**. Unlike Japanese, where 人工智能 was dead, the long form is
alive in Chinese. `AI` (p81 as a token) still wins.

## Web demand — Google Keyword Planner, region China, Oct 2025 – Sep 2026

Buckets only (no spend on the account). 94 queries; the only separation:

| Bucket | Queries |
|---|---|
| **1 000 – 10 000** | `佐糖` · `美图秀秀` · `去水印` · `抠图` |
| **100 – 1 000** | **`画质修复`** · **`高清修复`** · **`图片修复`** · **`图片变清晰`** · **`图片高清`** · **`图片放大`** · `waifu2x` · `remini` · `picwish` · `bigjpg` · `醒图` · `修图` · `p图` · `数据恢复` · `证件照` |
| 10 – 100 | everything else on the guide topics: 照片变清晰 · 照片高清 · 照片修复 · 模糊图片修复 · 去模糊 · 提高分辨率 · 无损放大 · 图片无损放大 · 超分辨率 · 老照片修复 · 老照片上色 · 黑白照片上色 · 黑白照片变彩色 · 视频画质修复 · 视频变清晰 · 视频高清修复 · 慢动作视频 · 视频慢放 · 视频补帧 · 照片太暗 · 人脸修复 · 人像修复 · 胶片扫描 · 底片扫描 · 负片转正片 · 动漫高清 |
| no data | 修复模糊图片 · 二次元高清 · 人脸增强 · 照片变亮 · 底片转照片 · 图片调亮 · all 怎么… question forms |

## What the data decides

**`图片` beats `照片` on the web, 10 : 1, in every pair we measured.**
图片变清晰 / 图片高清 / 图片修复 / 图片放大 are 100–1 000; 照片变清晰 /
照片高清 / 照片修复 are 10–100. In ASO the two are level (照片修复 p29,
图片修复 p25). So copy written for search says **图片**; the app's own label
「照片」 stays where a control is named.

**The head is `画质修复`** — the largest of our terms in both channels (p62,
web 100–1 000), and the app's store name already carries 画质. `高清修复`
(p34, 100–1 000) is the second head; we rank 16 for it.

**`修复模糊图片` is the ASO unblur term, `图片变清晰` the web one.** Same
intent, different channel — use both on the unblur guide.

**AI**: write `AI` in Latin. 人工智能 is acceptable once on the home page for
coverage, not as the default.

**Brand demand travels in two scripts**: `佐糖` (1 000–10 000 web, PicWish's
Chinese brand) is ten times `picwish`. Name it as 佐糖 (PicWish) wherever the
English names PicWish.

## Traps

Chinese photo search is dominated by intents that are not ours:

- **Beauty and editing — 美颜 · 修图 · p图 · 修图神器 · 照片编辑 · 醒图 ·
  美图秀秀 · 黄油相机.** p52–p91, the whole top of the store. These are
  face filters and editors. Never put 修图, 美颜 or p图 into a title, H1 or
  description. (修图 is the everyday word for "retouch" — avoid it in body
  copy too, it signals the wrong product.)
- **ID photos, watermark removal, cut-outs — 证件照 · 去水印 · 抠图.** Big,
  not ours.
- **File recovery — 数据恢复 (p39) · 照片恢复.** "恢复" is getting deleted
  files back. We **修复** (repair). Never write 恢复照片 for restoration.
- **Adding blur — 模糊处理 · 打码.** The opposite operation. Only the
  模糊…变清晰 / 修复模糊 forms are ours.

## Placement map for `/zh/`

Title ≤ 30 characters, description ≤ 80 — the width Baidu and Google show
for hanzi.

| Page | Target | Evidence |
|---|---|---|
| `/` home | **`画质修复`** + `图片变清晰` + `高清修复` · iPhone · AI | p62 / web 100–1k ×3 |
| `unblur-photo-iphone` | **`模糊图片变清晰`** · `修复模糊图片` | web 100–1k (图片变清晰) · p31 |
| `upscale-image-4k` | **`图片放大`** · `提高分辨率` · `4K` · `无损放大` | web 100–1k |
| `restore-old-photos` | **`老照片修复`** · `你我当年` is the store leader | p25, d44 |
| `colorize-black-and-white-photos` | `黑白照片上色` · `老照片上色` | both 10–100, no head |
| `enhance-video-quality` | `视频画质修复` · `视频变清晰` | 10–100 |
| `slow-motion-video` | `慢动作视频` · `视频慢放` · `补帧` | 10–100 |
| `brighten-dark-photos` | `照片太暗` · `调亮` | 10–100 |
| `film-negative-to-photo` | `底片扫描` · `负片转正片` | 10–100 |
| `fix-blurry-faces` | `人脸修复` · `模糊人脸变清晰` | 10–100 |
| `upscale-anime-art` | name **`waifu2x`** · `动漫高清` | waifu2x 100–1k |
| `compare.html` | `remini` · `佐糖 (PicWish)` names as on the page | 100–1k / 1k–10k |

Guide titles carry **如何 / 怎么** the way English carries "how to"; the
question forms returned no data, so keep them short: 「如何让模糊图片变清晰」,
not a full sentence.

## Open items

- **Baidu Index** (index.baidu.com, needs a Baidu account) is the only real
  web-volume source for the mainland; Google buckets cannot rank the guide
  topics against each other.
- **ICP and hosting**: Baidu ranks sites without an ICP licence and hosted
  outside the mainland lower. Nothing to do in copy; noted so the numbers are
  read with it in mind.
- All guide topics are at the ASO floor; re-pull in three months to see
  whether the Chinese pages move any of them.
