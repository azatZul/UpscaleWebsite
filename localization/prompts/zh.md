# Translator prompt — Simplified Chinese (`/zh/`)

Paste everything below the line into the translator once per chunk, followed by
the JSON file. Companion docs: [`../ABOUT.md`](../ABOUT.md) (full translator
context), [`../keywords/zh.md`](../keywords/zh.md) (SEO brief and evidence).

---

## The product

**UScale** — a free iPhone/iPad app that improves photos and videos with AI:
upscale 2×/4×, unblur and sharpen, enhance video, AI slow motion, brighten dark
shots, repair and colorize old photos, film negatives, face enhancer, Creative
Upscale for art/anime, batch. Written for ordinary iPhone owners, not engineers.
The site is a landing page, a comparison against competing apps, ten how-to
guides, support, Terms and Privacy, and a free in-browser upscaler.

Two claims must survive translation exactly:

- **Most processing runs on the device** — offline, no upload, no account. Only
  Creative Upscale and old photo restoration use cloud AI, uploading just the
  file the user picked. Never write that everything is local, never that photos
  go to a server. "most processing" is 「大部分处理」, not 「所有处理」.
- **Free to try** — limited free use per day; Premium removes the limits.

## The job

Translate into **Simplified Chinese for mainland China**. English is the
source; Russian is an already reviewed translation — use it to resolve
ambiguity, never as the source. Follow the localization comments. Translate
every record, change nothing else.

## Rules

1. **Keep in Latin script**: `UScale`, `App Store`, `iPhone`, `iPad`, `iOS`,
   `Mac`, `AI`, `4K`, `HEIC`/`JPEG`/`PNG`, competitor and SDK names (Remini,
   waifu2x, BlurBuster, EnhanceFox, RevenueCat, WaveSpeedAI, Replicate, …).
   Exception: PicWish is written **佐糖 (PicWish)** — the Chinese brand is ten
   times the Latin one in search.
2. **In-app labels use the app's own Simplified Chinese, in “”.** The app ships
   in Chinese, so a reader following a guide sees these on the buttons. Never
   invent a variant, never leave the English:

   | English source | Chinese label |
   | --- | --- |
   | Upscale your media | “提升您的媒体” |
   | Photos / Videos | “照片” / “视频” |
   | Creative Upscale | “创意放大” |
   | Regular Upscale | “常规放大” |
   | Face Enhancer | “人脸增强” |
   | Photo restoration | “照片修复” |
   | Enhanced Colorize | “增强上色” |
   | Restore & Colorize | “修复与上色” |
   | Restore | “修复” |
   | Advanced Fix | “高级修复” |
   | Upscale video | “提升视频” |
   | Enhance animation | “增强动画” |
   | Enlighten | “提亮” |
   | Slow Motion | “慢动作” |
   | Increase FPS | “提高帧率” |
   | Smoothed / Natural | “平滑” / “自然” |
   | Negative | “负片” |
   | Increased resolution | “提高分辨率” |
   | Prompt | “提示” |
   | Upscale (the button) | “提升” |

   Quote a label only where it names the control; the same words in running
   text ("restore your photo") are ordinary vocabulary and are not quoted.
3. **Placeholders byte-identical**: `{rating_count}`, `{minimum_ios}`, `{off}`,
   `{annual_price}`, `{annual_sale_price}`, `{sale_percent}`, `{trial_days}`,
   `{free_photos_per_day}`, `{scale}`, `{time}`, … Word order around them may
   change, the braces and names may not.
4. **HTML byte-identical**: same tags, order, nesting, attributes, `href`, URLs,
   e-mails. Translate only visible text and `alt` / `aria-label` / `title`.
   The importer rejects any structural change.
5. **Copy numbers as-is**, in half-width digits: `2×`, `4×`, `4K`, dimensions,
   iOS versions, limits, years.
6. **Never invent or drop a claim.** No new promises, no hype words the English
   does not have (no 最强, 第一, 100%).

## Glossary

One word per idea across the whole site, so ten chunks read as one voice:

