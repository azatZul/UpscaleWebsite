#!/usr/bin/env python3
"""Build the localized static site into dist/.

Usage: python3 build/build.py [locale ...]
Assets and resources keep their paths; static/ is copied into the site root.
Mutable app facts (prices, rating, version, publish dates) come from build/app_facts.json.

Only locales with translated content can be built. Standalone pages use the same
locale-aware routes as the landing page and guides.
"""

import hashlib, json, os, re, shutil, sys
from datetime import date

# shutil.copytree(dirs_exist_ok=...) requires Python 3.8+.
if sys.version_info < (3, 8):
    sys.exit(f"build.py needs Python 3.8+, got {sys.version.split()[0]}")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localization_catalog

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
STATIC = os.path.join(ROOT, "static")
COPY_DIRS = ["assets", "resources"]

with open(os.path.join(ROOT, "build", "app_facts.json"), encoding="utf-8") as f:
    APP_FACTS = json.load(f)

SITE = APP_FACTS["site_url"]
APPSTORE = APP_FACTS["app_store_url"]

def asset_v(name):
    """short content hash, so a deploy busts the CSS/JS cache"""
    path = os.path.join(ROOT, "assets", name)
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()[:8]

CSS_V = asset_v("site.css")
JS_V = asset_v("site.js")

RATING = APP_FACTS["rating"]["value"]
RATING_COUNT = APP_FACTS["rating"]["count"]
# Filled width of the five-star rating.
STAR_FILL = f"{RATING / 5 * 100:g}%"
STARS_PART = (f'<span class="stars part" aria-hidden="true" style="--fill:{STAR_FILL}">'
              f'\u2605\u2605\u2605\u2605\u2605<i>\u2605\u2605\u2605\u2605\u2605</i></span>')
APP_NAME = APP_FACTS["app_name"]
APP_VERSION = APP_FACTS["version"]

# Locales: code, URL segment, English/native names, hreflang, OG locale, flag.
LOCALES = [
    ("en", "",     "English",              "English",     "en",      "en_US", "us"),
    ("es", "es",   "Spanish",              "Español",     "es",      "es_ES", "es"),
    ("pt", "pt",   "Portuguese (Brazil)",  "Português",   "pt-BR",   "pt_BR", "br"),
    ("fr", "fr",   "French",               "Français",    "fr",      "fr_FR", "fr"),
    ("de", "de",   "German",               "Deutsch",     "de",      "de_DE", "de"),
    ("it", "it",   "Italian",              "Italiano",    "it",      "it_IT", "it"),
    ("ja", "ja",   "Japanese",             "日本語",        "ja",      "ja_JP", "jp"),
    ("ko", "ko",   "Korean",               "한국어",        "ko",      "ko_KR", "kr"),
    ("zh", "zh",   "Chinese (Simplified)", "简体中文",      "zh-Hans", "zh_CN", "cn"),
    ("ru", "ru",   "Russian",              "Русский",     "ru",      "ru_RU", "ru"),
    ("hi", "hi",   "Hindi",                "हिन्दी",         "hi",      "hi_IN", "in"),
    ("tr", "tr",   "Turkish",              "Türkçe",      "tr",      "tr_TR", "tr"),
]
BY_CODE = {l[0]: l for l in LOCALES}
# Locales whose official App Store badge puts the "App Store" service mark on
# the first line and the translated "download" phrase under it.
MARK_FIRST_LOCALES = frozenset({"ja"})
# Only locales represented in every localization section are indexable and shown
# in the picker. Importing a complete locale automatically grows the cluster.
LOCALIZED_CODES = tuple(
    code for code in BY_CODE if code in localization_catalog.available_locales()
)

# Guides
SHOTS = "/resources/appstore/screenshots"
BA = "/resources/before_after"

# Cards use small crops; articles use full before/after assets or finished video clips.
# Optional shot_after thumbnails cross-fade only where the result is visually clear.
GUIDE_META = {
    "unblur-photo-iphone": {
        "shot": f"{BA}/lowq_portrait_thumb.jpg",
        "shot_after": f"{BA}/lowq_portrait_after_thumb.jpg",
        "before": f"{BA}/lowq_portrait_before.jpg", "after": f"{BA}/lowq_portrait_after.jpg",
        "ratio": "1.1111", "before_size": (400, 360), "after_size": (1200, 1080),
    },
    "restore-old-photos": {
        "shot": f"{BA}/restore_family_thumb.jpg",
        "shot_after": f"{BA}/restore_family_after_thumb.jpg",
        "before": f"{BA}/restore_family_before.jpg", "after": f"{BA}/restore_family_after.jpg",
        "ratio": "0.75", "before_size": (900, 1200), "after_size": (1200, 1600),
    },
    "colorize-black-and-white-photos": {
        "shot": f"{BA}/restore_portrait_thumb.jpg",
        "shot_after": f"{BA}/restore_portrait_after_thumb.jpg",
        "before": f"{BA}/restore_portrait_before.jpg", "after": f"{BA}/restore_portrait_after.jpg",
        "ratio": "0.75", "before_size": (900, 1200), "after_size": (1200, 1600),
    },
    "upscale-image-4k": {
        "shot": f"{BA}/girls_thumb.jpg",
        "og": f"{BA}/girls_after.jpg",
        "before": f"{BA}/girls_before.jpg", "after": f"{BA}/girls_after.jpg",
        "ratio": "1.5", "before_size": (840, 560), "after_size": (3010, 2006),
    },
    "enhance-video-quality": {
        "shot": f"{BA}/video_quality_thumb.jpg",
        "video": f"{BA}/before_after_3.mp4", "poster": f"{BA}/preview_3.jpg",
    },
    "slow-motion-video": {
        "shot": f"{BA}/slowmo_thumb.jpg",
        "video": "/resources/slow_mo_demo_small.mp4", "poster": f"{BA}/preview_4.jpg",
    },
    "brighten-dark-photos": {
        "shot": f"{BA}/brighten_thumb.jpg",
        "shot_after": f"{BA}/brighten_after_thumb.jpg",
        "before": f"{BA}/dark_before.jpg", "after": f"{BA}/dark_after.jpg",
        "ratio": "1.4995", "before_size": (3218, 2146), "after_size": (3218, 2146),
    },
    "film-negative-to-photo": {
        "shot": f"{BA}/film_negative_thumb.jpg",
        "shot_after": f"{BA}/film_negative_after_thumb.jpg",
        "og": f"{BA}/film_negative_after.jpg",
        "before": f"{BA}/film_negative_before.jpg", "after": f"{BA}/film_negative_after.jpg",
        "ratio": "1.4021", "before_size": (1000, 713), "after_size": (4788, 3415),
        # Interactive demo of the Negative switch: off is the raw negative, on the inverted result.
        "demo": {"off": f"{BA}/negative_demo_off.jpg", "on": f"{BA}/negative_demo_on.jpg",
                 "size": (1024, 757), "ratio": "1.3527"},
    },
    "fix-blurry-faces": {
        "shot": f"{BA}/upscale_4k_thumb.jpg",
        "before": f"{BA}/before_1.jpg", "after": f"{BA}/after_1.jpg",
        "ratio": "1.1735", "before_size": (683, 582), "after_size": (2732, 2328),
    },
    "upscale-anime-art": {
        "shot": f"{BA}/anime_thumb.jpg",
        "shot_after": f"{BA}/anime_after_thumb.jpg",
        "before": f"{BA}/hero_anime_before.jpg", "after": f"{BA}/hero_anime_after.jpg",
        "ratio": "1.3175", "before_size": (606, 460), "after_size": (2000, 1518),
    },
}
GUIDE_SLUGS = list(GUIDE_META)

SCREENSHOTS = [f"{SHOTS}/screen_{i}.jpg" for i in range(1, 7)]

# A translated showcase replaces the App Store screenshot rail.
SHOWCASE_TABS = [
    {"thumb": "/resources/before_after/girls_thumb.jpg",
     "before": "/resources/before_after/girls_before.jpg",
     "after": "/resources/before_after/girls_after.jpg", "ratio": "1.5", "cloud": True,
     "before_size": (840, 560), "after_size": (3010, 2006)},
    {"thumb": "/resources/before_after/upscale_photo_thumb.jpg",
     "before": "/resources/before_after/before_2.jpg",
     "after": "/resources/before_after/after_2.jpg", "ratio": "1.5009"},
    {"thumb": "/resources/before_after/lowq_portrait_thumb.jpg",
     "before": "/resources/before_after/lowq_portrait_before.jpg",
     "after": "/resources/before_after/lowq_portrait_after.jpg", "ratio": "1.1111", "cloud": True},
    {"thumb": "/resources/before_after/restore_kids_thumb.jpg",
     "before": "/resources/before_after/restore_kids_before.jpg",
     "after": "/resources/before_after/restore_kids_after.jpg", "ratio": "1.0714", "cloud": True},
    {"thumb": "/resources/before_after/restore_family_thumb.jpg",
     "before": "/resources/before_after/restore_family_before.jpg",
     "after": "/resources/before_after/restore_family_after.jpg", "ratio": "0.75", "cloud": True},
    {"thumb": "/resources/before_after/restore_portrait_thumb.jpg",
     "before": "/resources/before_after/restore_portrait_before.jpg",
     "after": "/resources/before_after/restore_portrait_after.jpg", "ratio": "0.75", "cloud": True},
    {"thumb": "/resources/before_after/video_quality_thumb.jpg",
     "video": "/resources/before_after/before_after_3.mp4", "sound": True, "ratio": "1.375"},
    {"thumb": "/resources/before_after/slowmo_thumb.jpg",
     "video": "/resources/slow_mo_demo_small.mp4", "ratio": "1.6"},
]

# Competitor comparison (/compare.html)
#
# Results were produced by running the two source files below through each app once,
# in August 2026. The rivals' exports of the park photo came back mirrored, so
# resources/compare holds flipped copies — see the method note in the page copy.
CMP = "/resources/compare"

COMPARE_APPS = [
    {"id": "uscale", "name": "UScale", "dev": "Alexandr Graschenkov",
     "icon": "/resources/appstore/icon_512.png", "url": APPSTORE},
    {"id": "remini", "name": "Remini", "dev": "Bending Spoons",
     "icon": "/resources/competitors/remini.jpg",
     "url": "https://apps.apple.com/us/app/remini-ai-photo-enhancer/id1470373330"},
    {"id": "blurbuster", "name": "BlurBuster", "dev": "Louperkos Investments",
     "icon": "/resources/competitors/blurbuster.jpg",
     "url": "https://apps.apple.com/us/app/blurbuster-ai-photo-enhancer/id1599612633"},
    {"id": "enhancefox", "name": "EnhanceFox", "dev": "Pixl Concerto Technology",
     "icon": "/resources/competitors/enhancefox.jpg",
     "url": "https://apps.apple.com/us/app/photo-enhancer-enhancefox-ai/id1544212575"},
]
RIVALS = [a for a in COMPARE_APPS if a["id"] != "uscale"]
APP_BY_ID = {a["id"]: a for a in COMPARE_APPS}

