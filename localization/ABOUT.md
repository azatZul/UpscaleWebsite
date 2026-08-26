# UScale localization context

## Product

UScale is an iPhone and iPad app for improving photos and videos with AI. It can
unblur and sharpen photos, upscale images and videos, restore faces and damaged
old photographs, colorize black-and-white photos, convert film negatives, and
generate smooth slow motion.

Most everyday enhancement runs locally on the device. Creative Upscale and old
photo restoration use cloud models and upload only the file selected by the
user. Do not change or weaken that distinction in translations.

## Audience and voice

The site is written for ordinary iPhone and iPad users, not imaging engineers.
Use direct, natural language and short sentences. Marketing copy should be
confident but factual. Guides should be practical and precise. Support copy
should sound personal and helpful. Legal text must preserve the original
meaning and must not introduce new promises.

## Product terminology

Keep the product name **UScale** unchanged. Keep third-party names such as
App Store, iPhone, iPad, iOS, Remini, BlurBuster, EnhanceFox, RevenueCat,
WaveSpeedAI, and Replicate unchanged.

**In-app labels must match the app, not the English source.** The app ships in
27 languages, so a reader following a guide sees their own language on every
button. Take each label from
`Upscaler/Upscaler/Resources/Localizable.xcstrings` in the app repository and
quote it in the locale's own quotation marks (German `„…“`, Russian `«…»`) so a
verb-phrase label such as "Улучшить лица" reads as a control and not as an
instruction. Never invent a translation for a label; if the app does not
localize it, leave the English.

| Site copy (English)  | xcstrings key                             |
| -------------------- | ----------------------------------------- |
| Upscale your media   | `media-list.add-action`                   |
| Photos / Videos      | `media-type-selection.photos` / `.videos` |
| Creative Upscale     | `models.creative.title`                   |
| Regular Upscale      | `models.regular.title`                    |
| Face Enhancer        | `models.faces.title`                      |
| Photo restoration    | `models.restore.title`                    |
| Enhanced Colorize    | `options.restore-mode.colorization-pro.title` |
| Restore & Colorize   | `options.restore-mode.colorization.title` |
| Restore              | `options.restore-mode.restore.title`      |
| Advanced Fix         | `options.restore-mode.advanced-restoration.title` |
| Upscale video        | `models.regular.video.title`              |
| Enhance animation    | `models.animation.video.title`            |
| Enlighten            | `models.dark.title`                       |
| Slow Motion          | `interpolation.mode.slow-motion`          |
| Increase FPS         | `interpolation.action.increase-fps`       |
| Smoothed / Natural   | `options.style-values.classic` / `.natural` |
| Negative             | `restore.advanced-options.negative.title` |
| Increased resolution | `restore.advanced-options.increase-resolution.title` |
| Prompt               | `restore.advanced-options.details.title`  |
| Upscale (the button) | `options.upscale-action`                  |

`tests/test_localization.py` fails if an English label reaches a translated
locale. Watch the words that are ordinary vocabulary in the target language:
German "Negative" is the plural of "Negativ", so only the switch becomes
`„Negativ“`.

## Translation rules

- Preserve placeholders such as `{rating_count}`, `{minimum_ios}`, `{off}`, and
  `{annual_price}` exactly. They are replaced during the build.
- Preserve HTML tags, attribute names, URLs, and email addresses. Translate only
  visible text and accessibility attributes when the catalog comment allows it.
- Do not translate route IDs, file names, CSS classes, promo codes, user names,
  or app/product names.
- Preserve measurements and technical notation such as `2×`, `4×`, dimensions,
  iOS versions, and file formats.
- SEO titles and descriptions should read naturally in the target language and
  use the phrases that locale actually searches for, not a literal translation
  of the English keyword. `keywords.md` records the head terms per locale;
  App Store popularity there ranks app-store demand, so check the web SERP
  before letting it decide a `<title>`. Keep titles at or under 60 characters
  and descriptions at or under 160 — a quoted in-app label can push a
  translated description past the limit that the English source fitted into.
- Prices, ratings, counts, and percentages are formatted by the build from
  `build/app_facts.json`; a locale with its own store price gets its own entry
  under `pricing`. Never hard-code a number into a translation.
- There are no plural, gender, device, or locale-specific numeric variants in
  the first catalog version.

## Website structure

The public site contains a landing page, a comparison page, a guide index, ten
detailed guides, support, Terms of Use, Privacy Policy, and a promotional sale
page. A published locale must translate every user-facing string used by all of
these pages; the build must never silently mix languages.

## Translation workflow

Create compact translation packages for a new locale by naming the existing
languages that should be kept as context:

```sh
python3 build/localize.py export de --source-languages en,ru
```

This writes one minified file per catalog section to `localization_work/de/`.
Every record contains the available requested source texts, a `de: null` field
to fill, and the catalog comment when one exists. Other locales and technical
non-translatable records are omitted.

To create one file instead, use:

```sh
python3 build/localize.py export de --source-languages en,ru --merge
```

The merged file is written to `localization_work/de.json`. Its keys are
prefixed with the source section, for example `home.hero.h1`. `--section` can
limit either export mode, and `--output` can override the destination.

After replacing every target `null` with a translation, import the directory or
merged file and validate the completed locale:

```sh
python3 build/localize.py import de localization_work/de
python3 build/localize.py validate de
```

For a merged package, pass `localization_work/de.json` to `import`. Import is
all-or-nothing: it rejects missing or extra keys, remaining `null` values,
changed source text or comments, changed placeholders, and changed protected
HTML structure before updating any catalog section.
