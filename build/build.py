#!/usr/bin/env python3
"""Build the localized static site into dist/.

Usage: python3 build/build.py [locale ...]
Assets and resources keep their paths; static/ is copied into the site root.
Mutable app facts (prices, rating, version, publish dates) come from build/app_facts.json.

TODO: every locale still falls back to content/en.json — translate once the English
copy is final.
"""

import hashlib, json, os, re, shutil, sys
from datetime import date

# shutil.copytree(dirs_exist_ok=...) requires Python 3.8+.
if sys.version_info < (3, 8):
    sys.exit(f"build.py needs Python 3.8+, got {sys.version.split()[0]}")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pages

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "build", "content")
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
RATING_TEXT = f"{RATING:g}"
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
        "shot": f"{BA}/upscale_4k_thumb.jpg",
        "before": f"{BA}/before_1.jpg", "after": f"{BA}/after_1.jpg",
        "ratio": "1.1735", "before_size": (683, 582), "after_size": (2732, 2328),
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

CHEVRON_SVG = ('<svg class="guides-chevron" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5.5 8.75 12 15.25 18.5 8.75" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>')

LOCK_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true">'
            '<path d="M8.6 10.6V7.4a3.4 3.4 0 0 1 6.8 0v3.2" fill="none" stroke="currentColor" '
            'stroke-width="2.1" stroke-linecap="round"/>'
            '<rect x="4.7" y="10" width="14.6" height="11" rx="3.4" fill="currentColor"/></svg>')
CLOUD_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">'
             '<circle cx="8.2" cy="13.6" r="3.3"/><circle cx="12.6" cy="11.2" r="4.7"/>'
             '<circle cx="16.4" cy="13.9" r="3.4"/>'
             '<rect x="4.9" y="13.8" width="14.9" height="4" rx="2"/></g></svg>')

APPLE_LOGO = ('<svg viewBox="0 0 384 512" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8'
              '-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C61.9 141.2 12'
              ' 184.6 12 273c0 26.1 4.8 53.1 14.4 80.8 12.8 36.5 58.9 126 107 124.5 25.1-.6 42.9-17.9 75.6-17.9'
              ' 31.7 0 48.1 17.9 76.1 17.9 48.5-.7 90.2-82 102.4-118.6-65-30.6-68.8-89.7-68.8-91zM255.9 82.6c'
              '24.5-29.1 22.3-55.6 21.6-65.1-21.7 1.3-46.8 14.8-61.1 31.4-15.7 17.8-24.9 39.8-22.9 64.6 23.4 1.8'
              ' 44.8-10.2 62.4-30.9z"/></svg>')

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

CHECK = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" '
         'stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>')
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

_ANNUAL = APP_FACTS["pricing_usd"]["annual"]
_ANNUAL_SALE = APP_FACTS["pricing_usd"]["annual_sale"]

FACT_TEXT = {
    "rating_count": f'{APP_FACTS["rating"]["count"]:,}',
    "annual_price": f"${_ANNUAL:.2f}",
    "annual_sale_price": f"${_ANNUAL_SALE:.2f}",
    "sale_percent": f"{round((1 - _ANNUAL_SALE / _ANNUAL) * 100):d}",
    "trial_days": APP_FACTS["annual_trial_days"],
    "free_photos_per_day": APP_FACTS["free_limits"]["photos_per_day"],
    "minimum_ios": APP_FACTS["minimum_ios"],
}

# Only {known_fact} is replaced. str.format_map would also try to read every other
# brace pair in the copy, so a single "{" in a translation would abort the build.
FACT_RE = re.compile(r"\{(\w+)\}")
UNKNOWN_FACTS = set()

def _sub_fact(m):
    key = m.group(1)
    if key in FACT_TEXT:
        return str(FACT_TEXT[key])
    UNKNOWN_FACTS.add(key)
    return m.group(0)

def inject_facts(value):
    """Replace app-fact placeholders throughout localized content."""
    if isinstance(value, str):
        return FACT_RE.sub(_sub_fact, value)
    if isinstance(value, list):
        return [inject_facts(item) for item in value]
    if isinstance(value, tuple):
        return tuple(inject_facts(item) for item in value)
    if isinstance(value, dict):
        return {key: inject_facts(item) for key, item in value.items()}
    return value

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
        found = dates.get(path)
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

def date_tag(value, prefix="", english=False):
    """Rendered date that still exposes the ISO one to crawlers.

    Localized pages keep the ISO text — it reads the same in all twelve locales;
    the English-only legal pages spell the month out."""
    text = english_date(value) if english else value
    return f'<time datetime="{value}">{esc(f"{prefix} {text}".strip())}</time>'

