#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests


DEFAULT_API_BASE_URL = "https://auralens-406817559814.us-central1.run.app"
DEFAULT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
ENV_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


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
        raise ToolError(f"Image and API URLs must use {expected}")
    if parsed.username or parsed.password:
        raise ToolError("URLs cannot contain credentials")


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
    session: Optional[requests.Session] = None,
    flow: str = "creative-upscale",
    output_format: str = "jpg",
    safety_tolerance: int = 2,
    seed: Optional[int] = None,
) -> str:
    if flow not in {"creative-upscale", "photo-restoration"}:
        raise ToolError("Flow must be creative-upscale or photo-restoration")
    if retention_days not in {3, 7}:
        raise ToolError("Retention must be 3 or 7 days")
    if creativity not in {-2, -1, 0, 1, 2}:
        raise ToolError("Creativity must be between -2 and 2")
    if target_resolution not in {"2k", "4k", "8k"}:
        raise ToolError("Resolution must be 2k, 4k, or 8k")
    if output_format not in {"jpg", "png", "webp"}:
        raise ToolError("Restoration output format must be jpg, png, or webp")
    if safety_tolerance not in {0, 1, 2}:
        raise ToolError("Restoration safety tolerance must be between 0 and 2")

    api_base_url = api_base_url.rstrip("/")
    _validate_url(api_base_url, allow_http=allow_http)
    _validate_url(image_url, allow_http=allow_http)
    session = session or requests.Session()

    payload: Dict[str, Any] = {
        "image_url": image_url,
        "flow": flow,
        "retention_days": retention_days,
    }
    if flow == "creative-upscale":
        payload.update(
            creativity=creativity,
            target_resolution=target_resolution,
        )
    else:
        payload.update(
            output_format=output_format,
            safety_tolerance=safety_tolerance,
        )
        if seed is not None:
            payload["seed"] = seed

    print("Submitting the authenticated AuraLens result request…", file=sys.stderr)
    try:
        response = session.post(
            f"{api_base_url}/internal/v1/results",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Idempotency-Key": f"{flow}-{uuid.uuid4()}",
            },
            json=payload,
            timeout=(10, max(90.0, poll_timeout)),
        )
    except requests.RequestException as error:
        raise ToolError(f"Could not create result: {error}") from error

    result = _json_response(response, "Creating result")
    result_url = result.get("result_url")
    if not isinstance(result_url, str) or not result_url:
        raise ToolError("Creating result returned no result URL")
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
        help="Maximum server processing wait in seconds (default: 360)",
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