# Per test: the source file, every app's result, and the matching 100% crops.
# "out" is the pixel size each app actually returned, straight from the export.
COMPARE_TESTS = {
    "spider": {
        "ratio": "1.7891",
        "before": f"{BA}/hero_spiderman_before.jpg", "before_size": (823, 460),
        "size": (1400, 782), "zoom_size": (640, 526),
        "out": {"uscale": "5479 × 3062", "remini": "3480 × 1944",
                "blurbuster": "1646 × 920", "enhancefox": "1646 × 920"},
        "shot": {"uscale": f"{CMP}/spider_uscale.jpg", "remini": f"{CMP}/spider_remini.jpg",
                 "blurbuster": f"{CMP}/spider_blurbuster.jpg",
                 "enhancefox": f"{CMP}/spider_enhancefox.jpg"},
        "zoom": {"before": f"{CMP}/z_spider_before.jpg", "uscale": f"{CMP}/z_spider_uscale.jpg",
                 "remini": f"{CMP}/z_spider_remini.jpg",
                 "blurbuster": f"{CMP}/z_spider_blurbuster.jpg",
                 "enhancefox": f"{CMP}/z_spider_enhancefox.jpg"},
    },
    "girls": {
        "ratio": "1.5",
        "before": f"{BA}/girls_before.jpg", "before_size": (840, 560),
        "size": (1400, 933), "zoom_size": (640, 576),
        "out": {"uscale": "5017 × 3344", "remini": "3480 × 2319",
                "blurbuster": "1680 × 1120", "enhancefox": "1680 × 1120"},
        "shot": {"uscale": f"{CMP}/girls_uscale.jpg", "remini": f"{CMP}/girls_remini.jpg",
                 "blurbuster": f"{CMP}/girls_blurbuster.jpg",
                 "enhancefox": f"{CMP}/girls_enhancefox.jpg"},
        "zoom": {"before": f"{CMP}/z_girls_before.jpg", "uscale": f"{CMP}/z_girls_uscale.jpg",
                 "remini": f"{CMP}/z_girls_remini.jpg",
                 "blurbuster": f"{CMP}/z_girls_blurbuster.jpg",
                 "enhancefox": f"{CMP}/z_girls_enhancefox.jpg"},
        # the second face in the same frame, cropped the same way — the rail runs on with it
        "zoom2": {"before": f"{CMP}/z_girls2_before.jpg", "uscale": f"{CMP}/z_girls2_uscale.jpg",
                  "remini": f"{CMP}/z_girls2_remini.jpg",
                  "blurbuster": f"{CMP}/z_girls2_blurbuster.jpg",
                  "enhancefox": f"{CMP}/z_girls2_enhancefox.jpg"},
    },
}
# BlurBuster's other pass on the night frame: bigger output, worse picture.
BB_SOFT = {"zoom": f"{CMP}/z_spider_blurbuster_soft.jpg"}

CHEVRON_SVG = ('<svg class="guides-chevron" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5.5 8.75 12 15.25 18.5 8.75" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>')

LOCK_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true">'
            '<path d="M8.6 10.6V7.4a3.4 3.4 0 0 1 6.8 0v3.2" fill="none" stroke="currentColor" '
            'stroke-width="2.1" stroke-linecap="round"/>'
            '<rect x="4.7" y="10" width="14.6" height="11" rx="3.4" fill="currentColor"/></svg>')
CLOUD_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">'
             '<circle cx="8.2" cy="13.6" r="3.3"/><circle cx="12.6" cy="11.2" r="4.7"/>'
             '<circle cx="16.4" cy="13.9" r="3.4"/>'
             '<rect x="4.9" y="13.8" width="14.9" height="4" rx="2"/></g></svg>')

# Apple's official badge artwork, vendored by build/fetch_badges.py. The
# guidelines require it be used unmodified, so the site supplies only the frame
# around it; BADGE_H is the rendered height, well over Apple's 40px minimum.
BADGE_DIR = os.path.join(ROOT, "resources", "appstore", "badges")
BADGE_H = 56
_BADGE_WIDTHS = {}

SPK_ON = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
          'stroke-linejoin="round" aria-hidden="true" class="ico-on">'
          '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/>'
          '<path d="M15.6 8.4a5 5 0 0 1 0 7.2"/><path d="M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>')
SPK_OFF = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
           'stroke-linejoin="round" aria-hidden="true" class="ico-off">'
           '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/>'
           '<path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/></svg>')
PAUSE_ICO = ('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
             '<rect x="7" y="5" width="3.6" height="14" rx="1.3"/>'
             '<rect x="13.4" y="5" width="3.6" height="14" rx="1.3"/></svg>')


# Hero device examples share object-position between each before/after pair.
HERO_SHOTS = [
    {"before": "/resources/before_after/hero_spiderman_before.jpg", "bw": 823, "bh": 460,
     "after": "/resources/before_after/hero_spiderman_after.jpg", "aw": 2000, "ah": 1118,
     "pos": "50% 40%"},
    {"before": "/resources/before_after/hero_girls_play_before.jpg", "bw": 840, "bh": 560,
     "after": "/resources/before_after/hero_girls_play_after.jpeg", "aw": 2508, "ah": 1672,
     "pos": "50% 50%"},
    {"before": "/resources/before_after/hero_anime_before.jpg", "bw": 606, "bh": 460,
     "after": "/resources/before_after/hero_anime_after.jpg", "aw": 2000, "ah": 1518,
     "pos": "50% 35%"},
]

# Frame size and transparent-screen offsets.
FRAME = {"src": "/resources/iphone_frame.png", "w": 2548, "h": 1252,
         "left": 54, "top": 60, "right": 50, "bottom": 61}


def hero_phone(c, h):
    """Render the framed hero comparison and its example switcher."""
    # h["before"] is the temporal state before processing. Localizations should use
    # their equivalent of "before/after" (Russian: "До/После"), not a spatial label.
    s, f = HERO_SHOTS[0], FRAME
    screen = ("left:{:.4f}%;right:{:.4f}%;top:{:.4f}%;bottom:{:.4f}%".format(
        f["left"] / f["w"] * 100, f["right"] / f["w"] * 100,
        f["top"] / f["h"] * 100, f["bottom"] / f["h"] * 100))
    dots = "".join(
        f'<button class="cmp-tab dot" type="button" data-before="{d["before"]}" '
        f'data-after="{d["after"]}" data-pos="{d["pos"]}" '
        f'aria-pressed="{"true" if i == 0 else "false"}" '
        f'aria-label="{esc(h["shot"])} {i + 1}"><i></i></button>'
        for i, d in enumerate(HERO_SHOTS))
    switch = (f'<div class="phone-dots" role="group" aria-label="{esc(h["shots_label"])}">'
              f'{dots}</div>') if len(HERO_SHOTS) > 1 else ""
    return f"""<div class="hero-stage">
      <div class="phone cmp-wrap" data-follow="1" data-preload="1">
        <span class="phone-halo" aria-hidden="true"></span>
        <span class="phone-cast" aria-hidden="true"></span>
        <div class="phone-body">
          <div class="phone-screen" style="{screen}">
            <div class="cmp cmp-phone" role="group" aria-label="{esc(h['cmp_label'])}">
              <img class="a-img" src="{s['after']}" width="{s['aw']}" height="{s['ah']}" style="object-position:{s['pos']}" alt="{esc(h['after_alt'])}" fetchpriority="high" decoding="async">
              <img class="b" src="{s['before']}" width="{s['bw']}" height="{s['bh']}" style="object-position:{s['pos']}" alt="{esc(h['before_alt'])}" fetchpriority="high" decoding="async">
              <span class="cmp-bar" aria-label="{esc(h['drag'])}"><b class="cmp-lb l">{esc(h['before'])}</b><b class="cmp-lb r">{esc(h['after'])}</b></span>
            </div>
            {switch}
          </div>
          <img class="phone-frame" src="{f['src']}" width="{f['w']}" height="{f['h']}" alt="" aria-hidden="true" fetchpriority="high" decoding="async">
        </div>
      </div>
    </div>"""


def vid_controls(c):
    """Render the mute control and paused badge."""
    u = c["ui"]
    return (f'<button class="vid-mute" type="button" hidden '
            f'data-on="{esc(u.get("sound_on", "Play sound"))}" '
            f'data-off="{esc(u.get("sound_off", "Mute sound"))}" '
            f'aria-label="{esc(u.get("sound_off", "Mute sound"))}">{SPK_ON}{SPK_OFF}</button>'
            f'<span class="vid-paused" role="status" '
            f'aria-label="{esc(u.get("paused", "Paused"))}">{PAUSE_ICO}</span>')


DOT = '<span class="dot" aria-hidden="true"></span>'

def check(sw="2.4"):
    """A checkmark; the switch box wants a heavier stroke than running text."""
    return ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" '
            'aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>')

CHECK = check()
DOWN_SVG = ('<svg class="vs-dl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            '<path d="M12 4v11m0 0 4.2-4.2M12 15l-4.2-4.2M4.8 18.5h14.4"/></svg>')
CLOUD = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
         'stroke-linejoin="round" aria-hidden="true">'
         '<path d="M17.6 19H7a4.5 4.5 0 0 1-1.2-8.84 6 6 0 0 1 11.6-1.34A4.6 4.6 0 0 1 17.6 19Z"/></svg>')
BURGER = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
          'aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>')

# Apply the saved or OS theme before first paint; site.js handles later changes.
THEME_BOOT = (
    "<script>(function(){var t;try{t=localStorage.getItem('uscale-theme')}catch(e){}"
    "if(t!=='light'&&t!=='dark')"
    "t=window.matchMedia&&matchMedia('(prefers-color-scheme:light)').matches?'light':'dark';"
    "document.documentElement.setAttribute('data-theme',t);if(t==='light'){"
    "var m=document.querySelector('meta[name=\"theme-color\"]');"
    "if(m)m.setAttribute('content','#f3f6fe')}})();</script>")

THEME_ICON = ('<svg class="theme-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
              '<mask id="theme-cut"><rect width="24" height="24" fill="#fff"/>'
              '<circle class="cut" cx="17" cy="7" r="7" fill="#000"/></mask>'
              '<circle class="orb" cx="12" cy="12" r="6.2" mask="url(#theme-cut)"/>'
              '<g class="rays" stroke-width="1.7" stroke-linecap="round">'
              '<line x1="12" y1="3.4" x2="12" y2="1"/><line x1="18.1" y1="5.9" x2="19.8" y2="4.2"/><line x1="20.6" y1="12" x2="23" y2="12"/><line x1="18.1" y1="18.1" x2="19.8" y2="19.8"/><line x1="12" y1="20.6" x2="12" y2="23"/><line x1="5.9" y1="18.1" x2="4.2" y2="19.8"/><line x1="3.4" y1="12" x2="1" y2="12"/><line x1="5.9" y1="5.9" x2="4.2" y2="4.2"/>'
              '</g></svg>')

def theme_toggle(c):
    u = c["ui"]
    return (f'<button class="theme-btn" type="button" aria-pressed="false" '
            f'data-light="{esc(u["theme_light"])}" data-dark="{esc(u["theme_dark"])}" '
            f'aria-label="{esc(u["theme_light"])}" title="{esc(u["theme_light"])}">{THEME_ICON}</button>')

# Helpers
def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))

_PRICING = APP_FACTS["pricing"]
_ANNUAL = _PRICING["default"]["annual"]
_ANNUAL_SALE = _PRICING["default"]["annual_sale"]
# The discount is one global marketing claim, so it is derived once from the
# reference currency and never recomputed per locale.
_SALE_PERCENT = round((1 - _ANNUAL_SALE / _ANNUAL) * 100)

