import os
from io import BytesIO

import pytest
import requests
from PIL import Image

from scripts.upscale_result.upscale_result import (
    ToolError,
    create_share_url,
    load_env_file,
)


def _jpeg(size, color):
    output = BytesIO()
    Image.new("RGB", size, color).save(output, format="JPEG")
    return output.getvalue()


def _png(size, color):
    output = BytesIO()
    Image.new("RGB", size, color).save(output, format="PNG")
    return output.getvalue()


class FakeResponse:
    def __init__(self, *, status_code=200, payload=None, content=b"", url="https://api.example"):
        self.status_code = status_code
        self.payload = payload
        self.content = content
        self.url = url
        self.history = []
        self.headers = {"Content-Length": str(len(content))} if content else {}

    @property
    def ok(self):
        return self.status_code < 400

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def raise_for_status(self):
        if not self.ok:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def iter_content(self, chunk_size):
        yield self.content

    def json(self):
        if self.payload is None:
            raise ValueError("No JSON")
        return self.payload


class FakeSession:
    def __init__(self, before, after):
        self.before = before
        self.after = after
        self.posts = []
        self.requests = []
        self.poll_count = 0
        self.max_redirects = None

    def get(self, url, **kwargs):
        self.requests.append(("GET", url))
        if url.endswith("/internal/v1/tool-access"):
            return FakeResponse(payload={"status": "ok"}, url=url)
        if url == "https://images.example/source.jpg":
            return FakeResponse(content=self.before, url=url)
        if url == "https://provider.example/upscaled.jpg":
            return FakeResponse(content=self.after, url=url)
        if url == "https://provider.example/restored.png":
            return FakeResponse(content=self.after, url=url)
        if url.endswith("/internal/v1/creative-upscale-jobs/job-123"):
            self.poll_count += 1
            if self.poll_count == 1:
                return FakeResponse(payload={"prediction_id": "job-123", "status": "processing"}, url=url)
            return FakeResponse(
                payload={
                    "prediction_id": "job-123",
                    "status": "completed",
                    "output_url": "https://provider.example/upscaled.jpg",
                },
                url=url,
            )
        raise AssertionError(f"Unexpected GET {url}")

    def post(self, url, **kwargs):
        self.requests.append(("POST", url))
        self.posts.append((url, kwargs))
        if url.endswith("/internal/v1/creative-upscale-jobs"):
            return FakeResponse(
                status_code=202,
                payload={
                    "prediction_id": "job-123",
                    "status": "created",
                    "poll_after_seconds": 0,
                },
                url=url,
            )
        if url.endswith("/internal/v1/photo-restoration-jobs"):
            return FakeResponse(
                payload={
                    "status": "completed",
                    "output_url": "https://provider.example/restored.png",
                },
                url=url,
            )
        if url.endswith("/internal/v1/results"):
            return FakeResponse(
                status_code=201,
                payload={
                    "result_id": "2d51c93a-af14-4ca8-a216-650885fd76bf",
                    "result_url": "https://upscales.app/results/2d51c93a-af14-4ca8-a216-650885fd76bf",
                },
                url=url,
            )
        raise AssertionError(f"Unexpected POST {url}")


def test_create_share_url_runs_one_whole_image_job_and_publishes_pair():
    session = FakeSession(
        before=_jpeg((32, 20), (30, 60, 90)),
        after=_jpeg((64, 40), (40, 90, 150)),
    )

    result_url = create_share_url(
        image_url="https://images.example/source.jpg",
        retention_days=7,
        creativity=0,
        target_resolution="4k",
        api_base_url="https://api.example",
        api_key="secret",
        allow_http=False,
        poll_timeout=2,
        poll_interval=0.01,
        session=session,
    )

    assert result_url.endswith("2d51c93a-af14-4ca8-a216-650885fd76bf")
    assert session.max_redirects == 5
    assert session.requests[:2] == [
        ("GET", "https://api.example/internal/v1/tool-access"),
        ("GET", "https://images.example/source.jpg"),
    ]
    assert len(session.posts) == 2
    create_url, create_request = session.posts[0]
    publish_url, publish_request = session.posts[1]
    assert create_url.endswith("/internal/v1/creative-upscale-jobs")
    assert set(create_request["files"]) == {"image"}
    assert create_request["headers"] == {"Authorization": "Bearer secret"}
    assert publish_url.endswith("/internal/v1/results")
    assert set(publish_request["files"]) == {"before", "after"}
    assert publish_request["data"]["retention_days"] == "7"
    assert publish_request["data"]["processing_kind"] == "creative_upscale"
    assert publish_request["headers"]["Idempotency-Key"].startswith("upscale-")


