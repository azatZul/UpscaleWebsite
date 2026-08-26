# ChatGPT prompt — Japanese (`/ja/`)

Paste everything below the line into ChatGPT once per chunk, followed by the
JSON file. Companion docs: [`../ABOUT.md`](../ABOUT.md) (full translator
context), [`../keywords/ja.md`](../keywords/ja.md) (SEO brief and evidence).

---

## The product

**UScale** — a free iPhone/iPad app that improves photos and videos with AI:
upscale 2×/4×, unblur and sharpen, enhance video, AI slow motion, brighten dark
shots, repair and colorize old photos, film negatives, face enhancer, Creative
Upscale for art/anime, batch. Written for ordinary iPhone owners, not engineers.
The site is a landing page, a comparison against competing apps, ten how-to
guides, support, Terms and Privacy.

Two claims must survive translation exactly:

- **Most processing runs on the device** — offline, no upload, no account. Only
  Creative Upscale and old photo restoration use cloud AI, uploading just the
  file the user picked. Never write that everything is local, never that photos
  go to a server.
- **Free to try** — 2 photos and 5 seconds of video per day; Premium removes the
  limits.

## The job

Translate the files in `localization_work/ja/`. English is the source; Russian
is an already reviewed translation — use it to resolve ambiguity, never as the
source. Follow the localization comments. Fill in every Japanese value and
change nothing else: no edits to the English, Russian or comments, no keys
added, removed or reordered, nothing left untranslated. Write real UTF-8, not
`\u` escapes, and keep the files as they are formatted.

## Rules

1. **Keep in Latin script**: `UScale`, `App Store`, `iPhone`, `iPad`, `iOS`,
   `AI`, `4K`, competitor and SDK names (Remini, waifu2x, SnapEdit, PicWish,
   BlurBuster, EnhanceFox, RevenueCat, WaveSpeedAI, Replicate, …). Never
   `アイフォン`, never `人工知能` — both are measured dead in Japanese search.
2. **In-app labels use the app's own Japanese, in 「」.** The app ships in
   Japanese, so a reader following a guide sees these on the buttons. Never
   invent a variant, never leave the English:

   | English source | Japanese label |
   | --- | --- |
   | Upscale your media | 「メディアをアップスケール」 |
   | Photos / Videos | 「写真」 / 「ビデオ」 |
   | Creative Upscale | 「クリエイティブアップスケール」 |
   | Regular Upscale | 「通常高画質化」 |
   | Face Enhancer | 「顔を強調」 |
   | Photo restoration | 「写真修復」 |
   | Enhanced Colorize | 「強化カラー化」 |
   | Restore & Colorize | 「修復＆カラー化」 |
   | Restore | 「修復」 |
   | Advanced Fix | 「高度な修復」 |
   | Upscale video | 「ビデオをアップスケール」 |
   | Enhance animation | 「アニメを強化」 |
   | Enlighten | 「明るくする」 |
   | Slow Motion | 「スローモーション」 |
   | Increase FPS | 「FPSを増やす」 |
   | Smoothed / Natural | 「スムーズ」 / 「ナチュラル」 |
   | Negative | 「ネガティブ」 |
   | Increased resolution | 「解像度の向上」 |
   | Prompt | 「プロンプト」 |
   | Upscale (the button) | 「アップスケール」 |

3. **Placeholders byte-identical**: `{rating_count}`, `{minimum_ios}`, `{off}`,
   `{annual_price}`, `{trial_days}`, `{free_photos_per_day}`. Word order around
   them may change, the braces may not.
4. **HTML byte-identical**: same tags, order, nesting, attributes, `href`, URLs,
   e-mails. Translate only visible text. The importer rejects any structural
   change.
5. **Copy numbers as-is**, in half-width digits: `2×`, `4×`, `4K`, dimensions,
   iOS versions, prices, limits.
6. **Never invent or drop a claim.** "most processing" is 「ほとんどの処理」, not
   「すべての処理」.

## Voice

Polite **です・ます** everywhere, including the legal pages, so the site keeps
one voice. **Drop the second person** — no `あなた`, no `あなたの写真`; Japanese
carries it in the verb. Full-width 、。 and 「」, half-width Latin and digits, no
space around embedded Latin words, no `！`. `home`/`compare`: confident and
factual, no hype. `guides`: plain how-to, imperative steps in 〜ます or 〜てください.
`support`: personal and helpful. `legal`: preserve meaning exactly, add no new
promises.

Japanese is shorter in characters but twice as wide per character: keep
`meta.title` **≤ 32 characters** and `meta.description` **≤ 80** (not the 60/160
of the English source), nav and button labels as short as the English, headings
close to the source length.

## SEO wording

Use the phrases Japan actually searches, not a literal keyword translation:

- Home: 高画質化 · 画質を良くする · アプリ (the `アプリ` suffix belongs on the home
  page only).
- Guide titles carry **〜方法**, the way the English ones carry "how to".
- 4K guide → 画像の解像度を上げる方法 (the largest Japanese term we measured).
- Slow motion → 動画をスローにする方法 (uncontested; do not weaken it).
- Video quality → 動画を高画質にする方法.
- Unblur → pair **画像 with 鮮明/綺麗** (ぼやけた画像を鮮明に, 荒い画像を綺麗にする).
  Never 写真 + 修正 — same meaning, four orders of magnitude less traffic.
- Colorize → 白黒写真カラー化 in the title, not the short 写真カラー化.
- Anime → name waifu2x rather than chasing アニメ高画質化.
- **Avoid 加工 and 編集 entirely.** They mean decorating and editing photos —
  57% of the Japanese market and none of it is our product.
- Old photos: use **修復** (repair), never **復元** (file recovery — a different
  intent with a bigger number).
