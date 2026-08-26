#!/usr/bin/env python3
"""Vendor Apple's official "Download on the App Store" badge artwork.

Apple's marketing guidelines require the supplied artwork be used as-is —
recreating or restyling the badge is not allowed, and the wording of the
translated modifier is Apple's to decide, not ours. So the badges are
downloaded once and committed, rather than fetched during a build: the site
must build with no network.

Run after adding a locale to build.LOCALES:

    python3 build/fetch_badges.py
"""
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "resources", "appstore", "badges")
API = "https://toolbox.marketingtools.apple.com/api/v2/badges/download-on-the-app-store/{colour}/{tag}"

# Site locale -> the tag Apple files the artwork under. A locale missing from
# this map, or one Apple has no badge for, falls back to the English badge —
# which is what the App Store itself shows in that situation.
APPLE_TAGS = {
    "en": "en-us", "es": "es-es", "pt": "pt-br", "fr": "fr-fr",
    "de": "de-de", "it": "it-it", "ja": "ja-jp", "ko": "ko-kr",
    "zh": "zh-cn", "ru": "ru-ru", "tr": "tr-tr",
    # Apple publishes no Hindi badge (the API 404s), so /hi/ uses the English one.
    "hi": None,
}
COLOURS = ("black", "white")


def fetch(tag, colour):
    """The artwork bytes, or None when Apple has no badge for this tag."""
    try:
        with urllib.request.urlopen(API.format(colour=colour, tag=tag), timeout=30) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


# Kept for reference: an earlier revision stripped Apple's 1px rim out of the
# artwork so a larger CSS corner radius could be applied without the rim being
# clipped away at the corners. We went back to shipping the badge exactly as
# Apple delivers it, rim included, so none of this runs — see .appstore in
# assets/site.css, where the matching CSS rim is commented out too.
#
# BODY_FILL = {"black": "#000", "white": "#fff"}
#
#
# def strip_border(payload, colour):
#     """Drop the badge's 1px border.
#
#     Apple draws the pill as two stacked shapes: a full-bleed rounded rect, and
#     the body inset by 0.875 units on top of it. The rim of the first showing
#     around the second is the border - grey on the black badge, black on the
#     white one. Recolouring the outer shape to the body fill and dropping the
#     inner one leaves the same pill without the rim, and keeps the artwork
#     full-bleed so a CSS corner radius still lands on a real edge.
#
#     This is a deliberate departure from Apple's "don't modify the badge" rule.
#     """
#     text = payload.decode("utf-8")
#     paths = list(re.finditer(r"<path\b[^>]*/>", text))
#     if len(paths) < 2:
#         raise SystemExit("badge artwork changed shape; re-check strip_border()")
#     outer, inner = paths[0], paths[1]
#     body = re.sub(r'\s*style="[^"]*"', "", outer.group(0))
#     body = body.replace("/>", f' style="fill: {BODY_FILL[colour]}"/>')
#     # Right-to-left, so the first replacement does not shift the second's span.
#     text = text[:inner.start()] + text[inner.end():]
#     text = text[:outer.start()] + body + text[outer.end():]
#     return text.encode("utf-8")


def main():
    sys.path.insert(0, os.path.join(ROOT, "build"))
    import build as site_build

    os.makedirs(DEST, exist_ok=True)
    written = 0
    for code, _seg, name, *_ in site_build.LOCALES:
        tag = APPLE_TAGS.get(code)
        for colour in COLOURS:
            payload = fetch(tag, colour) if tag else None
            source = tag
            if payload is None:
                payload = fetch(APPLE_TAGS["en"], colour)
                source = f'{APPLE_TAGS["en"]} (no {code} badge)'
            # payload = strip_border(payload, colour)
            path = os.path.join(DEST, f"{code}-{colour}.svg")
            with open(path, "wb") as handle:
                handle.write(payload)
            written += 1
            if colour == "black":
                box = re.search(rb'viewBox="0 0 ([\d.]+) 40"', payload)
                width = box.group(1).decode() if box else "?"
                print(f"  ✓ {code} ({name}) <- {source}, {width}×40")
    print(f"Wrote {written} badge files into resources/appstore/badges/")


if __name__ == "__main__":
    main()