def test_create_share_url_runs_photo_restoration_with_model_parameters():
    session = FakeSession(
        before=_jpeg((32, 20), (30, 60, 90)),
        after=_png((32, 20), (40, 90, 150)),
    )

    result_url = create_share_url(
        image_url="https://images.example/source.jpg",
        retention_days=3,
        creativity=0,
        target_resolution="4k",
        api_base_url="https://api.example",
        api_key="secret",
        allow_http=False,
        poll_timeout=2,
        session=session,
        flow="photo-restoration",
        output_format="png",
        safety_tolerance=1,
        seed=8675309,
    )

    assert result_url.endswith("2d51c93a-af14-4ca8-a216-650885fd76bf")
    assert session.poll_count == 0
    assert session.requests[:2] == [
        ("GET", "https://api.example/internal/v1/tool-access"),
        ("GET", "https://images.example/source.jpg"),
    ]
    assert len(session.posts) == 2
    restore_url, restore_request = session.posts[0]
    publish_url, publish_request = session.posts[1]
    assert restore_url.endswith("/internal/v1/photo-restoration-jobs")
    assert restore_request["data"] == {
        "output_format": "png",
        "safety_tolerance": "1",
        "seed": "8675309",
    }
    assert restore_request["headers"] == {"Authorization": "Bearer secret"}
    assert publish_url.endswith("/internal/v1/results")
    assert publish_request["data"] == {
        "retention_days": "3",
        "processing_kind": "photo_restoration",
        "output_format": "png",
        "safety_tolerance": "1",
        "seed": "8675309",
    }
    assert publish_request["files"]["after"][0] == "after.png"
    assert publish_request["files"]["after"][2] == "image/png"
    assert publish_request["headers"]["Idempotency-Key"].startswith("restore-")


def test_create_share_url_requires_https_by_default():
    with pytest.raises(ToolError, match="HTTPS"):
        create_share_url(
            image_url="http://images.example/source.jpg",
            retention_days=3,
            creativity=0,
            target_resolution="4k",
            api_base_url="https://api.example",
            api_key="secret",
            allow_http=False,
            poll_timeout=1,
            session=FakeSession(b"", b""),
        )


def test_create_share_url_checks_auth_before_downloading_source():
    class RejectedSession(FakeSession):
        def get(self, url, **kwargs):
            self.requests.append(("GET", url))
            if url.endswith("/internal/v1/tool-access"):
                return FakeResponse(
                    status_code=401,
                    payload={"detail": "Invalid tool API key"},
                    url=url,
                )
            raise AssertionError("The source must not be fetched before authentication")

    session = RejectedSession(before=b"", after=b"")

    with pytest.raises(ToolError, match="Invalid tool API key"):
        create_share_url(
            image_url="https://images.example/source.jpg",
            retention_days=3,
            creativity=0,
            target_resolution="4k",
            api_base_url="https://api.example",
            api_key="wrong-secret",
            allow_http=False,
            poll_timeout=1,
            session=session,
        )

    assert session.requests == [
        ("GET", "https://api.example/internal/v1/tool-access")
    ]


def test_load_env_file_does_not_override_existing_values(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "UPSCALER_TOOL_API_KEY=file-secret\nAURALENS_API_BASE_URL='https://api.example'\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("UPSCALER_TOOL_API_KEY", "process-secret")
    monkeypatch.delenv("AURALENS_API_BASE_URL", raising=False)

    load_env_file(env_file)

    assert os.environ["UPSCALER_TOOL_API_KEY"] == "process-secret"
    assert os.environ["AURALENS_API_BASE_URL"] == "https://api.example"
