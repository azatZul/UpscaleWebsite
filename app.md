# UScale — App Store Listing Data

> Editorial and App Store research snapshot from **2026-08-21**.
> Facts the site renders live in `build/app_facts.json` — the build injects them into page copy
> and structured data. Change them there; the rows below marked *(build/app_facts.json)* are
> pointers, not a second source of truth.

---

## 1. Identity

| Field | Value |
|---|---|
| **App name (App Store)** | AI Photo Enhancer, UScale |
| **Subtitle** | Enhance photo quality, Video |
| **Brand used on website** | UScale |
| **App Store ID** | 6736931330 |
| **Bundle ID** | com.graz.upscaler |
| **App Store URL** | https://apps.apple.com/us/app/ai-photo-enhancer-uscale/id6736931330 |
| **Short URL** | https://apps.apple.com/app/id6736931330 |
| **Developer** | Alexandr Graschenkov (artist id 825765483) |
| **Website** | https://upscales.app/ |
| **Support** | https://upscales.app/support_page.html |
| **Terms** | https://upscales.app/terms |
| **Privacy** | https://upscales.app/privacy_policy |

## 2. Store facts

| Field | Value |
|---|---|
| **Price** | Free (with In-App Purchases) |
| **Primary category** | Photo & Video |
| **Secondary category** | Utilities |
| **Content rating** | 4+ |
| **Current version** | *(build/app_facts.json → `version`)* |
| **Version released** | 2026-08-18 |
| **First released** | 2025-01-08 |
| **File size** | *(build/app_facts.json → `file_size`; 78,400,512 bytes)* |
| **Minimum iOS** | *(build/app_facts.json → `minimum_ios`)* |
| **Devices** | iPhone, iPad, iPod touch (iosUniversal). Designed for iPad. Not verified for macOS. |
| **Average rating** | *(build/app_facts.json → `rating.value`)* |
| **Rating count** | *(build/app_facts.json → `rating.count`)* |
| **Game Center** | No |

### In-App Purchases (US)