# Symbol, whether it leads the amount, and how many decimals the store prints.
CURRENCIES = {
    "USD": ("$", True, 2),
    "EUR": ("\u20ac", False, 2),
    "RUB": ("\u20bd", False, 0),
    "JPY": ("\u00a5", True, 0),
}
# Decimal and thousands separators, and whether a percent sign is spaced off.
NUMBER_FORMATS = {
    "en": (".", ",", ""),
    # Spanish prices are quoted in euros, so the copy follows the RAE
    # convention the euro is written with rather than the Mexican one.
    "es": (",", ".", "\u00a0"),
    # French groups with a no-break space and spaces the percent sign off, the
    # same convention the French copy already uses before ":" and inside "\u00ab \u00bb".
    "fr": (",", "\u00a0", "\u00a0"),
    "de": (",", ".", "\u00a0"),
    "ru": (",", "\u00a0", ""),
}


def number_text(amount, lang, decimals=0):
    """Write a number the way the locale writes it."""
    decimal_mark, thousands_mark, _ = NUMBER_FORMATS.get(lang, NUMBER_FORMATS["en"])
    text = f"{amount:,.{decimals}f}"
    return text.translate(str.maketrans({",": "\x00", ".": decimal_mark})).replace(
        "\x00", thousands_mark
    )


def money_text(amount, currency, lang):
    """Write a price the way the locale's own App Store shows it."""
    symbol, symbol_leads, decimals = CURRENCIES[currency]
    text = number_text(amount, lang, decimals)
    return f"{symbol}{text}" if symbol_leads else f"{text}\u00a0{symbol}"


def locale_pricing(lang):
    """A locale's own prices, falling back to the reference currency."""
    override = _PRICING.get(lang, {})
    prices = {**_PRICING["default"], **override}
    # A locale that sets its own annual price but no sale price inherits the
    # discount rather than the reference currency's sale amount.
    if "annual" in override and "annual_sale" not in override:
        prices["annual_sale"] = prices["annual"] * _ANNUAL_SALE / _ANNUAL
    return prices


def fact_text(lang="en"):
    """App facts as strings, formatted for one locale."""
    prices = locale_pricing(lang)
    currency = prices["currency"]
    return {
        "rating_count": number_text(APP_FACTS["rating"]["count"], lang),
        "annual_price": money_text(prices["annual"], currency, lang),
        "annual_sale_price": money_text(prices["annual_sale"], currency, lang),
        "sale_percent": f"{_SALE_PERCENT:d}",
        "trial_days": APP_FACTS["annual_trial_days"],
        "free_photos_per_day": APP_FACTS["free_limits"]["photos_per_day"],
        "minimum_ios": APP_FACTS["minimum_ios"],
        "off": f"{_SALE_PERCENT:d}{NUMBER_FORMATS.get(lang, NUMBER_FORMATS['en'])[2]}%",
    }


def rating_text(lang="en"):
    """The star score, with the locale's decimal mark."""
    return number_text(RATING, lang, 0 if float(RATING).is_integer() else 1)


FACT_TEXT = fact_text()

# Only {known_fact} is replaced. str.format_map would also try to read every other
# brace pair in the copy, so a single "{" in a translation would abort the build.
FACT_RE = re.compile(r"\{(\w+)\}")
UNKNOWN_FACTS = set()

def inject_facts(value, lang="en"):
    """Replace app-fact placeholders, including locale-specific number formatting."""
    facts = fact_text(lang)

    def replace(item):
        if isinstance(item, str):
            def sub_fact(match):
                key = match.group(1)
                if key in facts:
                    return str(facts[key])
                UNKNOWN_FACTS.add(key)
                return match.group(0)
            return FACT_RE.sub(sub_fact, item)
        if isinstance(item, list):
            return [replace(child) for child in item]
        if isinstance(item, tuple):
            return tuple(replace(child) for child in item)
        if isinstance(item, dict):
            return {key: replace(child) for key, child in item.items()}
        return item

    return replace(value)

MISSING_DATES = set()

def updated_for(path=""):
    """Hand-maintained publish date from app_facts.json — bump it when a page changes.

    A page with no entry falls back to the home date rather than failing the build,
    but main() reports it so a new guide does not ship with a borrowed lastmod."""
    dates = APP_FACTS["page_updated"]
    if not path:
        return dates["home"]
    if path == "guides":
        return dates["guide_hub"]
    if path.startswith("guides/"):
        found = dates["guides"].get(path.split("/", 1)[1])
    else:
        found = dates.get(path) or dates.get(page_path(path))
    if found:
        return found
    MISSING_DATES.add(path)
    return dates["home"]

MONTHS = ("January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December")

def english_date(value):
    """ISO date as English prose. strftime("%B") would follow the build box's LC_TIME."""
    parsed = date.fromisoformat(value)
    return f"{parsed.day} {MONTHS[parsed.month - 1]} {parsed.year}"

def japanese_date(value):
    """ISO date the way every Japanese page writes one. A bare ISO string is
    legible there but reads as foreign, so 年月日 is worth the branch."""
    parsed = date.fromisoformat(value)
    return f"{parsed.year}年{parsed.month}月{parsed.day}日"

def date_tag(value, prefix="", english=False, lang=None):
    """Rendered date that still exposes the ISO one to crawlers.

    Most localized pages keep the ISO text — it reads the same in Latin and
    Cyrillic locales; the English-only legal pages spell the month out, and
    Japanese takes its own 年月日 form."""
    if english:
        text = english_date(value)
    elif lang == "ja":
        text = japanese_date(value)
    else:
        text = value
    return f'<time datetime="{value}">{esc(f"{prefix} {text}".strip())}</time>'

def content_lang(c, route_lang):
    """Resolve and validate the language declared by the localized content."""
    code = c.get("lang", route_lang)
    return code if code in BY_CODE else route_lang

def page_path(path=""):
    """Logical path -> the file that is actually served (extension included)."""
    if not path:
        return ""
    if path == "guides":
        return "guides/"
    return path + ".html"

def logical_path(filename):
    """A generated filename as the extension-free route used by rel_url/url."""
    return filename[:-5] if filename.endswith(".html") else filename

def rel_url(lang, path=""):
    """The same page in another locale, as a site-relative link — what the language
    picker needs, so switching stays on whatever host the page is served from."""
    seg = BY_CODE[lang][1]
    base = f"/{seg}/" if seg else "/"
    return base + page_path(path)

def url(lang, path=""):
    """Absolute form of rel_url — for canonical, hreflang, og:url and the sitemap."""
    return SITE + rel_url(lang, path)

def faq_href(h, home_prefix):
    if h.startswith("http") or h.startswith("/") or h.startswith("#"):
        return h
    return home_prefix + page_path(h)

def ld(obj):
    return ('<script type="application/ld+json">'
            + json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
            + "</script>")

