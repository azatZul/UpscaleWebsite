# ChatGPT prompt — Spanish (`/es/`)

Paste everything below the line into ChatGPT once per chunk, followed by the
JSON file. Companion docs: [`../ABOUT.md`](../ABOUT.md) (full translator
context), [`../keywords/es.md`](../keywords/es.md) (SEO brief and evidence).

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

Translate the files in `localization_work/es/`. **English is the source; French
is an already reviewed translation** — use it to resolve ambiguity, never as the
source. Follow the localization comments. Fill in every Spanish value and change
nothing else: no edits to the English, French or comments, no keys added,
removed or reordered, nothing left untranslated. Write real UTF-8, not `\u`
escapes, and keep the files as they are formatted.

## Rules

1. **Latin-American neutral Spanish.** Three quarters of this audience is in
   Mexico, not Spain. Use `ustedes`, never `vosotros`. Write **`video`**, never
   `vídeo` — the app writes it that way and the market outnumbers the Peninsular
   spelling 78 to 1.
2. **`IA`, never `AI`, never `inteligencia artificial`** — 60 000 : 1 900 : 1 350
   monthly searches. `con IA` is the natural modifier.
3. **Keep in Latin script and untranslated**: `UScale`, `App Store`, `iPhone`,
   `iPad`, `iOS`, `4K`, `FPS`, competitor and SDK names (Remini, waifu2x,
   SnapEdit, PicWish, BlurBuster, EnhanceFox, RevenueCat, WaveSpeedAI,
   Replicate, …).
4. **In-app labels use the app's own Spanish, in «…».** The app ships in Spanish,
   so a reader following a guide sees these on the buttons. Never invent a
   variant, never leave the English:

   | English source | Spanish label |
   | --- | --- |
   | Upscale your media | «Mejora tus medios» |
   | Photos / Videos | «Fotos» / «Videos» |
   | Creative Upscale | «Mejora Creativa» |
   | Regular Upscale | «Mejorar normal» |
   | Face Enhancer | «Mejorar rostros» |
   | Photo restoration | «Restauración de fotos» |
   | Enhanced Colorize | «Colorear mejorado» |
   | Restore & Colorize | «Restaurar y colorear» |
   | Restore | «Restaurar» |
   | Advanced Fix | «Reparación avanzada» |
   | Upscale video | «Mejorar video» |
   | Enhance animation | «Mejorar animación» |
   | Enlighten | «Iluminar» |
   | Slow Motion | «Cámara lenta» |
   | Increase FPS | «Aumentar FPS» |
   | Smoothed / Natural | «Suavizado» / «Natural» |
   | Negative | «Negativo» |
   | Increased resolution | «Resolución aumentada» |
   | Prompt | «Indicador» |
   | Upscale (the button) | «Mejorar» |

5. **Quote a label only where the English quotes a control.** Almost every label
   above is also an ordinary Spanish word — `Mejorar`, `Restaurar`, `Iluminar`,
   `Natural`, `Negativo`, `Fotos`. "Tap **Upscale**" is «Mejorar»; "improve your
   photos" is ordinary prose and takes no quotation marks. Getting this backwards
   makes the copy unreadable.
6. **Placeholders byte-identical**: `{rating_count}`, `{minimum_ios}`, `{off}`,
   `{annual_price}`, `{trial_days}`, `{free_photos_per_day}`. Word order around
   them may change, the braces may not.
7. **HTML byte-identical**: same tags, order, nesting, attributes, `href`, URLs,
   e-mails. Translate only visible text. The importer rejects any structural
   change.
8. **Copy numbers as-is**: `2×`, `4×`, `4K`, dimensions, iOS versions, prices,
   limits.
9. **Never invent or drop a claim.** "most processing" is `la mayor parte del
   procesamiento`, not `todo el procesamiento`.

## Voice

Address the reader as **tú** in marketing and guides — direct and warm, the
register the app itself uses. Legal pages keep the same `tú` so the site has one
voice; they must not gain or lose meaning. `home`/`compare`: confident and
factual, no hype. `guides`: plain how-to, imperative steps (`Abre`, `Toca`,
`Elige`). `support`: personal and helpful.

Spanish typography: **opening `¿` and `¡` are obligatory** on every question and
exclamation — they are the single most common thing a translator drops. Use «…»
for quoted controls, "…" for nested quotes. **No space before `?` `!` `:` `;`** —
that is French, not Spanish. Accents and `ñ` always correct, including on capital
letters (`Á`, `Ñ`).

Spanish runs **20–25% longer than English**. Keep `meta.title` **≤ 60
characters** and `meta.description` **≤ 160** anyway — rewrite rather than
overflow. Nav and button labels stay as short as the English; headings stay close
to the source length.

## SEO wording

Use the phrases the market actually searches, not a literal translation:

- **`calidad` belongs in almost every title** — 94% of the measured demand
  contains that word. The Spanish user does not ask to enlarge or enhance an
  image; they ask to raise its *quality*.
- **`imagen`, not `foto`, on every SEO surface** — same number of phrasings in
  the market, seventeen times the traffic. `foto` is fine in body prose.
- Home: **`mejorar calidad de imagen`** + `con IA` + `gratis` — 500 000/mo, the
  largest term in any locale we have measured.
- Video quality guide: **`mejorar calidad de video`** — 50 000/mo, the second
  pillar of this locale. Do not weaken it.
- 4K guide: `aumentar resolución de imagen`; `agrandar imagen` and
  `remasterizar imagen` in the body.
- Old photos: **`restaurar fotos antiguas`**, optionally `con IA`.
- Unblur guide: **`imagen borrosa`** in the title — the least contested large
  term in the locale; `mejorar nitidez` and `despixelar` in the body.
- Colorize guide: `colorear fotos antiguas`, `dar color a una foto`.
- Slow motion: **`poner un video en cámara lenta`** — the verb form. The bare
  noun `cámara lenta` belongs to desktop video editors; do not title with it.
- Comparison page: name **PicsArt, Snapseed, Remini and Topaz Photo AI** — brand
  demand is the second-largest surface on this site. Keep the comparison factual.
- Dark photos: `foto oscura` — uncontested.
- Negatives and blurry faces have **no measurable Spanish demand**. Translate
  those two guides for the reader, not for a keyword; do not stretch the copy
  toward `digitalizar negativos`, which is a paid-scanning market.
- Verbs: `mejorar` first, `subir` and `aumentar` as variants. **Never `escalar`**
  — it does not exist in this market.
- **Avoid `editar`, `editor`, `edición` and `retoque` entirely.** They point at
  the photo-editing market, which is not our product.
- **Do not put iPhone in Spanish titles** — phone words are 0.1% of the demand,
  the lowest of any locale. Inside the body copy it is fine.