def content_lang(c, route_lang):
    """Language of the rendered copy, which may differ from its placeholder URL."""
    code = c.get("lang", route_lang)
    return code if code in BY_CODE else route_lang

def page_path(path=""):
    """Logical path -> the file that is actually served (extension included)."""
    if not path:
        return ""
    if path == "guides":
        return "guides/"
    return path + ".html"

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
            f'<link rel="alternate" hreflang="{BY_CODE[l][4]}" href="{url(l, path)}">' for l in BY_CODE
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
"""

def appstore_btn(c, dark=False, cls=""):
    return (f'<a class="appstore{" dark" if dark else ""} {cls}" href="{APPSTORE}" target="_blank" '
            f'rel="noopener" data-cta="appstore">{APPLE_LOGO}'
            f'<span class="txt"><span>{esc(c["ui"]["download_on"])}</span>'
            f'<strong>{esc(c["ui"]["app_store"])}</strong></span></a>')

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
        for code in BY_CODE
    )
    return f"""<div class="lang">
      <button class="lang-btn" type="button" aria-expanded="false" aria-controls="language-links"
              aria-label="{esc(c['ui']['language'])}">{flag(lang, 18, eager=True)}<span>{esc(BY_CODE[lang][3])}</span></button>
      <div class="lang-menu" id="language-links">{items}</div>
    </div>"""

def nav(c, lang, home_prefix, path=""):
    n = c["nav"]
    return f"""<header class="nav">
  <div class="wrap nav-in">
    <a class="brand" href="{home_prefix}">
      <img src="/resources/appstore/icon_180.png" width="34" height="34" alt="{esc(c['ui']['icon_alt'])}">
      <span>UScale<small>{esc(c['brand_tagline'])}</small></span>
    </a>
    <button class="burger" type="button" aria-expanded="false" aria-label="{esc(n['menu'])}">{BURGER}</button>
    <nav class="nav-links" aria-label="{esc(n['menu'])}">
      <a href="{home_prefix}#examples">{esc(n['screens'])}</a>
      <a href="{home_prefix}guides/">{esc(n['guides'])}</a>
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
          <li><a href="/sale.html">{esc(f['sale'])}</a></li>
        </ul>
      </div>
      <div>
        <h4>{esc(c['nav']['guides'])}</h4>
        <ul>{guide_links}<li><a href="{home_prefix}guides/">{esc(f['all_guides'])}</a></li></ul>
      </div>
      <div>
        <h4>{esc(f['support'])}</h4>
        <ul>
          <li><a href="/support_page.html">{esc(f['help'])}</a></li>
          <li><a href="mailto:alexandr.graschenkov91@gmail.com">{esc(f['contact'])}</a></li>
          <li><a href="/privacy_policy.html">{esc(f['privacy'])}</a></li>
          <li><a href="/terms.html">{esc(f['terms'])}</a></li>
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

# Landing page
def render_home(c, lang):
    seg = BY_CODE[lang][1]
    home_prefix = f"/{seg}/" if seg else "/"
    canonical = url(lang)
    h, m = c["hero"], c["meta"]

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
    out.append(nav(c, lang, home_prefix))

    # Hero
    chips = "".join(f"<li>{esc(x)}</li>" for x in h["chips"])

    out.append(f"""<main>
<section class="hero hero-lead">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <div class="pill">{STARS_PART}
        <span><b>{RATING_TEXT}</b> \u00b7 {esc(h['rating_note'])}</span></div>
      <h1>{h['h1']}</h1>
      <p class="hero-sub">{esc(h['sub'])}</p>
      <div class="hero-cta stores">{store_badge(appstore_btn(c), h['note'])}</div>
      <ul class="chips">{chips}</ul>
    </div>
    {hero_phone(c, h)}
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
      <b>{RATING_TEXT}</b>
      {STARS_PART}
      <span class="score-l">{esc(rv['score_note'])}</span>
    </div>
    <div class="revs">{cards}</div>
    <p class="revs-note">{esc(rv['sub'])}</p>
  </div>
</section>""")

    # Examples
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
        badge = (f'<span class="on-device">'
                 f'<span class="od-v od-local">{LOCK_SVG}<span>{esc(sw["on_device"])}</span></span>'
                 f'<span class="od-v od-cloud">{CLOUD_SVG}<span>{esc(sw["in_cloud"])}</span></span></span>')
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
         style="max-width:290px;margin:0 auto;border-radius:28px;border:1px solid var(--line-2)">
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
            + f"""<main class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb">
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

    body = f"""<main class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="{home_prefix}">{esc(c['ui']['home'])}</a><span>›</span>
    <a href="{home_prefix}guides/">{esc(c['nav']['guides'])}</a><span>›</span>
    <span>{esc(g['card_title'])}</span>
  </nav>
  <article class="art">
    <span class="eyebrow">{esc(g['kicker'])}</span>
    <h1>{esc(g['h1'])}</h1>
    <div class="meta"><span>{date_tag(updated_for(path), c['ui']['updated'])}</span><span>·</span>
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
    for part in parts:
        title = re.sub(r"<[^>]+>", "", re.match(r"<h2>(.*?)</h2>", part, re.S).group(1)).strip()
        sid = re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", title.lower())).strip("-")
        sec = f'<section class="doc-sec" id="{sid}">{part.strip()}</section>'
        if sid.startswith("contact"):
            contact = f'<div class="doc-card is-contact">{sec}</div>'
        else:
            main.append(sec)
        toc.append(f'<li><a href="#{sid}">{esc(title)}</a></li>')
    card = f'<div class="doc-card">{intro}{"".join(main)}</div>' if (intro or main) else ""
    return card + contact, "".join(toc)