def write(path, html):
    full = os.path.join(DIST, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(html)

# Exclude OS metadata from published assets.
IGNORE = shutil.ignore_patterns(".DS_Store", "._*", "Thumbs.db")

def copy_static():
    """Copy asset directories and unwrap static/ into the site root."""
    for name in COPY_DIRS:
        shutil.copytree(os.path.join(ROOT, name), os.path.join(DIST, name),
                        ignore=IGNORE, dirs_exist_ok=True)
    shutil.copytree(STATIC, DIST, ignore=IGNORE, dirs_exist_ok=True)

# Shared markup
def head(c, lang, title, desc, canonical, path="", og_image=None, extra_ld=None, robots=None,
         alternates=True):
    L = BY_CODE[lang]
    og_image = og_image or f"{SITE}{SCREENSHOTS[0]}"
    alts = ""
    if alternates:
        alts = "\n  ".join(
            f'<link rel="alternate" hreflang="{BY_CODE[l][4]}" href="{url(l, path)}">'
            for l in LOCALIZED_CODES
        ) + f'\n  <link rel="alternate" hreflang="x-default" href="{url("en", path)}">' 
    copy_locale = BY_CODE[content_lang(c, lang)]
    return f"""<!doctype html>
<html lang="{copy_locale[4]}" dir="{c.get('dir','ltr')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <link rel="canonical" href="{canonical}">
  {alts}
  <meta name="robots" content="{robots or 'index,follow,max-image-preview:large,max-snippet:-1'}">
  <meta name="theme-color" content="#07080d">
  {THEME_BOOT}
  <meta name="apple-itunes-app" content="app-id=6736931330">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="UScale">
  <meta property="og:locale" content="{copy_locale[5]}">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{canonical}">
  <meta property="og:image" content="{og_image}">
  <meta property="og:image:alt" content="{esc(c['hero']['h1_plain'])}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  <meta name="twitter:image" content="{og_image}">
  <link rel="icon" type="image/png" sizes="512x512" href="/resources/appstore/icon_512.png">
  <link rel="apple-touch-icon" href="/resources/appstore/icon_180.png">
  <link rel="preload" as="image" href="/resources/appstore/icon_180.png">
  <link rel="stylesheet" href="/assets/site.css?v={CSS_V}">
  {extra_ld or ''}
</head>
<body>
<div class="glow" aria-hidden="true"></div>
<a class="skip-link" href="#main-content">{esc(c['ui'].get('skip_to_content', 'Skip to content'))}</a>
"""

def badge_width(lang):
    """Rendered width of a locale's badge at BADGE_H, from the artwork's own
    aspect ratio. Apple draws every badge 40 units tall but lets the width
    follow the translated phrase — 108 for Japanese against 151 for Turkish —
    so the width has to be read per locale rather than assumed."""
    if lang not in _BADGE_WIDTHS:
        path = os.path.join(BADGE_DIR, f"{lang}-black.svg")
        with open(path, encoding="utf-8") as handle:
            head = handle.read(400)
        box = re.search(r'viewBox="0 0 ([\d.]+) 40"', head)
        if not box:
            raise SystemExit(f"{path}: no 40-unit-tall viewBox; re-run build/fetch_badges.py")
        _BADGE_WIDTHS[lang] = round(float(box.group(1)) / 40 * BADGE_H, 1)
    return _BADGE_WIDTHS[lang]

def appstore_btn(c, cls=""):
    """The App Store badge, as Apple's own artwork for this locale.

    The guidelines forbid recreating or restyling the badge, so the link is only
    a frame: it carries the site's shadow and hover lift, and both colourways
    are emitted so the theme can cross-fade between them the way the rest of the
    palette does. The accessible name still has to be built here, and Japanese
    inverts the lockup — the "App Store" service mark leads and the translated
    modifier follows, which is the order the phrase reads in. French elides its
    article onto the mark ("Télécharger dans l’App Store"), so a lead ending in
    an apostrophe joins with no space, the way Apple's own artwork sets it."""
    lang = c["lang"]
    lead, mark = c["ui"]["download_on"], c["ui"]["app_store"]
    if lang in MARK_FIRST_LOCALES:
        label = f"{mark}{lead}"
    else:
        gap = "" if lead.endswith(("’", "'")) else " "
        label = f"{lead}{gap}{mark}"
    label = esc(label)
    width = badge_width(lang)
    art = "".join(
        f'<img class="badge-{colour}" src="/resources/appstore/badges/{lang}-{colour}.svg" '
        f'width="{width}" height="{BADGE_H}" alt="" decoding="async">'
        for colour in ("black", "white"))
    return (f'<a class="appstore {cls}" href="{APPSTORE}" target="_blank" rel="noopener" '
            f'data-cta="appstore" aria-label="{label}" style="width:{width}px">{art}</a>')

def guide_card(c, slug, home_prefix):
    """Render a guide card with an optional result thumbnail."""
    meta = GUIDE_META[slug]
    thumb = (f'<img src="{meta["shot"]}" width="78" height="98" loading="lazy" decoding="async" alt="">')
    if meta.get("shot_after"):
        thumb = (f'<span class="guide-thumb">{thumb}'
                 f'<img class="after" src="{meta["shot_after"]}" width="78" height="98" '
                 f'loading="lazy" decoding="async" alt="" aria-hidden="true"></span>')
    return (f'<a class="guide" href="{home_prefix}guides/{slug}.html">{thumb}'
            f'<div><h3>{esc(c["guide_pages"][slug]["card_title"])}</h3>'
            f'<p>{esc(c["guide_pages"][slug]["card_desc"])}</p></div>'
            f'<span class="arrow" aria-hidden="true">→</span></a>')

# Thumbnails of the four restoration modes, lifted from the in-app mode picker.
MODES = "/resources/restore_modes"
MODE_IMG = {
    "restore": f"{MODES}/mode_restore.jpg",
    "colorize": f"{MODES}/mode_colorize.jpg",
    "enhanced_colorize": f"{MODES}/mode_enhanced_colorize.jpg",
    "advanced_fix": f"{MODES}/mode_advanced_fix.jpg",
}

def option_cards(items):
    """Cards for the in-app restoration modes and their advanced options.

    An entry with "img" renders the mode thumbnail; one with "tag" is the
    recommended pick and gets highlighted."""
    out = []
    for it in items:
        img = MODE_IMG.get(it.get("img", ""))
        thumb = (f'<img src="{img}" width="240" height="240" loading="lazy" decoding="async" '
                 f'alt="{esc(it.get("img_alt", ""))}">') if img else ""
        tag = f'<span class="tag">{esc(it["tag"])}</span>' if it.get("tag") else ""
        sub = f'<p class="sub">{esc(it["sub"])}</p>' if it.get("sub") else ""
        out.append(f'<li class="mode{" pick" if it.get("tag") else ""}">{thumb}'
                   f'<div><div class="mode-h"><h3>{esc(it["t"])}</h3> {tag}</div>'
                   f'{sub}<p class="d">{esc(it["p"])}</p></div></li>')
    return f'<ul class="modes">{"".join(out)}</ul>'

def toggle_demo(d, dm):
    """An in-article switch that cross-fades between two states of the same photo.

    Used for the Negative option, where the effect is the whole point and a
    static before/after says much less than flipping it yourself."""
    w, h = dm["size"]
    def shot(src, alt, on):
        return (f'<img class="{"on" if on else "off"}" src="{src}" width="{w}" height="{h}" '
                f'loading="lazy" decoding="async" alt="{esc(alt)}"'
                f'{" aria-hidden=\"true\"" if on else ""}>')
    return f'''<figure class="guide-media demo" style="--ar:{dm['ratio']}">
      <div class="demo-stage" style="aspect-ratio:var(--ar)">
        {shot(dm['off'], d['alt_off'], False)}
        {shot(dm['on'], d['alt_on'], True)}
      </div>
      <button class="opt-switch" type="button" role="switch" aria-checked="false" data-demo-switch>
        <span class="opt-box">{check("3.2")}</span>
        <span class="opt-txt"><b>{esc(d['label'])}</b><small>{esc(d['sub'])}</small></span>
        <span class="opt-hint" aria-hidden="true"><span class="h-off">{esc(d['hint_off'])}</span><span class="h-on">{esc(d['hint_on'])}</span></span>
      </button>
      <figcaption>{esc(d['caption'])}</figcaption>
    </figure>'''

def store_badge(btn, note):
    """Pair a store badge with its hover caption."""
    return f'<div class="store">{btn}<p class="hero-note reveal">{esc(note)}</p></div>'

def download_cta(c, h2=None, p=None, stores=None, section=True, sect_cls="sect", style=""):
    """Render the shared download CTA, optionally without its section wrapper."""
    stores = stores or [(appstore_btn(c), c["cta"]["note"])]
    badges = "".join(store_badge(btn, note) for btn, note in stores)
    card = f"""<div class="final"{f' style="{style}"' if style else ''}>
    <div class="final-app">
      <img class="ic" src="/resources/appstore/icon_512.png" width="86" height="86" loading="lazy"
           alt="{esc(c['ui']['icon_alt'])}">
      <span class="final-name">UScale<small>{esc(c['brand_tagline'])}</small></span>
    </div>
    <h2>{esc(h2 or c['cta']['h2'])}</h2>{f'''
    <p>{esc(p)}</p>''' if p else ""}
    <div class="hero-cta stores">{badges}</div>
  </div>"""
    if not section:
        return card
    return f"""<section class="{sect_cls}" id="download">
  <div class="wrap">{card}</div>
</section>"""

def flag(code, size=20, eager=False):
    """Render a decorative locale flag, eager only in the header button."""
    return (f'<img class="flag" src="/resources/flags/{BY_CODE[code][6]}.png" '
            f'width="{size}" height="{size}" alt=""'
            f'{"" if eager else " loading=\"lazy\""} decoding="async">')

def lang_switcher(c, lang, path=""):
    items = "".join(
        f'<a href="{rel_url(code, path)}" hreflang="{BY_CODE[code][4]}" lang="{BY_CODE[code][4]}"'
        f'{" aria-current=\"true\"" if code == lang else ""}>{flag(code)}{BY_CODE[code][3]}</a>'
        for code in LOCALIZED_CODES
    )
    return f"""<div class="lang">
      <button class="lang-btn" type="button" aria-expanded="false" aria-controls="language-links"
              aria-label="{esc(c['ui']['language'])}">{flag(lang, 18, eager=True)}<span>{esc(BY_CODE[lang][3])}</span></button>
      <div class="lang-menu" id="language-links">{items}</div>
    </div>"""

def nav(c, lang, home_prefix, path="", on_home=False):
    n = c["nav"]
    compare_href = f"{home_prefix}#comparison" if on_home else rel_url(lang, "compare")
    guides_href = f"{home_prefix}#guides" if on_home else f"{home_prefix}guides/"
    return f"""<header class="nav">
  <div class="wrap nav-in">
    <a class="brand" href="{home_prefix}">
      <img src="/resources/appstore/icon_180.png" width="34" height="34" alt="{esc(c['ui']['icon_alt'])}">
      <span>UScale<small>{esc(c['brand_tagline'])}</small></span>
    </a>
    <button class="burger" type="button" aria-expanded="false" aria-controls="primary-navigation"
            aria-label="{esc(n['menu'])}">{BURGER}</button>
    <nav class="nav-links" id="primary-navigation" aria-label="{esc(n['menu'])}">
      <a href="{home_prefix}#examples">{esc(n['screens'])}</a>
      <a href="{compare_href}">{esc(n.get('compare', 'Comparison'))}</a>
      <a href="{guides_href}">{esc(n['guides'])}</a>
      <a href="{home_prefix}#faq">{esc(n['faq'])}</a>
    </nav>
    {theme_toggle(c)}
    {lang_switcher(c, lang, path)}
  </div>
</header>
"""

def footer(c, lang, home_prefix, path=""):
    f = c["footer"]
    guide_links = "".join(
        f'<li><a href="{home_prefix}guides/{s}.html">{esc(c["guide_pages"][s]["nav_title"])}</a></li>'
        for s in GUIDE_SLUGS[:5]
    )
    return f"""<footer>
  <div class="wrap">
    <div class="fgrid">
      <div class="fbrand">
        <a class="brand" href="{home_prefix}">
          <img src="/resources/appstore/icon_180.png" width="34" height="34" alt="{esc(c['ui']['icon_alt'])}">
          <span>UScale<small>{esc(c['brand_tagline'])}</small></span>
        </a>
        <p>{esc(f['tagline'])}</p>
      </div>
      <div>
        <h4>{esc(f['product'])}</h4>
        <ul>
          <li><a href="{home_prefix}#examples">{esc(c['nav']['screens'])}</a></li>
          <li><a href="{home_prefix}#how">{esc(c['nav']['how'])}</a></li>
          <li><a href="{home_prefix}#reviews">{esc(f['reviews'])}</a></li>
          <li><a href="{rel_url(lang, 'compare')}">{esc(c['nav'].get('compare', 'Comparison'))}</a></li>
        </ul>
      </div>
      <div>
        <h4>{esc(c['nav']['guides'])}</h4>
        <ul>{guide_links}<li><a href="{home_prefix}guides/">{esc(f['all_guides'])}</a></li></ul>
      </div>
      <div>
        <h4>{esc(f['support'])}</h4>
        <ul>
          <li><a href="{rel_url(lang, 'support_page')}">{esc(f['help'])}</a></li>
          <li><a href="{rel_url(lang, 'privacy_policy')}">{esc(f['privacy'])}</a></li>
          <li><a href="{rel_url(lang, 'terms')}">{esc(f['terms'])}</a></li>
        </ul>
      </div>
    </div>
    <div class="fbot">
      <span>© {date.today().year} UScale · {esc(f['rights'])}</span>
      <span>{esc(f['made'])}</span>
    </div>
  </div>
</footer>
<script src="/assets/site.js?v={JS_V}" defer></script>
</body>
</html>
"""

def compare_teaser(c, lang):
    """Banner under the home examples: the same photos, run through the rival apps."""
    cp = c.get("compare")
    if not cp:
        return ""
    rivals = "".join(
        f'<span class="vs-chip" style="--i:{i}">'
        f'<img src="{a["icon"]}" width="60" height="60" loading="lazy" decoding="async" alt="">'
        f'<b>{esc(a["name"])}</b></span>' for i, a in enumerate(RIVALS))
    return f"""<a class="vs-card vs-inline" id="comparison" href="{rel_url(lang, 'compare')}">
      <div class="vs-fan" aria-hidden="true">
        <span class="vs-chip vs-chip-us">
          <img src="/resources/appstore/icon_512.png" width="76" height="76" loading="lazy"
               decoding="async" alt=""><b>UScale</b></span>
        <span class="vs-fan-mark">{esc(cp['home_vs'])}</span>
        <span class="vs-fan-rivals">{rivals}</span>
      </div>
      <div class="vs-card-copy">
        <h3>{esc(cp['home_h2'])}</h3>
        <p>{esc(cp['home_p'])}</p>
        <span class="btn btn-p vs-card-btn">{esc(cp['home_cta'])}
          <span class="arrow" aria-hidden="true">→</span></span>
        <p class="hero-note">{esc(cp['home_note'])}</p>
      </div>
    </a>"""


# Landing page
def render_home(c, lang):
    seg = BY_CODE[lang][1]
    home_prefix = f"/{seg}/" if seg else "/"
    canonical = url(lang)
    h, m = c["hero"], c["meta"]
    rating = rating_text(lang)

    app_ld = {
        "@context": "https://schema.org", "@type": "MobileApplication",
        "name": "UScale", "alternateName": APP_NAME,
        "url": canonical, "inLanguage": BY_CODE[content_lang(c, lang)][4],
        "applicationCategory": "MultimediaApplication",
        "applicationSubCategory": "Photo & Video",
        "operatingSystem": f'iOS {APP_FACTS["minimum_ios"]} or later',
        "softwareVersion": APP_VERSION,
        "fileSize": APP_FACTS["file_size"],
        "description": m["description"],
        "image": f"{SITE}/resources/appstore/icon_512.png",
        "screenshot": [f"{SITE}{s}" for s in SCREENSHOTS],
        "downloadUrl": APPSTORE, "installUrl": APPSTORE,
        "author": {"@type": "Person", "name": "Alexandr Graschenkov"},
        "publisher": {"@type": "Organization", "name": "UScale", "url": SITE,
                      "logo": f"{SITE}/resources/appstore/icon_512.png"},
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD",
                   "availability": "https://schema.org/InStock", "url": APPSTORE},
        "aggregateRating": {"@type": "AggregateRating", "ratingValue": RATING,
                            "ratingCount": RATING_COUNT, "bestRating": 5, "worstRating": 1},
        "featureList": [f["h"] for f in c["features"]["items"]],
    }
    faq_ld = {
        "@context": "https://schema.org", "@type": "FAQPage",
        "inLanguage": BY_CODE[content_lang(c, lang)][4],
        "mainEntity": [
            {"@type": "Question", "name": q["q"],
             "acceptedAnswer": {"@type": "Answer", "text": q["a"]}}
            for q in c["faq"]["items"]
        ],
    }
    site_ld = {"@context": "https://schema.org", "@type": "WebSite", "name": "UScale",
               "url": canonical, "inLanguage": BY_CODE[content_lang(c, lang)][4],
               "publisher": {"@type": "Organization", "name": "UScale", "url": SITE,
                             "logo": f"{SITE}/resources/appstore/icon_512.png"}}

    out = [head(c, lang, m["title"], m["description"], canonical,
                extra_ld=ld(app_ld) + ld(faq_ld) + ld(site_ld))]
    out.append(nav(c, lang, home_prefix, on_home=True))

    # Hero
    chips = "".join(f"<li>{esc(x)}</li>" for x in h["chips"])

    out.append(f"""<main id="main-content" tabindex="-1">
<section class="hero hero-lead">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <div class="pill">{STARS_PART}
        <span><b>{rating}</b> \u00b7 {esc(h['rating_note'])}</span></div>
      <h1>{h['h1']}</h1>
      <p class="hero-sub">{esc(h['sub'])}</p>
      <div class="hero-cta stores">{store_badge(appstore_btn(c), h['note'])}</div>
    </div>
    {hero_phone(c, h)}
    <ul class="chips hero-chips">{chips}</ul>
  </div>
</section>""")

    # Reviews
    rv = c["reviews"]
    cards = "".join(
        f'<figure class="rev">'
        f'<div class="rev-top"><span class="av av-{i % 6}" aria-hidden="true">{esc(r["initials"])}</span>'
        f'<span class="rev-who"><b>{esc(r["name"])}</b><small>{esc(r["meta"])}</small></span></div>'
        f'<div class="stars sm" aria-label="{esc(rv["stars_alt"])}">★★★★★</div>'
        f'<blockquote><h3>{esc(r["title"])}</h3><p>{esc(r["text"])}</p></blockquote>'
        f'</figure>'
        for i, r in enumerate(rv["items"]))
    out.append(f"""<section class="sect" id="reviews">
  <div class="wrap">
    <div class="head center"><span class="eyebrow">{esc(rv['eyebrow'])}</span>
      <h2 class="h2">{esc(rv['h2'])}</h2></div>
    <div class="score">
      <b>{rating}</b>
      {STARS_PART}
      <span class="score-l">{esc(rv['score_note'])}</span>
    </div>
    <div class="revs">{cards}</div>
    <p class="revs-note">{esc(rv['sub'])}</p>
  </div>
</section>""")

    # Examples — the competitor comparison sits right under them.
    teaser = compare_teaser(c, lang)
    sw = c.get("showcase")
    if sw:
        sw_tabs = []
        for i, t in enumerate(SHOWCASE_TABS):
            data = (f'data-video="{t["video"]}"' + (' data-sound="1"' if t.get("sound") else "")
                    if "video" in t
                    else f'data-before="{t["before"]}" data-after="{t["after"]}"')
            cloud = ' data-cloud="1"' if t.get("cloud") else ""
            play = '<span class="play" aria-hidden="true">▶</span>' if "video" in t else ""
            sw_tabs.append(f'<button class="cmp-tab lg"{cloud} type="button" {data} '
                           f'data-ratio="{t["ratio"]}" aria-pressed="{"true" if i == 0 else "false"}">'
                           f'<span class="cmp-thumb"><img src="{t["thumb"]}" width="118" height="89" '
                           f'loading="lazy" alt="">{play}</span>'
                           f'<span class="cmp-cap">{esc(sw["tab_labels"][i])}</span></button>')
        # The note under the badge follows the open example: a still on device,
        # a clip on device, or the advanced models we run for it.
        def od_tip(cls, key, icon):
            return (f'<span class="od-tip-v {cls}"><span class="od-tip-ic">{icon}</span>'
                    f'<span class="od-tip-tx"><b>{esc(sw[f"tip_{key}_h"])}</b>'
                    f'{esc(sw[f"tip_{key}_p"])}</span></span>')
        badge_state = ((" cloud" if SHOWCASE_TABS[0].get("cloud") else "")
                       + (" vid" if SHOWCASE_TABS[0].get("video") else ""))
        badge = (f'<span class="on-device{badge_state}" tabindex="0" aria-describedby="od-tip">'
                 f'<span class="od-v od-local">{LOCK_SVG}<span>{esc(sw["on_device"])}</span></span>'
                 f'<span class="od-v od-cloud">{CLOUD_SVG}<span>{esc(sw["in_cloud"])}</span></span>'
                 f'<span class="od-tip" id="od-tip" role="tooltip">'
                 f'{od_tip("tv-photo", "device", LOCK_SVG)}'
                 f'{od_tip("tv-video", "video", LOCK_SVG)}'
                 f'{od_tip("tv-cloud", "cloud", CLOUD_SVG)}</span></span>')
        out.append(f"""<section class="sect" id="examples">
  <div class="wrap">
    <div class="head center"><span class="eyebrow">{esc(sw['eyebrow'])}</span>
      <h2 class="h2">{esc(sw['h2'])}</h2>{f'<p class="lead">{esc(sw["sub"])}</p>' if sw['sub'] else ''}</div>
    <div class="cmp-wrap cmp-wide">
      <div class="cmp" style="--ar:{SHOWCASE_TABS[0]['ratio']}" role="group" aria-label="{esc(sw['cmp_label'])}">
        <img class="a-img" src="{SHOWCASE_TABS[0]['after']}" width="{SHOWCASE_TABS[0]['after_size'][0]}" height="{SHOWCASE_TABS[0]['after_size'][1]}" loading="lazy" decoding="async" alt="{esc(h['after_alt'])}">
        <img class="b" src="{SHOWCASE_TABS[0]['before']}" width="{SHOWCASE_TABS[0]['before_size'][0]}" height="{SHOWCASE_TABS[0]['before_size'][1]}" loading="lazy" decoding="async" alt="{esc(h['before_alt'])}">
        <span class="cmp-bar" aria-label="{esc(h['drag'])}"></span>
        <span class="cmp-tag l">{esc(h['before'])}</span>
        <span class="cmp-tag r">{esc(h['after'])}</span>
        <video class="video-player" style="display:none" muted loop playsinline preload="none"></video>
        {vid_controls(c)}
        {badge}
      </div>
      <div class="cmp-tabs cmp-tabs-lg" role="group" aria-label="{esc(sw['tabs_label'])}">{''.join(sw_tabs)}</div>
    </div>
    {teaser}
  </div>
</section>""")
    else:
        shots = "".join(
            f'<figure class="shot"><img src="{SCREENSHOTS[i]}" width="1290" height="2803" loading="lazy" '
            f'decoding="async" alt="{esc(s["alt"])}"><p>{esc(s["cap"])}</p></figure>'
            for i, s in enumerate(c["screens"]["items"]))
        out.append(f"""<section class="sect" id="examples">
  <div class="wrap">
    <div class="head center"><span class="eyebrow">{esc(c['screens']['eyebrow'])}</span>
      <h2 class="h2">{esc(c['screens']['h2'])}</h2><p class="lead">{esc(c['screens']['sub'])}</p></div>
  </div>
  <div class="wrap" style="max-width:none;padding:0"><div class="rail">{shots}</div></div>
  <div class="wrap">{teaser}</div>
</section>""")

    # How it works
    steps = "".join(f'<article class="step"><h3>{esc(s["h"])}</h3><p>{esc(s["p"])}</p></article>'
                    for s in c["how"]["steps"])
    out.append(f"""<section class="sect" id="how">
  <div class="wrap">
    <div class="head center"><span class="eyebrow">{esc(c['how']['eyebrow'])}</span>
      <h2 class="h2">{esc(c['how']['h2'])}</h2></div>
    <div class="steps">{steps}</div>
  </div>
</section>""")

    # Privacy
    pts = c["privacy"]["points"]
    # The final point is the cloud-processing exception.
    ticks = "".join(
        f'<li class="cloud">{CLOUD}<span>{esc(p)}</span></li>' if i == len(pts) - 1
        else f"<li>{CHECK}<span>{esc(p)}</span></li>"
        for i, p in enumerate(pts))
    out.append(f"""<section class="sect-tight" id="privacy">
  <div class="wrap"><div class="split">
    <div>
      <span class="eyebrow">{esc(c['privacy']['eyebrow'])}</span>
      <h2 class="h2">{esc(c['privacy']['h2'])}</h2>
      <p class="lead">{esc(c['privacy']['p'])}</p>
      <ul class="ticks">{ticks}</ul>
    </div>
    <img src="{SCREENSHOTS[2]}" width="1290" height="2803" loading="lazy" decoding="async"
         alt="{esc(c['privacy']['img_alt'])}"
         style="width:100%;max-width:290px;margin:0 auto;border-radius:28px;border:1px solid var(--line-2)">
  </div></div>
</section>""")

    # Guides
    gcards = "".join(
        guide_card(c, s, home_prefix) for s in GUIDE_SLUGS)
    out.append(f"""<section class="sect" id="guides">
  <div class="wrap">
    <div class="head center"><span class="eyebrow">{esc(c['guides']['eyebrow'])}</span>
      <h2 class="h2">{esc(c['guides']['h2'])}</h2><p class="lead">{esc(c['guides']['sub'])}</p></div>
    <div class="guides guides-collapsible" id="home-guides-list">{gcards}</div>
    <p class="guides-more">
      <button class="btn btn-g guides-toggle" type="button" aria-expanded="false"
              aria-controls="home-guides-list"
              data-expand="{esc(c['guides'].get('expand', 'Expand all guides'))}"
              data-collapse="{esc(c['guides'].get('collapse', 'Show fewer guides'))}">
        <span>{esc(c['guides'].get('expand', 'Expand all guides'))}</span>
        {CHEVRON_SVG}
      </button></p>
  </div>
</section>""")

    # FAQ
    fq = "".join(
        f'<details{" open" if i == 0 else ""}><summary>{esc(q["q"])}</summary>'
        f'<div class="a"><p>{esc(q["a"])}</p>' + (
            f'<p style="margin-top:12px"><a href="{faq_href(q["href"], home_prefix)}"'
            f'{" target=\"_blank\" rel=\"noopener\"" if q["href"].startswith("http") else ""}>'
            f'{esc(q.get("cta") or c["faq"]["learn_more"])} →</a></p>' if q.get("href") else ""
        ) + '</div></details>'
        for i, q in enumerate(c["faq"]["items"]))
    out.append(f"""<section class="sect" id="faq">
  <div class="wrap">
    <div class="head center"><span class="eyebrow">{esc(c['faq']['eyebrow'])}</span>
      <h2 class="h2">{esc(c['faq']['h2'])}</h2><p class="lead">{esc(c['faq']['sub'])}</p></div>
    <div class="faq">{fq}</div>
  </div>
</section>""")

    # Final CTA
    out.append(download_cta(c) + "\n</main>")

    out.append(footer(c, lang, home_prefix))
    return "".join(out)

