#!/usr/bin/env python3
"""Vendor Google's official localized badges so site builds need no network.

Run after adding a translated locale: python3 build/fetch_googleplay_badges.py
Source: https://play.google.com/intl/en_us/badges/
Artwork is saved unmodified, including Google's transparent clear space.
"""
from pathlib import Path
import urllib.request

import build as site_build

DEST = Path(site_build.ROOT) / "resources" / "googleplay" / "badges"
SOURCE = "https://play.google.com/intl/en_us/badges/static/images/badges/{}_badge_web_generic.png"


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for code in site_build.LOCALIZED_CODES:
        with urllib.request.urlopen(SOURCE.format(code), timeout=30) as response:
            payload = response.read()
        if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
            raise SystemExit(f"{code}: expected PNG badge artwork")
        (DEST / f"{code}.png").write_bytes(payload)
        print(f"  ✓ {code}")


if __name__ == "__main__":
    main()
