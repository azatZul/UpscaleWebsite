#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import sys
import time
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests
from PIL import Image, ImageOps


DEFAULT_API_BASE_URL = "https://auralens-406817559814.us-central1.run.app"
DEFAULT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024
MAX_IMAGE_PIXELS = 100_000_000
MAX_REDIRECTS = 5
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "timeout"}
ENV_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
PROVIDER_IMAGE_FORMATS = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}


class ToolError(Exception):
    pass


def load_env_file(path: Path = DEFAULT_ENV_PATH) -> None:
    """Load simple KEY=VALUE entries without overriding the process environment."""
    if not path.is_file():
        return
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise ToolError(f"Could not read {path}: {error}") from error

    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not ENV_KEY.fullmatch(key):
            raise ToolError(f"Invalid environment entry at {path}:{line_number}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _validate_url(url: str, *, allow_http: bool) -> None:
    parsed = urlparse(url)
    allowed_schemes = {"https"}
    if allow_http:
        allowed_schemes.add("http")
    if parsed.scheme.lower() not in allowed_schemes or not parsed.hostname:
        expected = "HTTP(S)" if allow_http else "HTTPS"
        raise ToolError(f"Image URLs must use {expected}")
    if parsed.username or parsed.password:
        raise ToolError("Image URLs cannot contain credentials")


def _download_bounded(
    session: requests.Session,
    url: str,
    *,
    allow_http: bool,
) -> bytes:
    _validate_url(url, allow_http=allow_http)
    try:
        with session.get(url, stream=True, timeout=(10, 90)) as response:
            for redirect in [*response.history, response]:
                _validate_url(redirect.url, allow_http=allow_http)
            response.raise_for_status()
            content_length = response.headers.get("Content-Length")
            if content_length:
                try:
                    if int(content_length) > MAX_DOWNLOAD_BYTES:
                        raise ToolError("Image download exceeds the 40 MB limit")
                except ValueError:
                    pass
            data = bytearray()
            for chunk in response.iter_content(chunk_size=128 * 1024):
                if not chunk:
                    continue
                data.extend(chunk)
                if len(data) > MAX_DOWNLOAD_BYTES:
                    raise ToolError("Image download exceeds the 40 MB limit")
            return bytes(data)
    except ToolError:
        raise
    except requests.RequestException as error:
        raise ToolError(f"Could not download image: {error}") from error


def _normalize_jpeg(data: bytes) -> bytes:
    try:
        with Image.open(BytesIO(data)) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ToolError("Image exceeds the 100 megapixel limit")
            source.seek(0)
            image = ImageOps.exif_transpose(source)
            if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
                rgba = image.convert("RGBA")
                background = Image.new("RGBA", rgba.size, "white")
                background.alpha_composite(rgba)
                image = background.convert("RGB")
            else:
                image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=96, optimize=True)
            return output.getvalue()
    except ToolError:
        raise
    except Exception as error:
        raise ToolError("URL did not return a supported image") from error


def _validated_provider_image(data: bytes) -> tuple[bytes, str, str]:
    try:
        with Image.open(BytesIO(data)) as image:
            image.verify()
        with Image.open(BytesIO(data)) as image:
            image_format = (image.format or "").upper()
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ToolError("Provider image exceeds the 100 megapixel limit")
    except ToolError:
        raise
    except Exception as error:
        raise ToolError("Provider returned an invalid image") from error

    details = PROVIDER_IMAGE_FORMATS.get(image_format)
    if details is None:
        raise ToolError("Provider returned an unsupported image format")
    content_type, extension = details
    return data, content_type, extension


def _api_error(response: requests.Response, action: str) -> ToolError:
    detail: Any = None
    try:
        payload = response.json()
        detail = payload.get("detail") if isinstance(payload, dict) else None
    except ValueError:
        pass
    suffix = f": {detail}" if detail else ""
    return ToolError(f"{action} failed (HTTP {response.status_code}){suffix}")