# Guide hub
def render_guides_index(c, lang):
    seg = BY_CODE[lang][1]
    home_prefix = f"/{seg}/" if seg else "/"
    canonical = url(lang, "guides")
    gi = c["guides_index"]

    crumbs_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": c["ui"]["home"], "item": url(lang)},
        {"@type": "ListItem", "position": 2, "name": c["nav"]["guides"], "item": canonical}]}
    list_ld = {"@context": "https://schema.org", "@type": "CollectionPage",
               "name": gi["h1"], "description": gi["description"], "url": canonical,
               "inLanguage": BY_CODE[content_lang(c, lang)][4],
               "hasPart": [{"@type": "Article", "headline": c["guide_pages"][s]["h1"],
                            "url": url(lang, f"guides/{s}")} for s in GUIDE_SLUGS]}

    cards = "".join(
        guide_card(c, s, home_prefix) for s in GUIDE_SLUGS)

    return (head(c, lang, gi["title"], gi["description"], canonical, path="guides",
                 extra_ld=ld(crumbs_ld) + ld(list_ld))
            + nav(c, lang, home_prefix, "guides")
            + f"""<main class="wrap" id="main-content" tabindex="-1">
  <nav class="crumbs" aria-label="{esc(c['ui'].get('breadcrumb', 'Breadcrumb'))}">
    <a href="{home_prefix}">{esc(c['ui']['home'])}</a><span>›</span><span>{esc(c['nav']['guides'])}</span>
  </nav>
  <div class="art" style="max-width:900px">
    <span class="eyebrow">{esc(c['guides']['eyebrow'])}</span>
    <h1>{esc(gi['h1'])}</h1>
    <p class="lead">{esc(gi['intro'])}</p>
  </div>
  <div class="guides" style="max-width:900px;margin:0 auto 60px">{cards}</div>
  {download_cta(c, section=False, style="margin-bottom:20px")}
</main>"""
            + footer(c, lang, home_prefix, "guides"))

