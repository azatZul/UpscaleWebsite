#!/usr/bin/env python3
"""Curate diverse licensed photographs, retaining full originals and paired references.

All media stay in the ignored loopback lab. No user photo is sent anywhere.
"""
import argparse
import hashlib
import html
import io
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageCms, ImageFilter, ImageOps


PHOTOS = [
    ("portrait-hair", "Blonde Woman.jpg", "Портрет: кожа и светлые волосы"),
    ("portrait-cloth", "Portrait of a young woman wearing a gray balaclava.jpg", "Портрет: глаза и фактура ткани"),
    ("portrait-beard", "Sikh man, Agra 10.jpg", "Портрет: борода, морщины и ткань"),
    ("cat", "Cat in Efremov, Russia1.jpg", "Животное: шерсть и усы"),
    ("bird", "Alcedo Atthis.jpg", "Птица: мелкие перья и ветка"),
    ("market", "Kothapet Fruit Market.jpg", "Рынок: человек, плоды и мелкие предметы"),
    ("forest", "Forest stream in the National Park Galičica.jpg", "Лес: листва, камни и вода"),
    ("landscape", "Pragser wildsee.JPG", "Пейзаж: горы, вода и деревья"),
    ("night-signs", "Yasukuni-dori Avenue at night with vehicles and colorful neon street signs, Shinjuku, Tokyo, Japan.jpg", "Ночь: вывески, текст и автомобили"),
    ("night-stone", "Münster, Dominikanerkirche -- 2023 -- 9194.jpg", "Ночь: камень, надписи и тени"),
    ("phone-cafe", "Coffee, breakfast, croissant.jpg", "Смартфон в помещении: еда и посуда"),
    ("architecture", "Taj Mahal, Agra, India edit2.jpg", "Архитектура: симметрия и тонкие контуры"),
]
USER_AGENT = "UScale-Model-Evaluation/1.0 (https://upscales.app/)"


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(value):
    return html.unescape(re.sub("<[^>]+>", "", value)).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=Path, default=Path(".web-model-work/photo4x"))
    parser.add_argument("--metadata-only", action="store_true")
    args = parser.parse_args()
    root = args.work / "web-corpus"
    root.mkdir(parents=True, exist_ok=True)
    query = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "imageinfo",
        "iiprop": "url|size|sha1|extmetadata", "titles": "|".join("File:" + name for _, name, _ in PHOTOS)})
    metadata = fetch("https://commons.wikimedia.org/w/api.php?" + query)
    (root / "commons-metadata.json").write_bytes(metadata)
    pages = json.loads(metadata)["query"]["pages"].values()
    by_title = {page["title"].replace("_", " "): page for page in pages}
    report = {"createdAt": datetime.now(timezone.utc).isoformat(), "images": [], "cases": [], "errors": [],
              "protocol": {"referenceLongSideMax": 2048, "scale": 4, "referenceResize": "Lanczos, dimensions divisible by 4",
                           "clean": "Bicubic downscale by 4; lossless PNG; no artificial noise or scratches",
                           "mild": "Same downscale, Gaussian blur sigma 0.45 LR pixels, JPEG quality85 4:2:0; decoded to PNG",
                           "scope": "Controlled degradation, not a full simulation of real camera blur. User photos remain separate without ground truth."}}
    for photo_id, title, label in PHOTOS:
        page = by_title.get("File:" + title)
        if not page or not page.get("imageinfo"):
            report["errors"].append({"id": photo_id, "error": "Source file missing", "title": title})
            continue
        info = page["imageinfo"][0]
        ext = info["extmetadata"]
        field = lambda key: plain(ext.get(key, {}).get("value", ""))
        license_name = field("LicenseShortName")
        license_url = field("LicenseUrl")
        if not ((license_name.startswith("CC BY") and "-NC" not in license_name) or license_name in ["CC0", "Public domain"]):
            report["errors"].append({"id": photo_id, "error": "Review source license", "license": license_name})
            continue
        entry = {"id": photo_id, "title": title, "label": label, "sourcePage": info["descriptionurl"],
                 "url": info["url"], "sourceSha1": info["sha1"], "sourceDimensions": [info["width"], info["height"]],
                 "author": field("Artist"), "credit": field("Attribution") or field("Credit"),
                 "license": license_name, "licenseUrl": license_url}
        report["images"].append(entry)
        print(f"{photo_id}: {license_name}, {entry['sourceDimensions']}, {entry['author']}", flush=True)
        if args.metadata_only:
            continue
        source = root / f"{photo_id}-original.jpg"
        if not source.exists():
            source.write_bytes(fetch(info["url"]))
        if hashlib.sha1(source.read_bytes()).hexdigest() != info["sha1"]:
            raise ValueError(f"Source hash changed for {title}")
        entry["sha256"] = sha(source)
        with Image.open(source) as original:
            oriented = ImageOps.exif_transpose(original)
            icc = original.info.get("icc_profile")
            if icc:
                image = ImageCms.profileToProfile(oriented, ImageCms.ImageCmsProfile(io.BytesIO(icc)), ImageCms.createProfile("sRGB"), outputMode="RGB")
                entry["colorConversion"] = "Embedded ICC to sRGB via Pillow ImageCms"
            else:
                image = oriented.convert("RGB")
                entry["colorConversion"] = "RGB; no embedded ICC profile"
        ratio = min(1, 2048 / max(image.size))
        size = tuple(max(4, round(value * ratio / 4) * 4) for value in image.size)
        reference = image.resize(size, Image.Resampling.LANCZOS)
        # Explicitly omit source ICC/Exif after RGB normalization.
        reference.info.clear()
        target = root / f"{photo_id}-reference.png"
        reference.save(target)
        entry["reference"] = {"file": target.name, "sha256": sha(target), "size": size}
        low = reference.resize((size[0] // 4, size[1] // 4), Image.Resampling.BICUBIC)
        tracks = ["clean", "mild"] if photo_id in ["portrait-hair", "bird", "night-signs", "phone-cafe"] else ["clean"]
        for track in tracks:
            pixels = low
            if track == "mild":
                buffer = io.BytesIO()
                pixels.filter(ImageFilter.GaussianBlur(.45)).save(buffer, format="JPEG", quality=85, subsampling=2)
                pixels = Image.open(io.BytesIO(buffer.getvalue())).convert("RGB")
            name = f"web-{photo_id}-{track}.png"
            output = args.work / "inputs" / name
            pixels.save(output)
            report["cases"].append({"id": f"{photo_id}-{track}", "photo": photo_id, "track": track,
                                    "input": name, "sha256": sha(output), "size": pixels.size, "reference": target.name})
    (root / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if report["errors"]:
        print(json.dumps(report["errors"], ensure_ascii=False, indent=2))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