Only the annual pair reaches the site (pricing copy and the sale page's discount);
the rest is reference.

| Product | Price | |
|---|---|---|
| Weekly | $5.99 | |
| Annual | $39.99 | *(build/app_facts.json → `pricing_usd.annual`)* |
| Annual Sale | $29.99 | *(build/app_facts.json → `pricing_usd.annual_sale`)* |
| Forever (lifetime) | $79.99 | |
| Forever Sale (lifetime) | $49.99 | |

### App languages (27 store locales)

AR, NL, EN, FI, FR, DE, HE, HI, HU, ID, IT, JA, KO, MS, NB, PL, PT, RO, RU, ZH-Hans, ES, SV, TH, ZH-Hant, TR, UK, VI

## 3. Latest release notes (2.1.6)

- Improved app stability
- Fixed video orientation after Slowmo processing
- Delete original photos after saving to gallery

## 4. Full App Store description

> UScale helps improve photos and videos with AI tools for everyday shots, old photo archives, drawings, anime, and creative image upscaling with reconstructed details.
>
> **What you can do with UScale:**
>
> • **Improve photo and video quality** — Upscale, sharpen, and clean up blurry or low-resolution media.
>
> • **Work privately on your device** — Core photo and video enhancement is processed locally, without uploading your files.
>
> • **Create slow-motion videos** — Turn regular videos into smooth slow motion. Processing happens directly on your device.
>
> • **Brighten dark photos** — Recover detail from underexposed or very dark images.
>
> • **Restore old photos** — Repair scratches, folds, dust, and faded details. You can also colorize old images or use advanced restoration for heavily damaged photos.
>
> • **Restore photo negatives** — Invert and normalize negative photos before restoration.
>
> • **Enhance faces** — Improve face details in portraits and group photos.
>
> • **Use creative AI enhancement** — For more expressive results, Creative Upscale can rebuild details with cloud-based AI and output higher-resolution images.
>
> • **Process multiple photos** — Select several photos and enhance them in one batch.
>
> **Free version:**
> • Enhance 2 photos per day
> • Enhance 5 seconds of video per day
> • Use the 2x model for daily processing
>
> **Premium:**
> • Unlimited photo and video enhancements
> • Full-length video processing
> • 4x upscaling
> • Advanced AI access for creative and restoration features
>
> UScale was shaped with feedback from photographers and people who work closely with visual media. It is built for people who want cleaner, sharper, more usable photos and videos without a complicated editor.

## 5. Feature list (normalised for website use)

| # | Feature | Where processed | Website section |
|---|---|---|---|
| 1 | Photo upscaling 2x / 4x, sharpening, denoise | On-device | Hero, Features, Guide: upscale-image-4k |
| 2 | Unblur / fix blurry photos | On-device | Features, Guide: unblur-photo-iphone |
| 3 | Video enhancement & upscaling | On-device | Features, Guide: enhance-video-quality |
| 4 | AI slow motion (frame interpolation) | On-device | Features, Guide: slow-motion-video |
| 5 | Brighten dark / underexposed photos — Enlighten mode, no settings; large photos are scaled down slightly to fit an on-device pass | On-device | Features, Guide: brighten-dark-photos |
| 6 | Old photo restoration — 4 modes: Restore, Restore & Colorize, Enhanced Colorize, Advanced Fix | Cloud AI (Premium) | Features, Guide: restore-old-photos |
| 7 | Colorize black & white photos — part of the restoration pass, not a separate tool | Cloud AI (Premium) | Guide: colorize-black-and-white-photos |
| 8 | Photo negative restore — Negative switch in the restoration advanced options | Invert on-device, restore in cloud | Guide: film-negative-to-photo |
| 9 | Face enhancement in portraits & group shots | On-device | Features, Guide: fix-blurry-faces |
| 10 | Creative Upscale — detail reconstruction, higher resolution | Cloud AI | Features, Guide: upscale-anime-art |
| 11 | Batch processing of multiple photos | On-device | Features |
| 12 | No account required, works in airplane mode | On-device | Privacy section |

## 6. Free vs Premium (for pricing/FAQ copy)

| | Free | Premium |
|---|---|---|
| Photos per day | 2 | Unlimited |
| Video per day | 5 seconds | Full-length |
| Upscale model | 2x | 2x and 4x |
| Advanced AI (creative upscale, colorize, heavy restoration) | — | Included |

## 7. Assets downloaded

Icon (from `artworkUrl512`, upscaled variants of the same source):

- `resources/appstore/icon_1024.png` — 1024×1024
- `resources/appstore/icon_512.png` — 512×512
- `resources/appstore/icon_180.png` — 180×180 (apple-touch-icon)

iPhone screenshots (1290 px wide, 6.9"):

| File | On-screenshot caption | Shows |
|---|---|---|
| `resources/appstore/screenshots/screen_1.jpg` | **Enhance** — Photo Quality | Graduation portrait, split before/after |
| `resources/appstore/screenshots/screen_2.jpg` | **Restore** — old photos | Damaged 1950s family photo, scratches removed + colorized |
| `resources/appstore/screenshots/screen_3.jpg` | **Private** — offline & secure media processing | Blurry outdoor shot of a father and child sharpened |
| `resources/appstore/screenshots/screen_4.jpg` | **UpScale** — any photo or video | Pixelated illustration upscaled, with video timeline |
| `resources/appstore/screenshots/screen_5.jpg` | **Brighten** — your photos instantly | Dark concert crowd shot recovered |
| `resources/appstore/screenshots/screen_6.jpg` | **Unblur** — your memories | Blurry cat photo made sharp |

iPad screenshots (1200 px wide): `resources/appstore/ipad/ipad_1.jpg` … `ipad_6.jpg` (same six concepts).

Existing site assets reused on the landing page:

- `resources/before_after/before_1.jpg` / `after_1.jpg` — portrait pair
- `resources/before_after/before_2.jpg` / `after_2.jpg` — nature pair
- `resources/before_after/before_after_3.mp4` — video upscale demo
- `resources/slow_mo_demo_small.mp4` — slow-motion demo
- `resources/before_after/anime_original.mp4` / `anime_processed.mp4` — anime upscale demo
- `resources/before_after/preview_1..4.jpg` — thumbnails

## 8. Canonical positioning statement (used across the site)

> **UScale is an AI photo and video enhancer for iPhone and iPad that unblurs, upscales and restores your media — with the core processing running on your device, so your photos never leave your phone.**

Three proof points repeated in every locale:

1. **On-device by default** — core enhancement runs offline, no upload, no account.
2. **Photos *and* video** — most competitors only do photos; UScale also upscales video and creates AI slow motion.
3. **Free to try** — 2 photos and 5 seconds of video every day at no cost.