def render_doc(c, d):
    """English-only page kept at a historical URL (support / terms / privacy)."""
    d = dict(d)
    d["body"] = inject_facts(d["body"])
    # Pre-rendered markup: doc_body drops it in as-is (see the two call sites below).
    d["updated"] = date_tag(updated_for(d["file"]), "Updated", english=True)
    canonical = f"{SITE}/{d['file']}"
    crumbs_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": c["ui"]["home"], "item": url("en")},
        {"@type": "ListItem", "position": 2, "name": d["h1"], "item": canonical}]}
    extra = ld(crumbs_ld)
    if d["file"] == pages.SUPPORT["file"]:
        extra += ld({"@context": "https://schema.org", "@type": "FAQPage", "url": canonical,
                     "mainEntity": [{"@type": "Question", "name": q,
                                     "acceptedAnswer": {"@type": "Answer", "text": a}}
                                    for q, a in inject_facts(SUPPORT_FAQ_LD)]})
    return (head(c, "en", d["title"], d["description"], canonical, alternates=False, extra_ld=extra)
            + nav(c, "en", "/")
            + f"""<main class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/">{esc(c['ui']['home'])}</a><span>&rsaquo;</span><span>{esc(d['h1'])}</span>
  </nav>
  {doc_body(c, d)}
</main>"""
            + footer(c, "en", "/"))


SUPPORT_FAQ_LD = [
    ("What does UScale actually do?",
     "UScale runs AI enhancement models on your iPhone or iPad: it unblurs and sharpens photos, upscales them "
     "2x or 4x, restores faces in old scans, colorises black-and-white pictures, improves video quality and "
     "generates smooth slow motion. The core processing happens on the device."),
    ("How do I enhance a photo in UScale?",
     "Open the app, tap the photo you want to fix, pick a tool (Enhance, Upscale, Face restore or Colorize), "
     "wait for the preview and save the result to your library."),
    ("Are my photos uploaded anywhere?",
     "No. Photo and video enhancement runs locally on your device, so your library never leaves your phone "
     "for processing."),
    ("Which devices and iOS versions are supported?",
     "iPhone, iPad and iPod touch running iOS {minimum_ios} or later."),
    ("How much does UScale Premium cost?",
     "The app is free for {free_photos_per_day} photo enhancements a day. Premium is {annual_price} a year "
     "and starts with a {trial_days}-day free "
     "trial with everything unlocked. Prices vary slightly by region."),
    ("I paid but Premium is not active. What do I do?",
     "Use Restore purchases in the app settings while signed in with the Apple ID that made the purchase, or "
     "email support with your App Store receipt."),
    ("How do I cancel a UScale subscription?",
     "Subscriptions are handled by Apple: open Settings, tap your name, choose Subscriptions, select UScale "
     "and cancel it there."),
]