# Guide page
def render_guide(c, lang, slug):
    seg = BY_CODE[lang][1]
    home_prefix = f"/{seg}/" if seg else "/"
    path = f"guides/{slug}"
    canonical = url(lang, path)
    g = c["guide_pages"][slug]
    meta = GUIDE_META[slug]

    idx = GUIDE_SLUGS.index(slug)
    nxt = [GUIDE_SLUGS[(idx + 1) % len(GUIDE_SLUGS)], GUIDE_SLUGS[(idx + 2) % len(GUIDE_SLUGS)]]

    howto_ld = {
        "@context": "https://schema.org", "@type": "HowTo",
        "name": g["h1"], "description": g["answer"], "inLanguage": BY_CODE[content_lang(c, lang)][4],
        "image": f"{SITE}{meta.get('og', meta['shot'])}",
        "totalTime": "PT2M",
        "tool": [{"@type": "HowToTool", "name": f'iPhone or iPad (iOS {APP_FACTS["minimum_ios"]}+)'},
                 {"@type": "HowToTool", "name": "UScale"}],
        "supply": [{"@type": "HowToSupply", "name": g["supply"]}],
        "estimatedCost": {"@type": "MonetaryAmount", "currency": "USD", "value": "0"},
        "step": [{"@type": "HowToStep", "position": i + 1, "name": s["h"], "text": s["p"],
                  "url": f"{canonical}#step-{i + 1}"} for i, s in enumerate(g["steps"])],
    }
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage",
              "inLanguage": BY_CODE[content_lang(c, lang)][4],
              "mainEntity": [{"@type": "Question", "name": q["q"],
                              "acceptedAnswer": {"@type": "Answer", "text": q["a"]}} for q in g["faq"]]}
    crumbs_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": c["ui"]["home"], "item": url(lang)},
        {"@type": "ListItem", "position": 2, "name": c["nav"]["guides"], "item": url(lang, "guides")},
        {"@type": "ListItem", "position": 3, "name": g["h1"], "item": canonical}]}

    steps = "".join(
        f'<li id="step-{i + 1}"><strong>{esc(s["h"])}</strong><span>{esc(s["p"])}</span></li>'
        for i, s in enumerate(g["steps"]))
    tips = "".join(f"<li>{esc(t)}</li>" for t in g["tips"])
    mini_faq = "".join(
        f'<details><summary>{esc(q["q"])}</summary><div class="a"><p>{esc(q["a"])}</p></div></details>'
        for q in g["faq"])
    nxt_html = "".join(
        f'<a href="{home_prefix}guides/{s}.html"><small>{esc(c["ui"]["next_guide"])}</small>'
        f'<b>{esc(c["guide_pages"][s]["card_title"])}</b></a>' for s in nxt)

    # Optional blocks: the restoration guides explain the mode picker and its advanced options.
    extra = ""
    if g.get("demo") and meta.get("demo"):
        extra += (f'<h2 id="demo">{esc(g["demo"]["h"])}</h2><p>{esc(g["demo"]["intro"])}</p>'
                  + toggle_demo(g["demo"], meta["demo"]))
    for key in ("modes", "options"):
        if g.get(key):
            extra += (f'<h2 id="{key}">{esc(g[f"{key}_h"])}</h2><p>{esc(g[f"{key}_intro"])}</p>'
                      + option_cards(g[key]))

    if meta.get("video"):
        poster = f' poster="{meta["poster"]}"' if meta.get("poster") else ""
        media_html = (f'<figure class="guide-media guide-video">'
                      f'<video src="{meta["video"]}"{poster} muted loop playsinline autoplay controls '
                      f'preload="metadata"></video>'
                      f'<figcaption>{esc(g.get("video_caption") or g["img_caption"])}</figcaption></figure>')
    else:
        bw, bh = meta["before_size"]
        aw, ah = meta["after_size"]
        media_html = f'''<figure class="guide-media cmp-wrap">
      <div class="cmp" style="--ar:{meta['ratio']};aspect-ratio:var(--ar)" role="group" aria-label="{esc(c['hero']['cmp_label'])}">
        <img class="a-img" src="{meta['after']}" width="{aw}" height="{ah}"
             alt="{esc(g['img_alt'])}" fetchpriority="high" decoding="async">
        <img class="b" src="{meta['before']}" width="{bw}" height="{bh}"
             alt="" aria-hidden="true" fetchpriority="high" decoding="async">
        <span class="cmp-tag l">{esc(c['hero']['before'])}</span>
        <span class="cmp-tag r">{esc(c['hero']['after'])}</span>
        <span class="cmp-bar" aria-label="{esc(c['hero']['drag'])}"></span>
      </div>
      <figcaption>{esc(g['img_caption'])}</figcaption>
    </figure>'''

    body = f"""<main class="wrap" id="main-content" tabindex="-1">
  <nav class="crumbs" aria-label="{esc(c['ui'].get('breadcrumb', 'Breadcrumb'))}">
    <a href="{home_prefix}">{esc(c['ui']['home'])}</a><span>›</span>
    <a href="{home_prefix}guides/">{esc(c['nav']['guides'])}</a><span>›</span>
    <span>{esc(g['card_title'])}</span>
  </nav>
  <article class="art">
    <span class="eyebrow">{esc(g['kicker'])}</span>
    <h1>{esc(g['h1'])}</h1>
    <div class="meta"><span>{date_tag(updated_for(path), c['ui']['updated'], lang=lang)}</span><span>·</span>
      <span>{esc(g['read_time'])}</span><span>·</span><span>{esc(c['ui']['by'])}</span></div>

    {media_html}

    <div class="answer"><p>{esc(g['answer'])}</p></div>

    <p>{esc(g['intro'])}</p>

    <h2>{esc(g['why_h'])}</h2>
    <p>{esc(g['why_p'])}</p>
    <ul class="b">{''.join(f'<li>{esc(x)}</li>' for x in g['why_list'])}</ul>

    <h2 id="steps">{esc(g['steps_h'])}</h2>
    <p>{esc(g['steps_intro'])}</p>
    <ol class="howto">{steps}</ol>
    {extra}
    <h2>{esc(g['tips_h'])}</h2>
    <ul class="b">{tips}</ul>

    <div class="inline-cta">
      <img src="/resources/appstore/icon_512.png" width="66" height="66" loading="lazy"
           alt="{esc(c['ui']['icon_alt'])}">
      <div><h3>{esc(g['cta_h'])}</h3><p>{esc(g['cta_p'])}</p></div>
      {appstore_btn(c)}
    </div>

    <h2>{esc(g['faq_h'])}</h2>
    <div class="faq" style="margin-top:20px">{mini_faq}</div>

    <h2>{esc(c['ui']['keep_reading'])}</h2>
    <div class="next">{nxt_html}</div>
  </article>
</main>"""

    return (head(c, lang, g["title"], g["description"], canonical, path=path,
                 og_image=f"{SITE}{meta.get('og', meta['shot'])}",
                 extra_ld=ld(howto_ld) + ld(faq_ld) + ld(crumbs_ld))
            + nav(c, lang, home_prefix, path)
            + body
            + footer(c, lang, home_prefix, path))

# Standalone pages
def doc_body(c, d):
    if not d.get("sections"):
        return (f'<div class="art" style="max-width:820px;padding-bottom:4px">'
                f'<span class="eyebrow">{esc(d["eyebrow"])}</span><h1>{esc(d["h1"])}</h1>'
                f'<p class="lead">{esc(d["lead"])}</p>'
                f'<div class="meta"><span>{d["updated"]}</span></div></div>'
                f'<article class="doc">{d["body"]}</article>')
    secs, toc = doc_sections(d["body"])
    return f"""<header class="doc-head">
    <div class="doc-title">
      <h1>{esc(d['h1'])}</h1>
      <span class="doc-upd">{DOT}{d['updated']}</span>
    </div>
    <p class="lead">{esc(d['lead'])}</p>
  </header>
  <div class="doc-grid">
    <details class="doc-toc" open>
      <summary>{esc(c['ui'].get('on_this_page', 'On this page'))}</summary>
      <nav aria-label="{esc(c['ui'].get('on_this_page', 'On this page'))}"><ol>{toc}</ol></nav>
    </details>
    <article class="doc doc-cards">{secs}</article>
  </div>"""


def doc_sections(body):
    """Split legal sections into the main and contact cards."""
    parts = [x for x in re.split(r"(?=<h2>)", body.strip()) if x.strip()]
    intro = "" if parts and parts[0].lstrip().startswith("<h2>") else (parts.pop(0) if parts else "")
    main, contact, toc = [], "", []
    for index, part in enumerate(parts, 1):
        title = re.sub(r"<[^>]+>", "", re.match(r"<h2>(.*?)</h2>", part, re.S).group(1)).strip()
        sid = re.sub(r"-+", "-", re.sub(r"[^\w]+", "-", title.lower())).strip("-_")
        sid = sid or f"section-{index}"
        sec = f'<section class="doc-sec" id="{sid}">{part.strip()}</section>'
        # The translated heading may not begin with "contact". Legal documents
        # consistently keep their contact section last; earlier sections may also
        # contain a mailto link and must not disappear from the main card.
        if index == len(parts) and "mailto:" in part:
            contact = f'<div class="doc-card is-contact">{sec}</div>'
        else:
            main.append(sec)
        toc.append(f'<li><a href="#{sid}">{esc(title)}</a></li>')
    card = f'<div class="doc-card">{intro}{"".join(main)}</div>' if (intro or main) else ""
    return card + contact, "".join(toc)


