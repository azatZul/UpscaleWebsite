#!/usr/bin/env python3
"""Prepare and publish private-link before/after albums."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import secrets
import shutil
import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlsplit

import requests
from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps


CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ALBUM_ID_LENGTH = 26
MAX_PHOTOS = 20
MAX_IMAGE_BYTES = 100 * 1024 * 1024
MAX_IMAGE_PIXELS = 100_000_000
MAX_ZIP_BYTES = 500 * 1024 * 1024
PREVIEW_EDGE = 1600
GALLERY_HALF_SIZE = (480, 720)
GALLERY_SIZE = (960, 720)
GALLERY_QUALITY = 70
GALLERY_VERSION = "v2"
LEGACY_GALLERY_SIZE = (1280, 960)
LEGACY_GALLERY_VERSION = "v1"
PROCESSING_PROFILE_VERSION = "1"
ALLOWED_FLOWS = {"photo-restoration", "creative-upscale", "restore-and-upscale"}
ALLOWED_FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp")}
PREFERRED_RESOLUTIONS = (
    (672, 1568), (688, 1504), (720, 1456), (752, 1392), (800, 1328),
    (832, 1248), (880, 1184), (944, 1104), (1024, 1024), (1104, 944),
    (1184, 880), (1248, 832), (1328, 800), (1392, 752), (1456, 720),
    (1504, 688), (1568, 672),
)
STATE_SCHEMA_VERSION = 4
STATE_NAME = ".album-state.json"
WORK_NAME = ".album-work"


class AlbumError(RuntimeError):
    pass


@dataclass(frozen=True)
class ImageInfo:
    path: Path
    image_format: str
    extension: str
    content_type: str
    width: int
    height: int
    size: int
    sha256: str


def crockford_id() -> str:
    value = secrets.randbits(130)
    chars = []
    for _ in range(ALBUM_ID_LENGTH):
        value, index = divmod(value, 32)
        chars.append(CROCKFORD[index])
    return "".join(reversed(chars))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_json(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_album_id(album_id: str) -> str:
    if len(album_id) != ALBUM_ID_LENGTH or any(char not in CROCKFORD for char in album_id):
        raise AlbumError("Invalid album ID")
    return album_id


def validate_album_title(title: Any) -> str:
    # Keep in sync with the albums.title CHECK constraint.
    if not isinstance(title, str) or not (1 <= len(title.strip()) <= 160):
        raise AlbumError("title must contain 1–160 characters")
    return title.strip()


def resolve_file(folder: Path, raw: str) -> Path:
    candidate = (folder / raw).resolve()
    root = folder.resolve()
    if candidate != root and root not in candidate.parents:
        raise AlbumError(f"Path leaves the album folder: {raw}")
    if not candidate.is_file():
        raise AlbumError(f"File not found: {raw}")
    return candidate


def inspect_image(path: Path) -> ImageInfo:
    size = path.stat().st_size
    if size <= 0 or size > MAX_IMAGE_BYTES:
        raise AlbumError(f"Image size is outside the allowed range: {path}")
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image_format = (image.format or "").upper()
            width, height = image.size
    except Exception as error:
        raise AlbumError(f"Invalid image: {path}") from error
    if image_format not in ALLOWED_FORMATS:
        raise AlbumError(f"Only JPEG, PNG and WebP are supported: {path}")
    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        raise AlbumError(f"Image exceeds the pixel limit: {path}")
    extension, content_type = ALLOWED_FORMATS[image_format]
    return ImageInfo(path, image_format, extension, content_type, width, height, size, sha256_file(path))


def load_manifest(folder: Path) -> Dict[str, Any]:
    path = folder / "album.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise AlbumError(f"Missing {path}") from error
    except (OSError, json.JSONDecodeError) as error:
        raise AlbumError(f"Cannot read {path}: {error}") from error
    if not isinstance(value, dict):
        raise AlbumError("album.json must contain an object")
    return value


def validate_manifest(folder: Path, manifest: Dict[str, Any]) -> List[Dict[str, Any]]:
    title = manifest.get("title")
    if not isinstance(title, str) or not (1 <= len(title.strip()) <= 160):
        raise AlbumError("title must contain 1–160 characters")
    note = manifest.get("note")
    if note is not None and (not isinstance(note, str) or len(note) > 2000):
        raise AlbumError("note must be null or contain at most 2000 characters")
    if manifest.get("rights_confirmed") is not True:
        raise AlbumError("rights_confirmed must be true")
    featured = manifest.get("featured", False)
    if not isinstance(featured, bool):
        raise AlbumError("featured must be true or false")
    photos = manifest.get("photos")
    if not isinstance(photos, list) or not (1 <= len(photos) <= MAX_PHOTOS):
        raise AlbumError(f"photos must contain 1–{MAX_PHOTOS} items")

    validated = []
    for index, raw in enumerate(photos, start=1):
        if not isinstance(raw, dict):
            raise AlbumError(f"photos[{index}] must be an object")
        before_name = raw.get("before")
        if not isinstance(before_name, str) or not before_name:
            raise AlbumError(f"photos[{index}].before is required")
        before = inspect_image(resolve_file(folder, before_name))
        after_name = raw.get("after")
        flow = raw.get("flow")
        if bool(after_name) == bool(flow):
            raise AlbumError(f"photos[{index}] must define exactly one of after or flow")
        after = None
        if after_name:
            if not isinstance(after_name, str):
                raise AlbumError(f"photos[{index}].after must be a path")
            after = inspect_image(resolve_file(folder, after_name))
        if flow and flow not in ALLOWED_FLOWS:
            raise AlbumError(f"photos[{index}].flow must be one of {sorted(ALLOWED_FLOWS)}")
        alt = raw.get("alt")
        if not isinstance(alt, str) or not (1 <= len(alt.strip()) <= 300):
            raise AlbumError(f"photos[{index}].alt must contain 1–300 characters")
        params = raw.get("params", {})
        if not isinstance(params, dict):
            raise AlbumError(f"photos[{index}].params must be an object")
        crop_mode = params.get("crop_mode", "none")
        if crop_mode not in {"none", "aspect-fill"}:
            raise AlbumError(f"photos[{index}].params.crop_mode must be none or aspect-fill")
        target_resolution = params.get("target_resolution", "4k")
        if target_resolution not in {"2k", "4k"}:
            raise AlbumError(f"photos[{index}].params.target_resolution must be 2k or 4k")
        creativity = params.get("creativity", 0)
        if isinstance(creativity, bool) or not isinstance(creativity, (int, float)) or not 0 <= creativity <= 10:
            raise AlbumError(f"photos[{index}].params.creativity must be a number from 0 to 10")
        additional_prompt = params.get("additional_prompt", "")
        if not isinstance(additional_prompt, str) or len(additional_prompt) > 1000:
            raise AlbumError(f"photos[{index}].params.additional_prompt must contain at most 1000 characters")
        validated.append({"before": before, "after": after, "flow": flow, "params": params, "alt": alt.strip()})
    return validated


def atomic_json(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def initialize_state(folder: Path, photos: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    state_path = folder / STATE_NAME
    if state_path.is_file():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise AlbumError(f"Invalid {state_path}: {error}") from error
        if not isinstance(state, dict) or not isinstance(state.get("album_id"), str):
            raise AlbumError(f"Invalid {state_path}")
    else:
        state = {
            "schema_version": STATE_SCHEMA_VERSION,
            "album_id": crockford_id(),
            "created_at": int(time.time()),
            "photos": [],
        }
    existing = state.get("photos")
    if not isinstance(existing, list):
        raise AlbumError("Invalid photos in state file")
    if existing and len(existing) != len(photos):
        raise AlbumError("album.json photo count changed after state was created; start in a new folder")
    if not existing:
        for photo in photos:
            before = photo["before"]
            photo_id = crockford_id()
            flow = photo["flow"]
            params_sha256 = sha256_json(photo["params"])
            state["photos"].append({
                "id": photo_id,
                "before_sha256": before.sha256,
                "after_sha256": photo["after"].sha256 if photo["after"] else None,
                "flow": flow,
                "params_sha256": params_sha256,
                "idempotency_key": (
                    f"{state['album_id']}:{photo_id}:{before.sha256}:{params_sha256}:{flow}:{PROCESSING_PROFILE_VERSION}"
                    if flow else None
                ),
                "job_id": None,
                "processed_path": None,
                "media": {},
            })
        atomic_json(state_path, state)
    for index, photo in enumerate(photos):
        photo_state = state["photos"][index]
        if photo_state.get("before_sha256") != photo["before"].sha256:
            raise AlbumError(f"photos[{index + 1}] source changed after state was created")
        if photo_state.get("flow") != photo["flow"]:
            raise AlbumError(f"photos[{index + 1}] flow changed after state was created")
        after_hash = photo["after"].sha256 if photo["after"] else None
        if photo_state.get("after_sha256") != after_hash:
            raise AlbumError(f"photos[{index + 1}] after changed after state was created")
        if photo_state.get("params_sha256") != sha256_json(photo["params"]):
            raise AlbumError(f"photos[{index + 1}] params changed after state was created; start in a new folder")
    return state


def save_state(folder: Path, state: Dict[str, Any]) -> None:
    atomic_json(folder / STATE_NAME, state)


def pick_resolution(size: Tuple[int, int]) -> Tuple[int, int]:
    aspect = size[0] / size[1]
    return min(PREFERRED_RESOLUTIONS, key=lambda item: abs(item[0] / item[1] - aspect))


def aspect_fill(image: Image.Image) -> Image.Image:
    target_width, target_height = pick_resolution(image.size)
    scale = max(target_width / image.width, target_height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - target_width) // 2)
    top = max(0, (resized.height - target_height) // 2)
    return resized.crop((left, top, left + target_width, top + target_height))


def open_normalized(path: Path) -> Image.Image:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        image.load()
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "transparency" in source.info else "RGB")
        return image.copy()


def save_image(image: Image.Image, path: Path, image_format: str, quality: Optional[int] = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    options: Dict[str, Any] = {}
    if image_format == "JPEG":
        if image.mode != "RGB":
            background = Image.new("RGB", image.size, "white")
            if image.mode == "RGBA":
                background.paste(image, mask=image.getchannel("A"))
            else:
                background.paste(image.convert("RGB"))
            image = background
        options = {"quality": quality if quality is not None else 95, "optimize": True, "progressive": True}
    elif image_format == "PNG":
        options = {"optimize": True}
    elif image_format == "WEBP":
        options = {"quality": quality if quality is not None else 95, "method": 6}
    image.save(path, format=image_format, **options)


def resized_preview(image: Image.Image) -> Image.Image:
    result = image.copy()
    result.thumbnail((PREVIEW_EDGE, PREVIEW_EDGE), Image.Resampling.LANCZOS)
    return result


def watermark_font(size: int) -> ImageFont.ImageFont:
    candidates = (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    )
    for candidate in candidates:
        if Path(candidate).is_file():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def configured_watermark_logo() -> Optional[Path]:
    raw = os.getenv("ALBUM_WATERMARK_PATH") or os.getenv("REDDIT_WATERMARK_PATH")
    if not raw:
        return None
    path = Path(raw).expanduser()
    if not path.is_file():
        raise AlbumError(f"Watermark logo not found: {path}")
    return path


def add_watermark(
    image: Image.Image,
    text: str = "upscales.app",
    logo_path: Optional[Path] = None,
) -> Image.Image:
    """Add a restrained anti-copy pattern and an optional app badge."""
    base = image.convert("RGBA")
    font_size = max(14, min(46, round(min(base.size) / 28)))
    font = watermark_font(font_size)
    probe = ImageDraw.Draw(base)
    stroke_width = max(1, font_size // 24)
    box = probe.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    text_width = max(1, box[2] - box[0])
    text_height = max(1, box[3] - box[1])
    tile = Image.new("RGBA", (text_width + font_size, text_height + font_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    draw.text(
        (font_size // 2, font_size // 3), text, font=font,
        fill=(255, 255, 255, 38), stroke_width=stroke_width,
        stroke_fill=(0, 0, 0, 28),
    )
    rotated = tile.rotate(24, expand=True, resample=Image.Resampling.BICUBIC)
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gap_x = max(rotated.width + font_size * 4, base.width // 2)
    gap_y = max(rotated.height + font_size * 3, base.height // 3)
    for y in range(-rotated.height, base.height + rotated.height, gap_y):
        offset = 0 if (y // gap_y) % 2 == 0 else gap_x // 2
        for x in range(-rotated.width - offset, base.width + rotated.width, gap_x):
            overlay.alpha_composite(rotated, (x + offset, y))
    result = Image.alpha_composite(base, overlay)
    if logo_path:
        with Image.open(logo_path) as source:
            logo = source.convert("RGBA")
        target_width = max(1, round(base.width * 0.15))
        target_height = max(1, round(logo.height * target_width / logo.width))
        logo = logo.resize((target_width, target_height), Image.Resampling.LANCZOS)
        alpha = logo.getchannel("A").point(lambda value: round(value * 0.78))
        logo.putalpha(alpha)
        margin = max(12, round(min(base.size) * 0.025))
        result.alpha_composite(logo, (base.width - logo.width - margin, base.height - logo.height - margin))
    return result.convert("RGB")


def make_cover(after_preview: Path, destination: Path) -> None:
    image = open_normalized(after_preview).convert("RGB")
    background = ImageOps.fit(image, (1200, 630), method=Image.Resampling.LANCZOS)
    background = ImageEnhance.Brightness(background).enhance(0.62)
    foreground = ImageOps.contain(image, (1120, 590), method=Image.Resampling.LANCZOS)
    x = (1200 - foreground.width) // 2
    y = (630 - foreground.height) // 2
    background.paste(foreground, (x, y))
    save_image(background, destination, "JPEG")


def make_gallery_preview(media: Dict[str, Any], destination: Path) -> None:
    """Build the gallery card exactly at its rendered before/after aspect ratio."""
    before = ImageOps.fit(
        open_normalized(Path(media["before"]["path"])).convert("RGB"),
        GALLERY_HALF_SIZE,
        method=Image.Resampling.LANCZOS,
    )
    after = ImageOps.fit(
        open_normalized(Path(media["clean"]["path"])).convert("RGB"),
        GALLERY_HALF_SIZE,
        method=Image.Resampling.LANCZOS,
    )
    if Path(media["after"]["key"]).name == "after-wm.webp":
        after = add_watermark(after, logo_path=configured_watermark_logo())
    combined = Image.new("RGB", GALLERY_SIZE)
    combined.paste(before, (0, 0))
    combined.paste(after, (GALLERY_HALF_SIZE[0], 0))
    save_image(combined, destination, "JPEG", quality=GALLERY_QUALITY)


def resize_gallery_preview(source: Path, destination: Path) -> None:
    """Convert a published legacy gallery card to the current delivery profile."""
    image = open_normalized(source).convert("RGB")
    if image.size != LEGACY_GALLERY_SIZE:
        raise AlbumError(
            f"Legacy gallery preview must be {LEGACY_GALLERY_SIZE[0]}x{LEGACY_GALLERY_SIZE[1]}: {source}"
        )
    resized = image.resize(GALLERY_SIZE, Image.Resampling.LANCZOS)
    save_image(resized, destination, "JPEG", quality=GALLERY_QUALITY)


def ensure_gallery_preview(folder: Path, state: Dict[str, Any], media: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    destination = folder / WORK_NAME / f"gallery-{GALLERY_VERSION}.jpg"
    expected_key = f"albums/{state['album_id']}/gallery-{GALLERY_VERSION}.jpg"
    existing = state.get("gallery")
    if existing:
        verify_record(existing)
        if (existing.get("key") == expected_key and existing.get("content_type") == "image/jpeg"
                and (existing.get("width"), existing.get("height")) == GALLERY_SIZE):
            return existing
        legacy_key = f"albums/{state['album_id']}/gallery-{LEGACY_GALLERY_VERSION}.jpg"
        if (existing.get("key") != legacy_key or existing.get("content_type") != "image/jpeg"
                or (existing.get("width"), existing.get("height")) != LEGACY_GALLERY_SIZE):
            raise AlbumError("Prepared gallery preview does not match the current profile; start in a new folder")
    first_id = state["photos"][0]["id"]
    make_gallery_preview(media[first_id], destination)
    record = file_record(inspect_image(destination), expected_key)
    state["gallery"] = record
    save_state(folder, state)
    return record


class AuraLensClient:
    def __init__(self) -> None:
        self.base_url = required_env("AURALENS_BASE_URL").rstrip("/")
        self.api_key = required_env("UPSCALER_TOOL_API_KEY")
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {self.api_key}"})
        self.timeout = float(os.getenv("AURALENS_TIMEOUT_SECONDS", "330"))
        self.poll_timeout = float(os.getenv("AURALENS_POLL_TIMEOUT_SECONDS", "900"))

    def process(self, source: Path, flow: str, params: Dict[str, Any], idempotency_key: str, destination: Path) -> str:
        with source.open("rb") as handle:
            response = self.session.post(
                f"{self.base_url}/internal/v1/process",
                headers={"Idempotency-Key": idempotency_key},
                files={"image": (source.name, handle, mimetypes.guess_type(source.name)[0] or "application/octet-stream")},
                data={"flow": flow, "params": json.dumps(params, separators=(",", ":"))},
                timeout=self.timeout,
            )
        payload = response_json(response, {200, 201, 202})
        job_id = payload.get("job_id")
        if not isinstance(job_id, str) or not job_id:
            raise AlbumError("AuraLens response has no job_id")
        deadline = time.monotonic() + self.poll_timeout
        status = payload.get("status")
        while status == "processing":
            if time.monotonic() >= deadline:
                raise AlbumError(f"AuraLens job {job_id} is still processing")
            time.sleep(max(1, min(10, int(payload.get("retry_after", 3)))))
            payload = response_json(
                self.session.get(f"{self.base_url}/internal/v1/process/{job_id}", timeout=30),
                {200, 202},
            )
            status = payload.get("status")
        if status != "completed":
            raise AlbumError(f"AuraLens job {job_id} failed: {payload.get('error', status)}")
        with self.session.get(f"{self.base_url}/internal/v1/process/{job_id}/output", stream=True, timeout=self.timeout) as output:
            if output.status_code != 200:
                raise AlbumError(f"AuraLens output failed with HTTP {output.status_code}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            total = 0
            with destination.open("wb") as handle:
                for chunk in output.iter_content(1024 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_IMAGE_BYTES:
                        raise AlbumError("AuraLens output exceeds the image size limit")
                    handle.write(chunk)
        inspect_image(destination)
        return job_id


def response_json(response: requests.Response, allowed: set[int]) -> Dict[str, Any]:
    if response.status_code not in allowed:
        detail = response.text[:500]
        raise AlbumError(f"HTTP {response.status_code}: {detail}")
    try:
        payload = response.json()
    except ValueError as error:
        raise AlbumError("Server returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise AlbumError("Server returned a non-object JSON response")
    return payload


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise AlbumError(f"{name} is not set")
    return value


def prepare_processing_input(source: Path, params: Dict[str, Any], destination: Path) -> Path:
    image = open_normalized(source)
    if params.get("crop_mode", "none") == "aspect-fill":
        image = aspect_fill(image)
    save_image(image, destination, "JPEG")
    return destination


def ensure_after(
    folder: Path,
    photo: Dict[str, Any],
    photo_state: Dict[str, Any],
    state: Dict[str, Any],
    client: Optional[AuraLensClient],
) -> Path:
    after = photo["after"]
    if after is not None:
        return after.path
    work = folder / WORK_NAME / photo_state["id"]
    input_path = work / "processing-input.jpg"
    output_path = work / "processed-output.jpg"
    if photo_state.get("processed_path"):
        existing = resolve_file(folder, photo_state["processed_path"])
        inspect_image(existing)
        return existing
    if client is None:
        client = AuraLensClient()
    prepare_processing_input(photo["before"].path, photo["params"], input_path)
    job_id = client.process(
        input_path,
        photo["flow"],
        photo["params"],
        photo_state["idempotency_key"],
        output_path,
    )
    photo_state["job_id"] = job_id
    photo_state["processed_path"] = str(output_path.relative_to(folder))
    save_state(folder, state)
    return output_path


def prepare_media(
    folder: Path,
    photos: Sequence[Dict[str, Any]],
    state: Dict[str, Any],
    watermarked: bool = True,
) -> Dict[str, Dict[str, Any]]:
    client: Optional[AuraLensClient] = None
    media: Dict[str, Dict[str, Any]] = {}
    clean_total = 0
    for index, photo in enumerate(photos):
        photo_state = state["photos"][index]
        photo_id = photo_state["id"]
        work = folder / WORK_NAME / photo_id
        if photo_state.get("media"):
            prepared = photo_state["media"]
            for name in ("before", "after", "clean"):
                verify_record(prepared[name])
            prepared["alt"] = photo["alt"]
            media[photo_id] = prepared
            clean_total += prepared["clean"]["bytes"]
            continue
        if photo["flow"] and not photo_state.get("processed_path") and client is None:
            client = AuraLensClient()
        after_path = ensure_after(folder, photo, photo_state, state, client)
        after_info = inspect_image(after_path)

        before_source = photo["before"].path
        if photo["flow"] and photo["params"].get("crop_mode", "none") == "aspect-fill":
            before_source = work / "processing-input.jpg"
        before_image = resized_preview(open_normalized(before_source))
        before_path = work / "before.webp"
        save_image(before_image, before_path, "WEBP")

        clean_image = open_normalized(after_path)
        clean_path = work / f"clean.{after_info.extension}"
        save_image(clean_image, clean_path, after_info.image_format)
        clean_info = inspect_image(clean_path)
        clean_total += clean_info.size

        after_preview = resized_preview(clean_image)
        after_name = "after.webp"
        if watermarked:
            after_preview = add_watermark(after_preview, logo_path=configured_watermark_logo())
            after_name = "after-wm.webp"
        after_preview_path = work / after_name
        save_image(after_preview, after_preview_path, "WEBP")
        before_info = inspect_image(before_path)
        preview_info = inspect_image(after_preview_path)
        photo_media = {
            "before": file_record(before_info, f"albums/{state['album_id']}/{photo_id}/before.webp"),
            "after": file_record(preview_info, f"albums/{state['album_id']}/{photo_id}/{after_name}"),
            "clean": file_record(clean_info, f"albums/{state['album_id']}/{photo_id}/clean.{clean_info.extension}"),
            "alt": photo["alt"],
            "position": index,
        }
        photo_state["media"] = photo_media
        media[photo_id] = photo_media
        save_state(folder, state)

    cover_path = folder / WORK_NAME / "cover.jpg"
    first_id = state["photos"][0]["id"]
    cover = state.get("cover")
    if cover:
        verify_record(cover)
    else:
        make_cover(Path(media[first_id]["after"]["path"]), cover_path)
        cover = file_record(inspect_image(cover_path), f"albums/{state['album_id']}/cover.jpg")
    gallery = ensure_gallery_preview(folder, state, media)

    # A prepared archive is reused as-is, like the cover and the gallery preview above, so a
    # resumed run cannot drop a record it is not rebuilding.
    zip_record = state.get("zip")
    if zip_record:
        verify_record(zip_record)
    elif len(state["photos"]) > 1 and clean_total <= MAX_ZIP_BYTES:
        zip_path = folder / WORK_NAME / "all.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for index, photo_state in enumerate(state["photos"], start=1):
                clean = photo_state["media"]["clean"]
                # ZipFile.write uses the source mtime, making retry bytes differ.
                entry = zipfile.ZipInfo(f"{index:02d}-uscale.{clean['extension']}", (1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o600 << 16
                with Path(clean["path"]).open("rb") as source, archive.open(entry, "w") as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
        zip_record = {
            "path": str(zip_path),
            "key": f"albums/{state['album_id']}/all.zip",
            "content_type": "application/zip",
            "extension": "zip",
            "bytes": zip_path.stat().st_size,
            "sha256": sha256_file(zip_path),
            "width": None,
            "height": None,
        }
    state["cover"] = cover
    state["gallery"] = gallery
    state["zip"] = zip_record
    save_state(folder, state)
    return media


def verify_record(record: Dict[str, Any]) -> None:
    path = Path(record["path"])
    if not path.is_file() or sha256_file(path) != record["sha256"]:
        raise AlbumError(f"Prepared file is missing or changed: {path}; restore it before resuming")


def publication_target() -> Dict[str, str]:
    environment = required_env("ALBUM_ENVIRONMENT").lower()
    if environment not in {"development", "staging", "production"}:
        raise AlbumError("ALBUM_ENVIRONMENT must be development, staging or production")
    base_url = os.getenv("ALBUM_BASE_URL", "https://upscales.app" if environment == "production" else "").rstrip("/")
    parsed = urlsplit(base_url)
    if (parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username
            or parsed.password or parsed.path or parsed.query or parsed.fragment
            or (parsed.scheme != "https" and environment != "development")):
        raise AlbumError("ALBUM_BASE_URL must be an HTTPS origin (HTTP is allowed only for development)")
    if environment != "production" and parsed.hostname == "upscales.app":
        raise AlbumError("upscales.app requires ALBUM_ENVIRONMENT=production")
    return {
        "environment": environment, "base_url": base_url,
        "account_id": required_env("CLOUDFLARE_ACCOUNT_ID"),
        "database_id": required_env("CLOUDFLARE_D1_DATABASE_ID"),
        "bucket": required_env("R2_BUCKET_NAME"),
    }


def publication_state(folder: Path, state: Dict[str, Any], target: Dict[str, str]) -> Dict[str, Any]:
    publications = state.setdefault("publications", {})
    for publication in publications.values():
        previous = publication["target"]
        if previous["account_id"] == target["account_id"]:
            same_db = previous["database_id"] == target["database_id"]
            same_bucket = previous["bucket"] == target["bucket"]
            if same_db != same_bucket:
                raise AlbumError("D1 database and R2 bucket must change together between publication destinations")
    # Key by storage destination. A URL/environment change for that storage is an error.
    identity = sha256_json({key: target[key] for key in ("account_id", "database_id", "bucket")})
    existing = publications.get(identity)
    if existing is not None and existing["target"] != target:
        raise AlbumError("Publication URL/environment changed for this D1/R2 destination")
    if existing is None:
        existing = {"target": target, "published": False, "uploads": {}}
        publications[identity] = existing
        save_state(folder, state)
    return existing


def file_record(info: ImageInfo, key: str) -> Dict[str, Any]:
    return {
        "path": str(info.path), "key": key, "content_type": info.content_type,
        "extension": info.extension, "bytes": info.size, "sha256": info.sha256,
        "width": info.width, "height": info.height,
    }


class CloudflareAdmin:
    def __init__(self) -> None:
        try:
            import boto3
        except ImportError as error:
            raise AlbumError("boto3 is required; install tools/album/requirements.txt") from error
        account_id = required_env("CLOUDFLARE_ACCOUNT_ID")
        self.database_id = required_env("CLOUDFLARE_D1_DATABASE_ID")
        self.api_token = required_env("CLOUDFLARE_D1_API_TOKEN")
        self.d1_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{self.database_id}/query"
        endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
        self.bucket = required_env("R2_BUCKET_NAME")
        self.s3 = boto3.client(
            "s3", endpoint_url=endpoint,
            aws_access_key_id=required_env("R2_ACCESS_KEY_ID"),
            aws_secret_access_key=required_env("R2_SECRET_ACCESS_KEY"),
            region_name="auto",
        )

    def query(self, sql: str, params: Sequence[Any] = ()) -> List[Dict[str, Any]]:
        payload = response_json(requests.post(
            self.d1_url,
            headers={"Authorization": f"Bearer {self.api_token}", "Content-Type": "application/json"},
            json={"sql": sql, "params": list(params)},
            timeout=30,
        ), {200})
        if payload.get("success") is not True:
            raise AlbumError(f"D1 query failed: {payload.get('errors')}")
        results = payload.get("result")
        if not isinstance(results, list) or not results:
            return []
        first = results[0]
        if not isinstance(first, dict) or first.get("success") is not True:
            raise AlbumError(f"D1 query statement failed: {first.get('error') if isinstance(first, dict) else first}")
        rows = first.get("results", [])
        if not isinstance(rows, list):
            raise AlbumError("D1 returned invalid results")
        return rows

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        payload = response_json(requests.post(
            self.d1_url,
            headers={"Authorization": f"Bearer {self.api_token}", "Content-Type": "application/json"},
            json={"sql": sql, "params": list(params)},
            timeout=30,
        ), {200})
        if payload.get("success") is not True:
            raise AlbumError(f"D1 write failed: {payload.get('errors')}")
        try:
            result = payload["result"][0]
            if result.get("success") is not True:
                raise AlbumError(f"D1 write statement failed: {result.get('error')}")
            return int(result["meta"].get("changes", 0))
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise AlbumError("D1 returned invalid write metadata") from error

    def batch(self, statements: Sequence[Tuple[str, Sequence[Any]]]) -> None:
        payload = response_json(requests.post(
            self.d1_url,
            headers={"Authorization": f"Bearer {self.api_token}", "Content-Type": "application/json"},
            json={"batch": [{"sql": sql, "params": list(params)} for sql, params in statements]},
            timeout=60,
        ), {200})
        if payload.get("success") is not True:
            raise AlbumError(f"D1 batch failed: {payload.get('errors')}")
        results = payload.get("result")
        if not isinstance(results, list) or len(results) != len(statements) or any(
            not isinstance(item, dict) or item.get("success") is not True for item in results
        ):
            raise AlbumError("D1 batch returned incomplete or failed statement results")

    def upload(self, record: Dict[str, Any]) -> None:
        try:
            existing = self.s3.head_object(Bucket=self.bucket, Key=record["key"])
        except self.s3.exceptions.ClientError as error:
            code = str(error.response.get("Error", {}).get("Code", ""))
            if code not in {"404", "NoSuchKey", "NotFound"}:
                raise
        else:
            if existing.get("Metadata", {}).get("sha256") == record["sha256"]:
                return
            if not existing.get("Metadata", {}).get("sha256"):
                with tempfile.TemporaryDirectory(prefix="album-r2-verify-") as directory:
                    downloaded = Path(directory) / "object"
                    self.download(record["key"], downloaded)
                    if sha256_file(downloaded) == record["sha256"]:
                        return
            raise AlbumError(f"Immutable R2 key already exists with different content: {record['key']}")
        self.s3.upload_file(
            record["path"], self.bucket, record["key"],
            ExtraArgs={"ContentType": record["content_type"], "Metadata": {"sha256": record["sha256"]}},
        )

    def download(self, key: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.s3.download_file(self.bucket, key, str(destination))

    def delete_keys(self, keys: Iterable[str]) -> None:
        objects = [{"Key": key} for key in keys]
        for offset in range(0, len(objects), 1000):
            response = self.s3.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": objects[offset:offset + 1000], "Quiet": True},
            )
            errors = response.get("Errors", [])
            if errors:
                failed = ", ".join(str(item.get("Key", "unknown")) for item in errors[:10])
                raise AlbumError(f"R2 failed to delete {len(errors)} object(s): {failed}; run album gc --delete")


def price_cents(photo_count: int, override: Optional[str]) -> int:
    if override is None:
        return 300 if photo_count == 1 else (500 if photo_count <= 4 else 800)
    try:
        value = Decimal(override)
    except InvalidOperation as error:
        raise AlbumError("--price-usd must be a number") from error
    if value < 0 or value.as_tuple().exponent < -2:
        raise AlbumError("--price-usd must be non-negative with at most two decimals")
    return int(value * 100)


def all_records(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    records = [state["cover"], state["gallery"]]
    for photo in state["photos"]:
        records.extend(photo["media"][name] for name in ("before", "after", "clean"))
    if state.get("zip"):
        records.append(state["zip"])
    return records


def publish(folder: Path, unlocked: bool, price_override: Optional[str]) -> Dict[str, Any]:
    manifest = load_manifest(folder)
    photos = validate_manifest(folder, manifest)
    target = publication_target()
    cents = price_cents(len(photos), price_override)
    state = initialize_state(folder, photos)
    publication = publication_state(folder, state, target)
    album_url = f"{target['base_url']}/gallery/{state['album_id']}"
    metadata_hash = sha256_json({"manifest": manifest, "unlocked": unlocked, "price_cents": cents})
    if publication.get("metadata_hash", metadata_hash) != metadata_hash:
        raise AlbumError("Publication options changed during resume; use the original manifest, --unlocked and price")
    publication["metadata_hash"] = metadata_hash
    save_state(folder, state)
    admin = CloudflareAdmin()
    existing = admin.query("SELECT id,state,photo_count FROM albums WHERE id=?1", (state["album_id"],))
    if existing:
        if existing[0]["state"] == "deleted":
            raise AlbumError("Album was deleted; it cannot be republished with the same ID")
        actual = admin.query("SELECT COUNT(*) AS count FROM photos WHERE album_id=?1", (state["album_id"],))
        if existing[0]["photo_count"] != len(photos) or not actual or actual[0]["count"] != len(photos):
            raise AlbumError("Published album is incomplete; inspect D1 before resuming")
        publication["published"] = True
        save_state(folder, state)
        return {"ok": True, "album_id": state["album_id"], "url": album_url,
                "state": existing[0]["state"], "reused": True}
    if publication["published"]:
        raise AlbumError("Previously published album is missing from this database; inspect the destination")
    prepare_media(folder, photos, state, watermarked=not unlocked)
    for record in all_records(state):
        admin.upload(record)
        publication["uploads"][record["key"]] = record["sha256"]
        save_state(folder, state)

    cover = state["cover"]
    gallery = state["gallery"]
    zip_record = state.get("zip")
    now = int(state["created_at"])
    statements: List[Tuple[str, Sequence[Any]]] = [(
        """INSERT INTO albums(
             id,title,note,state,featured,price_cents,currency,photo_count,
             cover_photo_id,cover_key,cover_mime,cover_width,cover_height,cover_bytes,
             gallery_key,gallery_mime,gallery_width,gallery_height,gallery_bytes,
             zip_key,zip_bytes,source_url,created_at,unlocked_at
           ) VALUES(?1,?2,?3,?4,?5,?6,'USD',?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)""",
        (
            state["album_id"], manifest["title"].strip(), manifest.get("note"),
            "unlocked" if unlocked else "locked", 1 if manifest.get("featured", False) else 0,
            cents, len(photos), state["photos"][0]["id"],
            cover["key"], cover["content_type"], cover["width"], cover["height"], cover["bytes"],
            gallery["key"], gallery["content_type"], gallery["width"], gallery["height"], gallery["bytes"],
            zip_record["key"] if zip_record else None, zip_record["bytes"] if zip_record else None,
            manifest.get("source_url"), now, now if unlocked else None,
        ),
    )]
    for photo_state in state["photos"]:
        media = photo_state["media"]
        before, after, clean = media["before"], media["after"], media["clean"]
        statements.append((
            """INSERT INTO photos(
                 album_id,id,position,before_key,before_width,before_height,before_bytes,before_sha256,
                 after_key,after_width,after_height,after_bytes,after_sha256,
                 clean_key,clean_width,clean_height,clean_bytes,clean_mime,clean_sha256,alt
               ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)""",
            (
                state["album_id"], photo_state["id"], media["position"],
                before["key"], before["width"], before["height"], before["bytes"], before["sha256"],
                after["key"], after["width"], after["height"], after["bytes"], after["sha256"],
                clean["key"], clean["width"], clean["height"], clean["bytes"], clean["content_type"], clean["sha256"], media["alt"],
            ),
        ))
    admin.batch(statements)
    publication["published"] = True
    save_state(folder, state)
    return {"ok": True, "album_id": state["album_id"], "url": album_url,
            "state": "unlocked" if unlocked else "locked", "reused": False}


def validate_command(folder: Path) -> None:
    photos = validate_manifest(folder, load_manifest(folder))
    print(f"Valid album with {len(photos)} photo{'s' if len(photos) != 1 else ''}")


def update_album(album_id: str, action: str, title: Optional[str] = None) -> Dict[str, Any]:
    validate_album_id(album_id)
    # Read before writing: a missing base URL must not leave the album mutated in D1.
    base_url = required_env("ALBUM_BASE_URL").rstrip("/")
    new_title = validate_album_title(title) if action == "rename" else None
    admin = CloudflareAdmin()
    if action == "rename":
        changes = admin.execute(
            "UPDATE albums SET title=?1 WHERE id=?2 AND state!='deleted' AND title!=?1",
            (new_title, album_id),
        )
        settled = ("title", new_title)
    elif action == "unlock":
        changes = admin.execute("UPDATE albums SET state='unlocked', unlocked_at=?1 WHERE id=?2 AND state='locked'", (int(time.time()), album_id))
        settled = ("state", "unlocked")
    elif action == "feature":
        changes = admin.execute("UPDATE albums SET featured=1 WHERE id=?1 AND state!='deleted' AND featured=0", (album_id,))
        settled = ("featured", 1)
    elif action == "unfeature":
        changes = admin.execute("UPDATE albums SET featured=0 WHERE id=?1 AND featured=1", (album_id,))
        settled = ("featured", 0)
    else:
        raise AlbumError(f"Unsupported action: {action}")
    # Every one of these commands is a no-op on repeat, so re-reading the column tells an
    # already-applied change apart from a wrong ID or a deleted album.
    reused = False
    if changes != 1:
        column, expected = settled
        rows = admin.query("SELECT state,featured,title FROM albums WHERE id=?1", (album_id,))
        if not rows or rows[0].get("state") == "deleted" or rows[0].get(column) != expected:
            raise AlbumError(f"Album was not changed; check its ID and current state ({action})")
        reused = True
    state = "unlocked" if action == "unlock" else action
    result = {"ok": True, "album_id": album_id, "url": f"{base_url}/gallery/{album_id}",
              "state": state, "action": action, "reused": reused}
    if new_title is not None:
        result["title"] = new_title
    return result


def delete_album(album_id: str) -> Dict[str, Any]:
    validate_album_id(album_id)
    admin = CloudflareAdmin()
    rows = admin.query(
        """SELECT a.cover_key, a.gallery_key, a.zip_key, p.before_key, p.after_key, p.clean_key
             FROM albums a LEFT JOIN photos p ON p.album_id=a.id WHERE a.id=?1""",
        (album_id,),
    )
    if not rows:
        raise AlbumError("Album not found")
    now = int(time.time())
    admin.execute("UPDATE albums SET state='deleted', featured=0, deleted_at=?1 WHERE id=?2 AND state!='deleted'", (now, album_id))
    keys = set()
    for row in rows:
        for name in ("cover_key", "gallery_key", "zip_key", "before_key", "after_key", "clean_key"):
            value = row.get(name)
            if isinstance(value, str) and value:
                keys.add(value)
    admin.delete_keys(sorted(keys))
    return {"ok": True, "album_id": album_id, "state": "deleted", "action": "delete", "deleted_objects": len(keys)}


def list_albums(as_json: bool = False) -> Optional[Dict[str, Any]]:
    rows = CloudflareAdmin().query(
        "SELECT id,title,state,featured,photo_count,created_at FROM albums ORDER BY created_at DESC LIMIT 200"
    )
    if not as_json:
        for row in rows:
            featured = " featured" if row.get("featured") else ""
            print(f"{row['id']}  {row['state']}{featured}  {row['photo_count']}  {row['title']}")
        return None
    base_url = required_env("ALBUM_BASE_URL").rstrip("/")
    albums = [
        {
            "id": row["id"],
            "title": row["title"],
            "state": row["state"],
            "featured": bool(row.get("featured")),
            "photo_count": row.get("photo_count"),
            "created_at": row.get("created_at"),
            "url": f"{base_url}/gallery/{row['id']}",
            "gallery_url": f"{base_url}/media/{row['id']}/gallery.jpg",
        }
        for row in rows
        if row.get("state") != "deleted"
    ]
    return {"ok": True, "albums": albums}


def migrate_gallery(album_id: Optional[str], all_albums: bool, dry_run: bool) -> Dict[str, Any]:
    if bool(album_id) == bool(all_albums):
        raise AlbumError("migrate-gallery requires either an album ID or --all")
    params: Sequence[Any] = ()
    where = "state IN ('locked','unlocked') AND gallery_key IS NOT NULL"
    if album_id:
        validate_album_id(album_id)
        where += " AND id=?1"
        params = (album_id,)
    admin = CloudflareAdmin()
    rows = admin.query(
        f"""SELECT id,state,gallery_key,gallery_mime,gallery_width,gallery_height,gallery_bytes
              FROM albums WHERE {where} ORDER BY created_at""",
        params,
    )
    if album_id and not rows:
        raise AlbumError("Active album with a gallery preview was not found")

    results: List[Dict[str, Any]] = []
    for row in rows:
        current_key = row.get("gallery_key")
        target_key = f"albums/{row['id']}/gallery-{GALLERY_VERSION}.jpg"
        current_profile = (
            current_key == target_key
            and row.get("gallery_mime") == "image/jpeg"
            and (row.get("gallery_width"), row.get("gallery_height")) == GALLERY_SIZE
        )
        if current_profile:
            results.append({
                "album_id": row["id"], "status": "reused", "old_key": current_key,
                "new_key": target_key, "before_bytes": row.get("gallery_bytes"),
                "after_bytes": row.get("gallery_bytes"),
            })
            continue

        expected_legacy_key = f"albums/{row['id']}/gallery-{LEGACY_GALLERY_VERSION}.jpg"
        if (current_key != expected_legacy_key or row.get("gallery_mime") != "image/jpeg"
                or (row.get("gallery_width"), row.get("gallery_height")) != LEGACY_GALLERY_SIZE):
            raise AlbumError(f"Album {row['id']} gallery preview does not match the v1 or v2 profile")

        with tempfile.TemporaryDirectory(prefix=f"gallery-{row['id']}-") as directory:
            source = Path(directory) / f"gallery-{LEGACY_GALLERY_VERSION}.jpg"
            destination = Path(directory) / f"gallery-{GALLERY_VERSION}.jpg"
            admin.download(current_key, source)
            source_info = inspect_image(source)
            if source_info.image_format != "JPEG" or (source_info.width, source_info.height) != LEGACY_GALLERY_SIZE:
                raise AlbumError(f"Album {row['id']} R2 gallery object does not match its D1 metadata")
            resize_gallery_preview(source, destination)
            record = file_record(inspect_image(destination), target_key)
            status = "would_migrate" if dry_run else "migrated"
            if not dry_run:
                admin.upload(record)
                changes = admin.execute(
                    """UPDATE albums
                          SET gallery_key=?1,gallery_mime=?2,gallery_width=?3,gallery_height=?4,gallery_bytes=?5
                        WHERE id=?6 AND state IN ('locked','unlocked') AND gallery_key=?7""",
                    (
                        record["key"], record["content_type"], record["width"], record["height"],
                        record["bytes"], row["id"], current_key,
                    ),
                )
                if changes != 1:
                    settled = admin.query(
                        """SELECT state,gallery_key,gallery_mime,gallery_width,gallery_height,gallery_bytes
                              FROM albums WHERE id=?1""",
                        (row["id"],),
                    )
                    already_current = bool(settled) and settled[0].get("state") in {"locked", "unlocked"} and (
                        settled[0].get("gallery_key") == record["key"]
                        and settled[0].get("gallery_mime") == record["content_type"]
                        and (settled[0].get("gallery_width"), settled[0].get("gallery_height")) == GALLERY_SIZE
                        and settled[0].get("gallery_bytes") == record["bytes"]
                    )
                    if not already_current:
                        raise AlbumError(f"Album {row['id']} changed while its gallery preview was being migrated")
                    status = "reused"
            results.append({
                "album_id": row["id"], "status": status, "old_key": current_key,
                "new_key": record["key"], "before_bytes": source_info.size,
                "after_bytes": record["bytes"],
            })

    return {
        "ok": True,
        "action": "migrate-gallery",
        "dry_run": dry_run,
        "scanned": len(results),
        "migrated": sum(item["status"] == "migrated" for item in results),
        "would_migrate": sum(item["status"] == "would_migrate" for item in results),
        "reused": sum(item["status"] == "reused" for item in results),
        "before_bytes": sum(item["before_bytes"] or 0 for item in results),
        "after_bytes": sum(item["after_bytes"] or 0 for item in results),
        "albums": results,
    }


def gc_albums(delete: bool) -> None:
    admin = CloudflareAdmin()
    albums = {row["id"]: row["state"] for row in admin.query("SELECT id,state FROM albums")}
    orphan_keys: List[str] = []
    continuation = None
    while True:
        kwargs: Dict[str, Any] = {"Bucket": admin.bucket, "Prefix": "albums/"}
        if continuation:
            kwargs["ContinuationToken"] = continuation
        page = admin.s3.list_objects_v2(**kwargs)
        for item in page.get("Contents", []):
            key = item.get("Key", "")
            parts = key.split("/")
            if len(parts) >= 3 and albums.get(parts[1]) == "deleted":
                orphan_keys.append(key)
            elif len(parts) >= 3 and parts[1] not in albums:
                print(f"kept (unknown/in-progress): {key}")
        if not page.get("IsTruncated"):
            break
        continuation = page.get("NextContinuationToken")
    for key in orphan_keys:
        print(key)
    if delete and orphan_keys:
        admin.delete_keys(orphan_keys)
    print(f"{len(orphan_keys)} tombstoned object(s){' deleted' if delete else ' found'}")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="album", description="Prepare and publish UScale result albums")
    sub = root.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate")
    validate.add_argument("folder", type=Path)
    publish_parser = sub.add_parser("publish")
    publish_parser.add_argument("folder", type=Path)
    publish_parser.add_argument("--unlocked", action="store_true")
    publish_parser.add_argument("--price-usd")
    publish_parser.add_argument("--json", action="store_true")
    resume = sub.add_parser("resume")
    resume.add_argument("folder", type=Path)
    resume.add_argument("--unlocked", action="store_true")
    resume.add_argument("--price-usd")
    resume.add_argument("--json", action="store_true")
    for action in ("unlock", "feature", "unfeature", "delete"):
        command = sub.add_parser(action)
        command.add_argument("album_id")
        command.add_argument("--json", action="store_true")
    rename = sub.add_parser("rename")
    rename.add_argument("album_id")
    rename.add_argument("--title", required=True)
    rename.add_argument("--json", action="store_true")
    listing = sub.add_parser("list")
    listing.add_argument("--json", action="store_true")
    gallery_migration = sub.add_parser("migrate-gallery")
    gallery_migration.add_argument("album_id", nargs="?")
    gallery_migration.add_argument("--all", action="store_true", dest="all_albums")
    gallery_migration.add_argument("--dry-run", action="store_true")
    gallery_migration.add_argument("--json", action="store_true")
    gc = sub.add_parser("gc")
    gc.add_argument("--delete", action="store_true", help="Delete listed orphan objects")
    return root


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parser().parse_args(argv)
    try:
        result = None
        if args.command == "validate":
            validate_command(args.folder.resolve())
        elif args.command in {"publish", "resume"}:
            result = publish(args.folder.resolve(), args.unlocked, args.price_usd)
        elif args.command in {"unlock", "feature", "unfeature"}:
            result = update_album(args.album_id, args.command)
        elif args.command == "rename":
            result = update_album(args.album_id, args.command, args.title)
        elif args.command == "delete":
            result = delete_album(args.album_id)
        elif args.command == "list":
            result = list_albums(args.json)
        elif args.command == "migrate-gallery":
            result = migrate_gallery(args.album_id, args.all_albums, args.dry_run)
        elif args.command == "gc":
            gc_albums(args.delete)
        if result is not None:
            if getattr(args, "json", False):
                print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
            elif args.command == "list":
                pass
            elif args.command == "migrate-gallery":
                changed = result["would_migrate"] if result["dry_run"] else result["migrated"]
                prefix = "gallery migration dry run" if result["dry_run"] else "gallery migration"
                print(f"{prefix}: {changed} changed, {result['reused']} current, {result['scanned']} scanned")
            elif args.command in {"publish", "resume"}:
                print(result["url"])
            else:
                print(f"{result['action']}: {result['album_id']}")
        return 0
    except AlbumError as error:
        if getattr(args, "json", False):
            print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        else:
            print(f"album: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
