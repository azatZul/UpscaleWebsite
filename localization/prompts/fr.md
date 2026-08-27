# ChatGPT prompt — French (`/fr/`)

One request per file: paste everything below the line, then the JSON.
Companion docs: [`../ABOUT.md`](../ABOUT.md), [`../keywords/fr.md`](../keywords/fr.md).

---

Translate this JSON into French.

**Input** — a flat object of records:

```json
{"nav.guides": {"en": "Guides", "ru": "Руководства", "fr": null},
 "guides_index.title": {"en": "UScale Guides — Unblur & Upscale Photos", "fr": null,
                        "comment": "Page title; preserve product names."}}
```

`en` is the source. `ru`, where present, is a reviewed translation — use it to
resolve ambiguity, never as the source. `comment` is an instruction to you:
follow it, never translate it.

**Output** — the same object with every `"fr": null` filled in. Same keys, same
order, `en` / `ru` / `comment` untouched, one-line formatting, real UTF-8 (no
`\u` escapes). Return the JSON and nothing else.

## The product

**UScale** — a free iPhone/iPad app that improves photos and videos with AI:
upscale 2×/4×, unblur and sharpen, enhance video, AI slow motion, brighten dark
shots, repair and colorize old photos, film negatives, face enhancer, Creative
Upscale for art/anime, batch. Written for ordinary iPhone owners, not engineers.

Two claims must survive exactly:

- **Most processing runs on the device** — offline, no upload, no account. Only
  Creative Upscale and old photo restoration use cloud AI. Never write that
  everything is local, never that photos go to a server.
- **Free to try** — 2 photos and 5 seconds of video per day; Premium removes the
  limits.

## Rules

1. **`IA`, never `AI`, never `intelligence artificielle`** — French search uses
   the French initialism 30:1.
2. **Keep in Latin script as written**: `UScale`, `App Store`, `iPhone`, `iPad`,
   `iOS`, `4K`, competitor and SDK names (Remini, waifu2x, Picsart, Snapseed,
   PicWish, BlurBuster, EnhanceFox, RevenueCat, WaveSpeedAI, Replicate, …).
3. **In-app labels use the app's own French, in `« … »`** — a reader following a
   guide sees these on the buttons. Never invent a variant, never leave English:

   | English | French label |
   | --- | --- |
   | Upscale your media | « Améliorez vos médias » |
   | Photos / Videos | « Photos » / « Vidéos » |
   | Creative Upscale | « Amélioration créative » |
   | Regular Upscale | « Agrandissement classique » |
   | Face Enhancer | « Améliorer les visages » |
   | Photo restoration | « Restauration de photo » |
   | Enhanced Colorize | « Colorisation améliorée » |
   | Restore & Colorize | « Restaurer & Coloriser » |
   | Restore | « Restaurer » |
   | Advanced Fix | « Restauration avancée » |
   | Upscale video | « Améliorer la vidéo » |
   | Enhance animation | « Améliorer l’animation » |
   | Enlighten | « Éclaircir » |
   | Slow Motion | « Ralenti » |
   | Increase FPS | « Augmenter les FPS » |
   | Smoothed / Natural | « Lissé » / « Naturel » |
   | Negative | « Négatif » |
   | Increased resolution | « Résolution augmentée » |
   | Prompt | « Invite » |
   | Upscale (the button) | « Améliorer » |

4. **Quote a label only where the English quotes a control.** Every label above
   is also an ordinary French word, and `améliorer` is both the Upscale button
   and the site's main SEO verb. *Tap Upscale* → quote. *Improve your photos* →
   do not.
5. **Byte-identical**: placeholders in braces (`{off}`, `{annual_price}`, …) and
   all HTML — same tags, nesting, attributes, `href`, URLs, e-mails. Translate
   visible text only.
6. **Copy numbers as-is**: `2×`, `4×`, `4K`, dimensions, iOS versions, prices.
7. **Never invent or drop a claim.** "most processing" is *la plupart des
   traitements*, never *tous les traitements*.

## Voice

**Vouvoiement** throughout, including legal pages. A space before `: ; ! ?` and
inside `« … »`. Guides: imperative steps (*Ouvrez*, *Appuyez sur*). Comparison:
factual, never disparage a competitor. Legal: preserve meaning, promise nothing
new. Elsewhere: confident and plain, no hype.

French runs 15–20% longer than English. Keep `meta.title` **≤ 60 characters**,
`meta.description` **≤ 160**, nav and button labels as short as the English.
Overrunning a title means cutting a word — never abbreviating, never dropping
the keyword.

## SEO wording

- **`image` beats `photo` 10:1 on the head term** — prefer *image* in titles,
  headings and meta; *photo* for a specific photograph in body copy.
- **Never `retouche`, `montage` or `modifier` as product words** — they mean
  decorating and editing, a different product.
- **No `application` in titles** — French demand says *en ligne* and *gratuit*.
- **No iPhone in titles, except the slow-motion guide**, where it is mandatory.
- Home → *améliorer la qualité d'une image*, *gratuit*, *IA*.
- Unblur → *image floue* / *photo floue* in the title, *déflouter* in the body.
- 4K → *agrandir une image*, *augmenter la résolution*, *dépixeliser*.
- Colorize → *coloriser une photo* (short form), with *photo ancienne* inside.
- Slow motion → *ralentir une vidéo sur iPhone*. The verb is **ralentir**, never
  *ralenti* or *slow motion*, and **never `accélérer`** — the opposite operation.
- Film negatives → *négatif argentique*, *pellicule*. Never the bare *négatif
  photo*: it means a negative filter or a developing lab.
- Anime → name waifu2x rather than chasing *agrandir une illustration*.