def localize_body_links(body, lang):
    """Point root-relative links in standalone copy at the matching locale."""
    if lang == "en":
        return body
    prefix = f'/{BY_CODE[lang][1]}'
    routes = ("guides/", "support_page.html", "privacy_policy.html", "terms.html",
              "sale.html", "compare.html")
    for route in routes:
        body = body.replace(f'href="/{route}', f'href="{prefix}/{route}')
    return body


def render_doc(c, d, lang):
    """Render support / terms / privacy at their locale-aware historical route."""
    d = dict(d)
    d["body"] = localize_body_links(inject_facts(d["body"], lang), lang)
    # Pre-rendered markup: doc_body drops it in as-is (see the two call sites below).
    d["updated"] = date_tag(updated_for(d["file"]), c["ui"]["updated"], english=lang == "en", lang=lang)
    path = logical_path(d["file"])
    canonical = url(lang, path)
    home_prefix = rel_url(lang)
    crumbs_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": c["ui"]["home"], "item": url(lang)},
        {"@type": "ListItem", "position": 2, "name": d["h1"], "item": canonical}]}
    extra = ld(crumbs_ld)
    if d["file"] == "support_page.html":
        support_faq = c["support_faq_ld"]
        extra += ld({"@context": "https://schema.org", "@type": "FAQPage", "url": canonical,
                     "mainEntity": [{"@type": "Question", "name": q,
                                     "acceptedAnswer": {"@type": "Answer", "text": a}}
                                    for q, a in inject_facts(support_faq, lang)]})
    return (head(c, lang, d["title"], d["description"], canonical, path=path, extra_ld=extra)
            + nav(c, lang, home_prefix, path)
            + f"""<main class="wrap" id="main-content" tabindex="-1">
  <nav class="crumbs" aria-label="{esc(c['ui'].get('breadcrumb', 'Breadcrumb'))}">
    <a href="{home_prefix}">{esc(c['ui']['home'])}</a><span>&rsaquo;</span><span>{esc(d['h1'])}</span>
  </nav>
  {doc_body(c, d)}
</main>"""
            + footer(c, lang, home_prefix, path))


def render_sale(c, lang):
    canonical = url(lang, "sale")
    home_prefix = rel_url(lang)
    # inject_facts has already resolved {off} in the locale's own number format.
    sale = c["sale"]
    return (head(c, lang, sale["title"],
                 sale["description"],
                 canonical, path="sale",
                 og_image=f"{SITE}{SCREENSHOTS[3]}",
                 robots="noindex,follow")
            + nav(c, lang, home_prefix, "sale")
            + f"""<main id="main-content" tabindex="-1">
<section class="hero">
  <div class="wrap">
    <div class="hero-grid">
      <div>
        <span class="pill"><b>{esc(sale['pill'])}</b> · {esc(sale['off'])}</span>
        <h1>{sale['h1']}</h1>
        <p class="hero-sub">{esc(sale['sub'])}</p>
        <div class="promo" id="promo-code-card">
          <span class="promo-l">{esc(sale['promo'])}</span>
          <span class="promo-v" id="promo-code-value"></span>
        </div>
        <div class="hero-cta sale-cta">
          <a class="btn btn-p btn-xl" id="open-app-link" href="upscale://offer/sale">{esc(sale['open'])}<span class="arrow" aria-hidden="true">→</span></a>
        </div>
        <p class="hero-note">{esc(sale['note'])}</p>
      </div>
      <div class="sale-art">
        <span class="sale-badge">{esc(sale['badge'])}</span>
        <img src="{SCREENSHOTS[3]}" width="298" height="645" alt="{esc(sale['image_alt'])}"
             fetchpriority="high" decoding="async">
      </div>
    </div>
  </div>
</section>

{download_cta(c, sect_cls="sect sect-tight",
              h2=sale['cta_h'],
              p=sale['cta_p'])}
</main>
<script>
(function () {{
  var params = new URLSearchParams(window.location.search);
  var raw = params.get('code') || '';
  var code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
                .replace(/(.{{4}})/g, '$1-').replace(/-$/, '');

  var appURL = new URL('upscale://offer/sale');
  if (code) {{
    appURL = new URL('upscale://offer/promo');
    appURL.searchParams.set('code', code);
    document.getElementById('promo-code-value').textContent = code;
    document.getElementById('promo-code-card').classList.add('visible');
  }}
  document.getElementById('open-app-link').href = appURL.toString();
}})();
</script>"""
            + footer(c, lang, home_prefix, "sale"))


# Competitor comparison
def app_icon(app, size=54, cls="vs-ico"):
    return (f'<img class="{cls}" src="{app["icon"]}" width="{size}" height="{size}" '
            f'loading="lazy" decoding="async" '
            f'alt="{esc(app["name"])}">')


def compare_slider(c, cp, tid):
    """The original on the left; each tab swaps in the result of one app on the right."""
    t = COMPARE_TESTS[tid]
    w, h = t["size"]
    bw, bh = t["before_size"]
    us = APP_BY_ID["uscale"]

    def result_alt(app):
        return f'{cp["alt_result"]} {app["name"]}'

    btns = "".join(
        f'<button class="cmp-tab lg vs-tab" type="button" data-before="{t["before"]}" '
        f'data-after="{t["shot"][a["id"]]}" data-tag-l="{esc(cp["original"])}" '
        f'data-tag-r="{esc(a["name"])}" data-tag-ico="{a["icon"]}" '
        f'data-after-alt="{esc(result_alt(a))}" '
        f'aria-pressed="{"true" if i == 0 else "false"}">'
        f'<span class="cmp-thumb"><img src="{a["icon"]}" width="72" height="72" loading="lazy" '
        f'decoding="async" alt=""></span><span class="cmp-cap">{esc(a["name"])}</span></button>'
        for i, a in enumerate(COMPARE_APPS))
    return f"""<div class="cmp-wrap cmp-wide vs-cmp" data-keep-pos="1">
      <div class="cmp" style="--ar:{t['ratio']}" role="group" aria-label="{esc(cp['h1'])}">
        <img class="a-ghost" src="{t['shot']['uscale']}" width="{w}" height="{h}" loading="lazy"
             decoding="async" alt="" aria-hidden="true">
        <img class="a-img" src="{t['shot']['uscale']}" width="{w}" height="{h}" loading="lazy" decoding="async"
             alt="{esc(result_alt(us))}">
        <img class="b" src="{t['before']}" width="{bw}" height="{bh}" loading="lazy" decoding="async"
             alt="{esc(cp['alt_before'])}">
        <span class="cmp-bar" aria-label="{esc(c['hero']['drag'])}"></span>
        <span class="cmp-tag l">{esc(cp['original'])}</span>
        <span class="cmp-tag r"><img class="tag-ico" src="{us['icon']}" width="20" height="20"
              decoding="async" alt=""><span class="tag-nm">UScale</span></span>
      </div>
      <div class="cmp-tabs cmp-tabs-lg vs-tabs" role="group" aria-label="{esc(cp['apps_h'])}">{btns}</div>
    </div>"""


def compare_zoom(cp, tid):
    """The same crop out of every app, at the size it is actually delivered."""
    t = COMPARE_TESTS[tid]
    w, h = t["zoom_size"]
    zooms = [z for z in (t["zoom"], t.get("zoom2")) if z]
    keys = [(cp["original"], None, "before")] + [(a["name"], a, a["id"]) for a in COMPARE_APPS]

    def shots(key, name):
        # one column per app; a second crop simply stacks under the first
        return "".join(
            f'<img src="{z[key]}" width="{w}" height="{h}" loading="lazy" decoding="async" '
            f'alt="{esc(name)} — {esc(cp.get("crop_alt", "close crop"))}">' for z in zooms)

    out = "".join(
        f'<figure class="zt{" is-us" if app and app["id"] == "uscale" else ""}">'
        f'{shots(key, name)}'
        f'<figcaption>{app_icon(app, 26, "zt-ico") if app else ""}<b>{esc(name)}</b></figcaption>'
        f'</figure>'
        for name, app, key in keys)
    return f'<div class="rail vs-rail">{out}</div>'


def compare_table(cp):
    rows = cp["table_rows"]
    head = "".join(
        f'<th scope="col"{" class=\"is-us\"" if a["id"] == "uscale" else ""}>{app_icon(a, 34)}'
        f'<span>{esc(a["name"])}</span></th>' for a in COMPARE_APPS)

    def row(label, values, cls=""):
        cells = "".join(
            f'<td{" class=\"is-us\"" if a["id"] == "uscale" else ""}>{values[a["id"]]}</td>'
            for a in COMPARE_APPS)
        return f'<tr{f" class=\"{cls}\"" if cls else ""}><th scope="row">{esc(label)}</th>{cells}</tr>'

    def mark(ok):
        return (f'<span class="vs-yes">{CHECK}{esc(cp["yes"])}</span>' if ok
                else f'<span class="vs-no">✕ {esc(cp["no"])}</span>')

    escaped = {k: {i: esc(v) for i, v in cells.items()} for k, cells in cp["cells"].items()}
    out_spider = dict(COMPARE_TESTS["spider"]["out"])
    out_spider["blurbuster"] += f'<small>{esc(cp["table_bb_note"])}</small>'
    body = (row(rows["out_girls"], COMPARE_TESTS["girls"]["out"], "vs-num")
            + row(rows["out_spider"], out_spider, "vs-num")
            + row(rows["faces"], escaped["faces"])
            + row(rows["rest"], escaped["rest"])
            + row(rows["noface"], escaped["noface"])
            + row(rows["fidelity"], {a["id"]: mark(a["id"] != "blurbuster") for a in COMPARE_APPS}))
    return (f'<div class="vs-table-wrap"><table class="vs-table">'
            f'<thead><tr><td></td>{head}</tr></thead><tbody>{body}</tbody></table></div>')