def render_sale(c):
    canonical = f"{SITE}/sale.html"
    off = f'{FACT_TEXT["sale_percent"]}%'
    return (head(c, "en", f"UScale Premium Sale — {off} off",
                 f"Unlock UScale Premium with {off} off. Open the app from this link and the discount is "
                 "active for one hour on your device.",
                 canonical, alternates=False,
                 og_image=f"{SITE}{SCREENSHOTS[3]}",
                 robots="noindex,follow")
            + nav(c, "en", "/")
            + f"""<main>
<section class="hero">
  <div class="wrap">
    <div class="hero-grid">
      <div>
        <span class="pill"><b>Limited unlock</b> · {off} OFF</span>
        <h1>Claim your <em>{off} off</em> Premium upgrade</h1>
        <p class="hero-sub">Open the app from this link and a discounted Premium window opens for one hour.</p>
        <div class="promo" id="promo-code-card">
          <span class="promo-l">Promo code</span>
          <span class="promo-v" id="promo-code-value"></span>
        </div>
        <div class="hero-cta sale-cta">
          <a class="btn btn-p btn-xl" id="open-app-link" href="https://upscales.app/sale.html">Open in app<span class="arrow" aria-hidden="true">→</span></a>
        </div>
        <p class="hero-note">Already installed? iOS opens UScale straight from this link.
          No app yet? Install it and reopen the same link.</p>
      </div>
      <div class="sale-art">
        <span class="sale-badge">Best value</span>
        <img src="{SCREENSHOTS[3]}" width="298" height="645" alt="UScale Premium in the app"
             fetchpriority="high" decoding="async">
      </div>
    </div>
  </div>
</section>

{download_cta(c, sect_cls="sect sect-tight",
              h2="App not opening yet?",
              p="Install UScale from the App Store, then open this same sale link again — "
                "the promo code stays attached.")}
</main>
<script>
(function () {{
  var params = new URLSearchParams(window.location.search);
  var raw = params.get('code') || '';
  var code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
                .replace(/(.{{4}})/g, '$1-').replace(/-$/, '');

  var saleURL = new URL('https://upscales.app/sale.html');
  if (code) {{
    saleURL.searchParams.set('code', code);
    document.getElementById('promo-code-value').textContent = code;
    document.getElementById('promo-code-card').classList.add('visible');
  }}
  document.getElementById('open-app-link').href = saleURL.toString();
}})();
</script>"""
            + footer(c, "en", "/"))


# Sitemap
def render_sitemap():
    entries = []
    paths = ["", "guides"] + [f"guides/{s}" for s in GUIDE_SLUGS]
    for p in paths:
        for code in BY_CODE:
            alts = "".join(
                f'\n    <xhtml:link rel="alternate" hreflang="{BY_CODE[o][4]}" href="{url(o, p)}"/>'
                for o in BY_CODE)
            alts += f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{url("en", p)}"/>'
            prio = "1.0" if p == "" and code == "en" else ("0.9" if p == "" else "0.8")
            entries.append(
                f'  <url>\n    <loc>{url(code, p)}</loc>\n    <lastmod>{updated_for(p)}</lastmod>'
                f'\n    <changefreq>weekly</changefreq>\n    <priority>{prio}</priority>{alts}\n  </url>')
    # sale.html is noindex and intentionally omitted.
    for legal in ["support_page.html", "terms.html", "privacy_policy.html"]:
        entries.append(f'  <url>\n    <loc>{SITE}/{legal}</loc>\n    <lastmod>{updated_for(legal)}</lastmod>'
                       f'\n    <changefreq>yearly</changefreq>\n    <priority>0.3</priority>\n  </url>')
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
    langs = sys.argv[1:] or list(BY_CODE)
    unknown = [l for l in langs if l not in BY_CODE]
    if unknown:
        sys.exit(f"unknown locale(s) {unknown}; known: {list(BY_CODE)}")
    # Only a full build removes stale generated files.
    full = set(langs) == set(BY_CODE)
    if full and os.path.isdir(DIST):
        shutil.rmtree(DIST)
    built = 0
    fallback_path = os.path.join(CONTENT, "en.json")
    for code in langs:
        path = os.path.join(CONTENT, f"{code}.json")
        if not os.path.exists(path):
            path = fallback_path
        with open(path, encoding="utf-8") as f:
            c = inject_facts(json.load(f))
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
        fallback = " (English fallback)" if content_lang(c, code) != code else ""
        print(f"  ✓ {code}{fallback}")
    if "en" in langs:
        with open(os.path.join(CONTENT, "en.json"), encoding="utf-8") as f:
            en = inject_facts(json.load(f))
        for d in pages.DOCS:
            write(d["file"], render_doc(en, d)); built += 1
        write("sale.html", render_sale(en)); built += 1
        print("  ✓ support / terms / privacy / sale")
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