def _json_response(response: requests.Response, action: str) -> Dict[str, Any]:
    if not response.ok:
        raise _api_error(response, action)
    try:
        payload = response.json()
    except ValueError as error:
        raise ToolError(f"{action} returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise ToolError(f"{action} returned an invalid response")
    return payload


def create_share_url(
    *,
    image_url: str,
    retention_days: int,
    creativity: int,
    target_resolution: str,
    api_base_url: str,
    api_key: str,
    allow_http: bool,
    poll_timeout: float,
    poll_interval: Optional[float] = None,
    session: Optional[requests.Session] = None,
    flow: str = "creative-upscale",
    output_format: str = "jpg",
    safety_tolerance: int = 2,
    seed: Optional[int] = None,
) -> str:
    if flow not in {"creative-upscale", "photo-restoration"}:
        raise ToolError("Flow must be creative-upscale or photo-restoration")
    if output_format not in {"jpg", "png", "webp"}:
        raise ToolError("Restoration output format must be jpg, png, or webp")
    if safety_tolerance not in {0, 1, 2}:
        raise ToolError("Restoration safety tolerance must be between 0 and 2")

    api_base_url = api_base_url.rstrip("/")
    _validate_url(api_base_url, allow_http=allow_http)
    session = session or requests.Session()
    session.max_redirects = MAX_REDIRECTS
    headers = {"Authorization": f"Bearer {api_key}"}

    print("Checking AuraLens access…", file=sys.stderr)
    try:
        response = session.get(
            f"{api_base_url}/internal/v1/tool-access",
            headers=headers,
            timeout=(10, 30),
        )
    except requests.RequestException as error:
        raise ToolError(f"Could not check AuraLens access: {error}") from error
    _json_response(response, "Checking AuraLens access")

    print("Downloading and preparing the source image…", file=sys.stderr)
    before_data = _normalize_jpeg(
        _download_bounded(session, image_url, allow_http=allow_http)
    )

    if flow == "creative-upscale":
        print("Starting one whole-image Upscale job…", file=sys.stderr)
        try:
            response = session.post(
                f"{api_base_url}/internal/v1/creative-upscale-jobs",
                headers=headers,
                data={
                    "creativity": str(creativity),
                    "target_resolution": target_resolution,
                },
                files={"image": ("source.jpg", before_data, "image/jpeg")},
                timeout=(10, 90),
            )
        except requests.RequestException as error:
            raise ToolError(f"Could not start upscale: {error}") from error
        job = _json_response(response, "Starting upscale")
        prediction_id = job.get("prediction_id")
        if not isinstance(prediction_id, str) or not prediction_id:
            raise ToolError("Starting upscale returned no prediction id")

        deadline = time.monotonic() + poll_timeout
        while job.get("status") not in TERMINAL_STATUSES:
            if time.monotonic() >= deadline:
                raise ToolError("Upscale timed out while waiting for the provider")
            server_delay = float(job.get("poll_after_seconds", 2))
            delay = poll_interval if poll_interval is not None else server_delay
            time.sleep(max(0.01, min(delay, 10.0)))
            try:
                response = session.get(
                    f"{api_base_url}/internal/v1/creative-upscale-jobs/{prediction_id}",
                    headers=headers,
                    timeout=(10, 45),
                )
            except requests.RequestException as error:
                raise ToolError(f"Could not check upscale status: {error}") from error
            job = _json_response(response, "Checking upscale")

        if job.get("status") != "completed":
            detail = job.get("error") or f"provider status was {job.get('status')}"
            raise ToolError(f"Upscale failed: {detail}")
        output_url = job.get("output_url")
        if not isinstance(output_url, str) or not output_url:
            raise ToolError("Completed upscale returned no output URL")
        processing_data = {
            "processing_kind": "creative_upscale",
            "creativity": str(creativity),
            "target_resolution": target_resolution,
        }
        idempotency_prefix = "upscale"
        download_label = "upscaled"
    else:
        print("Starting Photo Restoration…", file=sys.stderr)
        restoration_data = {
            "output_format": output_format,
            "safety_tolerance": str(safety_tolerance),
        }
        if seed is not None:
            restoration_data["seed"] = str(seed)
        try:
            response = session.post(
                f"{api_base_url}/internal/v1/photo-restoration-jobs",
                headers=headers,
                data=restoration_data,
                files={"image": ("source.jpg", before_data, "image/jpeg")},
                timeout=(10, max(90.0, poll_timeout)),
            )
        except requests.RequestException as error:
            raise ToolError(f"Could not restore photo: {error}") from error
        restoration = _json_response(response, "Restoring photo")
        output_url = restoration.get("output_url")
        if not isinstance(output_url, str) or not output_url:
            raise ToolError("Photo Restoration returned no output URL")
        processing_data = {
            "processing_kind": "photo_restoration",
            "output_format": output_format,
            "safety_tolerance": str(safety_tolerance),
        }
        if seed is not None:
            processing_data["seed"] = str(seed)
        idempotency_prefix = "restore"
        download_label = "restored"

    print(f"Downloading the {download_label} image…", file=sys.stderr)
    after_data, after_content_type, after_extension = _validated_provider_image(
        _download_bounded(session, output_url, allow_http=allow_http)
    )

    print(f"Publishing a result that expires in {retention_days} days…", file=sys.stderr)
    try:
        response = session.post(
            f"{api_base_url}/internal/v1/results",
            headers={
                **headers,
                "Idempotency-Key": f"{idempotency_prefix}-{uuid.uuid4()}",
            },
            data={
                "retention_days": str(retention_days),
                **processing_data,
            },
            files={
                "before": ("before.jpg", before_data, "image/jpeg"),
                "after": (
                    f"after.{after_extension}",
                    after_data,
                    after_content_type,
                ),
            },
            timeout=(10, 120),
        )
    except requests.RequestException as error:
        raise ToolError(f"Could not publish result: {error}") from error
    result = _json_response(response, "Publishing result")
    result_url = result.get("result_url")
    if not isinstance(result_url, str) or not result_url:
        raise ToolError("Publishing result returned no result URL")
    return result_url


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run an image enhancement flow and print its share URL."
    )
    parser.add_argument("image_url", help="URL of the source image")
    parser.add_argument(
        "--flow",
        choices=("creative-upscale", "photo-restoration"),
        default="creative-upscale",
        help="Enhancement flow to run (default: creative-upscale)",
    )
    parser.add_argument(
        "--retention",
        dest="retention_days",
        type=int,
        choices=(3, 7),
        required=True,
        help="Keep the before/after result for 3 or 7 days",
    )
    parser.add_argument(
        "--creativity", type=int, choices=(-2, -1, 0, 1, 2), default=0
    )
    parser.add_argument(
        "--resolution",
        dest="target_resolution",
        choices=("2k", "4k", "8k"),
        default="4k",
    )
    parser.add_argument(
        "--api-base-url",
        default=None,
        help="AuraLens server URL (defaults to AURALENS_API_BASE_URL or production)",
    )
    parser.add_argument(
        "--poll-timeout",
        type=float,
        default=360.0,
        help="Maximum provider wait in seconds (default: 360)",
    )
    parser.add_argument(
        "--output-format",
        choices=("jpg", "png", "webp"),
        default="jpg",
        help="Photo Restoration output format (default: jpg)",
    )
    parser.add_argument(
        "--safety-tolerance",
        type=int,
        choices=(0, 1, 2),
        default=2,
        help="Photo Restoration safety tolerance: 0 strict to 2 permissive (default: 2)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Optional Photo Restoration seed for reproducible output",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=None,
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--allow-http",
        action="store_true",
        help="Allow HTTP URLs for local development only",
    )
    return parser


def main() -> int:
    try:
        load_env_file()
    except ToolError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    args = _parser().parse_args()
    api_key = os.getenv("UPSCALER_TOOL_API_KEY", "")
    if not api_key:
        print("Error: UPSCALER_TOOL_API_KEY is not set in .env", file=sys.stderr)
        return 2
    api_base_url = args.api_base_url or os.getenv(
        "AURALENS_API_BASE_URL", DEFAULT_API_BASE_URL
    )
    try:
        result_url = create_share_url(
            image_url=args.image_url,
            retention_days=args.retention_days,
            creativity=args.creativity,
            target_resolution=args.target_resolution,
            api_base_url=api_base_url,
            api_key=api_key,
            allow_http=args.allow_http,
            poll_timeout=args.poll_timeout,
            poll_interval=args.poll_interval,
            flow=args.flow,
            output_format=args.output_format,
            safety_tolerance=args.safety_tolerance,
            seed=args.seed,
        )
    except ToolError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(result_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