def render_compare_simple(c, lang):
    """Compact localized comparison page; it keeps every interactive test asset."""
    cp = c["compare"]
    canonical = url(lang, "compare")
    home_prefix = rel_url(lang)
    crumbs_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": c["ui"]["home"], "item": url(lang)},
        {"@type": "ListItem", "position": 2, "name": cp["nav"], "item": canonical}]}
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage", "url": canonical,
              "mainEntity": [{"@type": "Question", "name": q["q"],
                              "acceptedAnswer": {"@type": "Answer", "text": q["a"]}}
                             for q in cp["faq"]]}
    apps = "".join(
        f'<li{" class=\"is-us\"" if a["id"] == "uscale" else ""}>'
        f'<a href="{a["url"]}" target="_blank" rel="noopener nofollow">{app_icon(a, 62)}'
        f'<b>{esc(a["name"])}</b><small>{esc(a["dev"])}</small>'
        f'<span>{esc(cp["apps"][a["id"]]["role"])}</span></a>'
        f'<p>{esc(cp["apps"][a["id"]]["verdict"])}</p></li>' for a in COMPARE_APPS)
    tests = ""
    for i, t in enumerate(cp["tests"]):
        tests += f"""<section class="vs-test" id="test-{t['id']}">
    <div class="vs-head"><span class="vs-step">{i + 1}</span>
      <div><h2>{esc(t['h2'])}</h2><p class="lead">{esc(t['sub'])}</p></div></div>
    {compare_slider(c, cp, t['id'])}
    <div class="vs-zoom-head"><h3>{esc(cp['zoom_h'])}</h3></div>
    {compare_zoom(cp, t['id'])}
    <div class="answer vs-look"><p><b>{esc(cp['look_for'])}:</b> {esc(t['look'])}</p></div>
  </section>"""
    dl = (f'<p class="vs-dl-h">{esc(cp["dl_h"])}</p><div class="vs-dl">'
          + "".join(f'<a class="btn btn-g vs-dl-btn" href="{COMPARE_TESTS[k]["before"]}" download>'
                    f'{DOWN_SVG}{esc(v)}</a>' for k, v in cp.get("dl", {}).items())
          + '</div>') if cp.get("dl") else ""
    faq = "".join(
        f'<details{" open" if i == 0 else ""}><summary>{esc(q["q"])}</summary>'
        f'<div class="a"><p>{esc(q["a"])}</p>{dl if q.get("dl") else ""}</div></details>'
        for i, q in enumerate(cp["faq"]))
    chips = "".join(f"<li>{esc(x)}</li>" for x in cp["chips"])
    return (head(c, lang, cp["title"], cp["description"], canonical, path="compare",
                 og_image=f"{SITE}{COMPARE_TESTS['spider']['shot']['uscale']}",
                 extra_ld=ld(faq_ld) + ld(crumbs_ld))
            + nav(c, lang, home_prefix, "compare")
            + f"""<main class="wrap vs" id="main-content" tabindex="-1">
  <nav class="crumbs" aria-label="{esc(c['ui'].get('breadcrumb', 'Breadcrumb'))}"><a href="{home_prefix}">{esc(c['ui']['home'])}</a>
    <span>&rsaquo;</span><span>{esc(cp['nav'])}</span></nav>
  <div class="vs-intro"><span class="eyebrow">{esc(cp['eyebrow'])}</span><h1>{esc(cp['h1'])}</h1>
    <p class="lead">{esc(cp['lead'])}</p><ul class="chips">{chips}</ul>
    <div class="meta"><span>{date_tag(updated_for('compare.html'), c['ui']['updated'], lang=lang)}</span>
      <span>&middot;</span><span>{esc(c['ui']['by'])}</span></div></div>
  <h2 class="vs-h">{esc(cp['apps_h'])}</h2><ul class="vs-apps">{apps}</ul>
  {tests}
  <section class="vs-faq"><h2>{esc(cp['faq_h'])}</h2><div class="faq">{faq}</div></section>
  <section class="vs-method"><h2>{esc(cp['method_h'])}</h2><p>{esc(cp['method_p'])}</p></section>
  {download_cta(c, section=False, h2=cp['cta_h'], p=cp['cta_p'])}
  <p class="vs-legal">{esc(cp['disclaimer'])}</p>
</main>""" + footer(c, lang, home_prefix, "compare"))


def render_compare(c, lang):
    cp = c["compare"]
    if cp.get("simple"):
        return render_compare_simple(c, lang)
    canonical = url(lang, "compare")
    home_prefix = rel_url(lang)
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage", "url": canonical,
              "mainEntity": [{"@type": "Question", "name": q["q"],
                              "acceptedAnswer": {"@type": "Answer", "text": q["a"]}}
                             for q in cp["faq"]]}
    crumbs_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": c["ui"]["home"], "item": url(lang)},
        {"@type": "ListItem", "position": 2, "name": cp["nav"], "item": canonical}]}

    apps = "".join(
        f'<li{" class=\"is-us\"" if a["id"] == "uscale" else ""}>'
        f'<a href="{a["url"]}" target="_blank" rel="noopener nofollow">{app_icon(a, 62)}'
        f'<b>{esc(a["name"])}</b><small>{esc(a["dev"])}</small>'
        f'<span>{esc(cp["apps"][a["id"]]["role"])}</span></a>'
        f'<p>{esc(cp["apps"][a["id"]]["verdict"])}</p></li>'
        for a in COMPARE_APPS)

    tests = ""
    for i, t in enumerate(cp["tests"]):
        tests += f"""<section class="vs-test" id="test-{t['id']}">
    <div class="vs-head">
      <span class="vs-step">{i + 1}</span>
      <div><h2>{esc(t['h2'])}</h2><p class="lead">{esc(t['sub'])}</p></div>
    </div>
    {compare_slider(c, cp, t['id'])}
    <div class="vs-zoom-head"><h3>{esc(cp['zoom_h'])}</h3></div>
    {compare_zoom(cp, t['id'])}
    <div class="answer vs-look"><p><b>{esc(cp['look_for'])}:</b> {esc(t['look'])}</p></div>
  </section>"""

    bb = APP_BY_ID["blurbuster"]
    w, h = COMPARE_TESTS["spider"]["zoom_size"]
    modes = f"""<section class="vs-modes">
    <div class="vs-modes-copy">
      {app_icon(bb, 46)}
      <h2>{esc(cp['modes_h'])}</h2>
      <p>{esc(cp['modes_p'])}</p>
    </div>
    <div class="vs-modes-shots">
      <figure><img src="{COMPARE_TESTS['spider']['zoom']['blurbuster']}" width="{w}" height="{h}"
        loading="lazy" decoding="async" alt="{esc(cp['modes_a'])}">
        <figcaption>{esc(cp['modes_a'])}</figcaption></figure>
      <figure><img src="{BB_SOFT['zoom']}" width="{w}" height="{h}" loading="lazy" decoding="async"
        alt="{esc(cp['modes_b'])}"><figcaption>{esc(cp['modes_b'])}</figcaption></figure>
    </div>
  </section>"""

    dl = (f'<p class="vs-dl-h">{esc(cp["dl_h"])}</p><div class="vs-dl">'
          + "".join(f'<a class="btn btn-g vs-dl-btn" href="{COMPARE_TESTS[k]["before"]}" download>'
                    f'{DOWN_SVG}{esc(v)}</a>' for k, v in cp["dl"].items())
          + '</div>')
    faq = "".join(
        f'<details{" open" if i == 0 else ""}><summary>{esc(q["q"])}</summary>'
        f'<div class="a"><p>{esc(q["a"])}</p>{dl if q.get("dl") else ""}</div></details>'
        for i, q in enumerate(cp["faq"]))

    chips = "".join(f"<li>{esc(x)}</li>" for x in cp["chips"])

    return (head(c, lang, cp["title"], cp["description"], canonical, path="compare",
                 og_image=f"{SITE}{COMPARE_TESTS['spider']['shot']['uscale']}",
                 extra_ld=ld(faq_ld) + ld(crumbs_ld))
            + nav(c, lang, home_prefix, "compare")
            + f"""<main class="wrap vs" id="main-content" tabindex="-1">
  <nav class="crumbs" aria-label="{esc(c['ui'].get('breadcrumb', 'Breadcrumb'))}">
    <a href="{home_prefix}">{esc(c['ui']['home'])}</a><span>&rsaquo;</span><span>{esc(cp['nav'])}</span>
  </nav>
  <div class="vs-intro">
    <span class="eyebrow">{esc(cp['eyebrow'])}</span>
    <h1>{esc(cp['h1'])}</h1>
    <p class="lead">{esc(cp['lead'])}</p>
    <ul class="chips">{chips}</ul>
    <div class="meta"><span>{date_tag(updated_for('compare.html'), c['ui']['updated'], english=lang == 'en', lang=lang)}</span>
      <span>&middot;</span><span>{esc(c['ui']['by'])}</span></div>
  </div>

  <h2 class="vs-h">{esc(cp['apps_h'])}</h2>
  <ul class="vs-apps">{apps}</ul>

  {tests}

  {modes}

  <section class="vs-sum">
    <h2>{esc(cp['table_h'])}</h2>
    {compare_table(cp)}
    <p class="vs-sub">{esc(cp['table_note'])}</p>
  </section>

  <section class="vs-faq">
    <h2>{esc(cp['faq_h'])}</h2>
    <div class="faq">{faq}</div>
  </section>

  <section class="vs-method">
    <h2>{esc(cp['method_h'])}</h2>
    <p>{esc(cp['method_p'])}</p>
  </section>

  {download_cta(c, section=False, h2=cp['cta_h'], p=cp['cta_p'])}
  <p class="vs-legal">{esc(cp['disclaimer'])}</p>
</main>"""
            + footer(c, lang, home_prefix, "compare"))


# Sitemap
def render_sitemap():
    entries = []
    paths = (["", "guides"] + [f"guides/{s}" for s in GUIDE_SLUGS]
             + ["compare", "support_page", "terms", "privacy_policy"])
    for p in paths:
        for code in LOCALIZED_CODES:
            alts = "".join(
                f'\n    <xhtml:link rel="alternate" hreflang="{BY_CODE[o][4]}" href="{url(o, p)}"/>'
                for o in LOCALIZED_CODES)
            alts += f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{url("en", p)}"/>'
            prio = "1.0" if p == "" and code == "en" else ("0.9" if p == "" else "0.8")
            entries.append(
                f'  <url>\n    <loc>{url(code, p)}</loc>\n    <lastmod>{updated_for(p)}</lastmod>'
                f'\n    <changefreq>weekly</changefreq>\n    <priority>{prio}</priority>{alts}\n  </url>')
    # sale.html is noindex and intentionally omitted.
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n'
            '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
            + "\n".join(entries) + "\n</urlset>\n")

ROBOTS = f"""User-agent: *
Allow: /

Sitemap: {SITE}/sitemap.xml
"""

# Build entry point
def main():
    requested = sys.argv[1:]
    langs = requested or list(LOCALIZED_CODES)
    unknown = [l for l in langs if l not in BY_CODE]
    if unknown:
        sys.exit(f"unknown locale(s) {unknown}; known: {list(BY_CODE)}")
    untranslated = [l for l in langs if l not in LOCALIZED_CODES]
    if untranslated:
        sys.exit(f"locale(s) {untranslated} have no translated content; available: {list(LOCALIZED_CODES)}")
    # Only a full build removes stale generated files.
    full = not requested or set(langs) == set(LOCALIZED_CODES)
    if full and os.path.isdir(DIST):
        shutil.rmtree(DIST)
    built = 0
    for code in langs:
        c = inject_facts(localization_catalog.load_locale(code), code)
        missing = [s for s in GUIDE_SLUGS if s not in c.get("guide_pages", {})]
        if missing:
            print(f"  ! {code}: missing guides {missing}")
        seg = BY_CODE[code][1]
        base = seg + "/" if seg else ""
        write(f"{base}index.html", render_home(c, code)); built += 1
        write(f"{base}guides/index.html", render_guides_index(c, code)); built += 1
        for slug in GUIDE_SLUGS:
            if slug in c["guide_pages"]:
                write(f"{base}guides/{slug}.html", render_guide(c, code, slug)); built += 1
        for d in c["docs"]:
            write(f"{base}{d['file']}", render_doc(c, d, code)); built += 1
        write(f"{base}sale.html", render_sale(c, code)); built += 1
        write(f"{base}compare.html", render_compare(c, code)); built += 1
        print(f"  ✓ {code}")
    write("sitemap.xml", render_sitemap())
    write("robots.txt", ROBOTS)
    copy_static()
    if UNKNOWN_FACTS:
        print(f"  ! unknown fact placeholders left as-is: {sorted(UNKNOWN_FACTS)}")
    if MISSING_DATES:
        print(f"  ! no page_updated entry, using the home date: {sorted(MISSING_DATES)}")
    print(f"\nBuilt {built} pages + sitemap.xml + robots.txt into dist/")

if __name__ == "__main__":
    main()
