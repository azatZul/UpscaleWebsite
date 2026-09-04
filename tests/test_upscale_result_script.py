import os

import pytest
import requests

from scripts.upscale_result.upscale_result import (
    ToolError,
    create_share_url,
    load_env_file,
)


class FakeResponse:
    def __init__(self, *, status_code=200, payload=None):
        self.status_code = status_code
        self.payload = payload

    @property
    def ok(self):
        return self.status_code < 400

    def json(self):
        if self.payload is None:
            raise ValueError("No JSON")
        return self.payload


class FakeSession:
    def __init__(self, response=None):
        self.response = response or FakeResponse(
            status_code=201,
            payload={
                "result_id": "2d51c93a-af14-4ca8-a216-650885fd76bf",
                "result_url": "https://upscales.app/results/2d51c93a-af14-4ca8-a216-650885fd76bf",
            },
        )
        self.posts = []

    def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        return self.response


def _create(session, **overrides):
    arguments = {
        "image_url": "https://images.example/source.jpg",
        "retention_days": 7,
        "creativity": 0,
        "target_resolution": "4k",
        "api_base_url": "https://api.example",
        "api_key": "secret",
        "allow_http": False,
        "poll_timeout": 360,
        "session": session,
    }
    arguments.update(overrides)
    return create_share_url(**arguments)


def test_create_share_url_sends_one_creative_upscale_request():
    session = FakeSession()

    result_url = _create(
        session,
        retention_days=3,
        creativity=2,
        target_resolution="8k",
    )

    assert result_url.endswith("2d51c93a-af14-4ca8-a216-650885fd76bf")
    assert len(session.posts) == 1
    url, request = session.posts[0]
    assert url == "https://api.example/internal/v1/results"
    assert request["json"] == {
        "image_url": "https://images.example/source.jpg",
        "flow": "creative-upscale",
        "retention_days": 3,
        "creativity": 2,
        "target_resolution": "8k",
    }
    assert request["headers"]["Authorization"] == "Bearer secret"
    assert request["headers"]["Idempotency-Key"].startswith("creative-upscale-")
    assert request["timeout"] == (10, 360)


def test_create_share_url_sends_one_photo_restoration_request():
    session = FakeSession()

    result_url = _create(
        session,
        flow="photo-restoration",
        output_format="png",
        safety_tolerance=1,
        seed=8675309,
    )

    assert result_url.endswith("2d51c93a-af14-4ca8-a216-650885fd76bf")
    assert len(session.posts) == 1
    _, request = session.posts[0]
    assert request["json"] == {
        "image_url": "https://images.example/source.jpg",
        "flow": "photo-restoration",
        "retention_days": 7,
        "output_format": "png",
        "safety_tolerance": 1,
        "seed": 8675309,
    }
    assert request["headers"]["Authorization"] == "Bearer secret"
    assert request["headers"]["Idempotency-Key"].startswith("photo-restoration-")


def test_create_share_url_reports_authentication_failure_from_the_only_request():
    session = FakeSession(
        FakeResponse(
            status_code=401,
            payload={"detail": "Invalid tool API key"},
        )
    )

    with pytest.raises(ToolError, match="Invalid tool API key"):
        _create(session)

    assert len(session.posts) == 1
    assert session.posts[0][0].endswith("/internal/v1/results")


def test_create_share_url_requires_https_by_default():
    session = FakeSession()

    with pytest.raises(ToolError, match="HTTPS"):
        _create(session, image_url="http://images.example/source.jpg")

    assert session.posts == []


def test_create_share_url_wraps_network_errors():
    class FailingSession(FakeSession):
        def post(self, url, **kwargs):
            raise requests.ConnectionError("offline")

    with pytest.raises(ToolError, match="Could not create result"):
        _create(FailingSession())


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