| English | Chinese |
| --- | --- |
| upscale (in prose) / resolution | 放大 / 分辨率 |
| unblur, sharpen | 让…变清晰, 去模糊 / 锐化 |
| restore / restoration | 修复 |
| old-photo restoration (all modes) | 老照片修复（所有修复模式）；不要缩写为“高级修复”，那只是其中一个模式 |
| colorize | 上色 |
| enhance video | 修复视频画质 / 让视频变清晰 |
| slow motion · frame interpolation | 慢动作 · 帧插值 (the app's word) |
| on your device · offline | 在你的设备上 (本地) · 离线 |
| cloud model(s) | 云端 AI 模型 |
| Premium · Pro | Premium · Pro (Latin, as the app) |
| free trial · annual subscription | 免费试用 · 年订阅 |
| credits (tool) | 积分 |
| batch | 批量处理 |
| sign in · account | 登录 · 账户 |
| tap · Home Screen · the Photos app · Settings | 轻点 · 主屏幕 · “照片” App · “设置” |
| before / after | 处理前 / 处理后 |
| film negative | 底片 (负片 for the app switch and the technical term) |

## Voice and typography

- **你** in home, compare, guides and the tool — direct and friendly, the
  register Apple China uses. **您** in support and legal, where Chinese
  convention expects it. Never mix inside one page.
- `home`/`compare`: confident and factual. `guides`: plain how-to, short
  imperative steps (打开…, 轻点…, 选择…). `support`: personal and helpful.
  `legal`: preserve meaning exactly, formal register.
- Full-width punctuation: ，。：；！？（）“” 、. Half-width Latin and digits.
- **One half-width space between hanzi and Latin letters or digits**, the way
  Apple China writes: 在 iPhone 上、放大到 4K、支持 iOS 16. No space next to
  full-width punctuation, none inside “”.
- Ranges and separators: use 「–」 as the English does; keep ` · ` separators.
- No `!` stacks, no emoji, no 亲.
- Chinese is about half the length of English in characters: keep headings,
  nav and buttons short. `title` / `meta.title` **≤ 30 characters**,
  `description` / `meta.description` **≤ 80 characters**.

## SEO wording

Use the phrases China actually searches, not a literal keyword translation:

- **图片 for search copy, 照片 for the app's label.** On the web 图片变清晰 /
  图片高清 / 图片放大 are ten times their 照片 forms.
- Head term: **画质修复**, then **图片变清晰** and **高清修复**.
- Unblur: **模糊图片变清晰** and **修复模糊图片**.
- 4K: **图片放大**, **提高分辨率**, 无损放大.
- Old photos: **老照片修复**. Colorize: **黑白照片上色** / 老照片上色.
- Video: **视频画质修复** / 视频变清晰. Slow motion: **慢动作视频** / 视频慢放 /
  补帧. Faces: **人脸修复**. Negatives: **底片扫描** / 负片转正片.
  Dark photos: **照片太暗** / 调亮. Anime: name **waifu2x**, 动漫高清.
- Write `AI`, not 人工智能 (once on the home page is fine).
- Guide titles carry **如何** the way the English ones carry "how to".
- **Never use 修图, 美颜, P图, 照片编辑** — they mean retouching and beauty
  filters, the largest part of the Chinese market and not our product.
- **Repair is 修复, never 恢复** — 恢复照片 / 数据恢复 means getting deleted
  files back, a different intent.
- Never 模糊处理 / 打码 — that is adding blur.

### Fixed titles

Use these exactly for the SEO-carrying fields (`title` / `meta.title`, and
`h1` close to them):

| Key | Chinese |
| --- | --- |
| `meta.title` (home) | `iPhone AI 画质修复：模糊图片变清晰｜UScale` |
| `guide_pages.unblur-photo-iphone.title` | `如何在 iPhone 上让模糊图片变清晰（免费）` |
| `guide_pages.restore-old-photos.title` | `如何用 AI 修复老照片（2026）` |
| `guide_pages.colorize-black-and-white-photos.title` | `如何用 AI 给黑白照片上色（iPhone）` |
| `guide_pages.upscale-image-4k.title` | `如何把图片放大到 4K、提高分辨率` |
| `guide_pages.enhance-video-quality.title` | `如何在 iPhone 上修复视频画质（2026）` |
| `guide_pages.slow-motion-video.title` | `如何在 iPhone 上制作慢动作视频（AI 补帧）` |
| `guide_pages.brighten-dark-photos.title` | `照片太暗？如何在 iPhone 上无损调亮` |
| `guide_pages.film-negative-to-photo.title` | `如何用手机扫描底片，负片转正片` |
| `guide_pages.fix-blurry-faces.title` | `如何修复照片中的模糊人脸（AI 人脸修复）` |
| `guide_pages.upscale-anime-art.title` | `如何在 iPhone 上像 waifu2x 一样放大动漫图片` |
| `guides_index.title` | `UScale 教程：图片变清晰、放大与老照片修复` |
