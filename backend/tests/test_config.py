"""STORY-7.7 — env-driven configuration tests.

These tests pin the deploy-posture contract of ``app.config.Settings``:

1. ``ALLOWED_ORIGINS`` parses a comma-separated string into a clean
   ``list[str]`` (whitespace stripped, empty entries dropped).
2. ``DATABASE_URL``, ``SECRET_KEY`` and ``ANTHROPIC_API_KEY`` are
   required without defaults — constructing ``Settings()`` in a clean
   env raises ``ValidationError``. This is the fail-fast prod behaviour.
3. The CORS middleware reflects whatever ``settings.ALLOWED_ORIGINS``
   is set to at app construction time (preflight smoke test).
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings

# ---------------------------------------------------------------------------
# Test fixture: build a fully-isolated env so ``Settings()`` doesn't pick up
# the developer's real ``backend/.env`` (which has every required key set,
# defeating the "no default = ValidationError" assertion).
# ---------------------------------------------------------------------------


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    """Wipe every Settings-relevant env var and chdir to a tmp dir without ``.env``.

    Pydantic-Settings will pick up ``backend/.env`` automatically when the
    test runner's CWD is the backend root. Switching CWD to a tmp dir AND
    deleting any matching env vars guarantees ``Settings()`` runs against
    a truly empty environment, which is the prod-startup analogue.
    """
    for var in (
        "DATABASE_URL",
        "SECRET_KEY",
        "ANTHROPIC_API_KEY",
        "ACCESS_TOKEN_EXPIRE_MINUTES",
        "LANGSMITH_API_KEY",
        "LANGSMITH_PROJECT",
        "FRONTEND_URL",
        "PUBLIC_BACKEND_URL",
        "ALLOWED_ORIGINS",
        "REFINER_MODEL",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.chdir(tmp_path)
    yield tmp_path


# ---------------------------------------------------------------------------
# 1. ALLOWED_ORIGINS parsing
# ---------------------------------------------------------------------------


class TestAllowedOriginsParsing:
    """The ``ALLOWED_ORIGINS`` validator must turn a comma-separated string
    into a clean ``list[str]`` regardless of whitespace or empty segments."""

    def _make(self, value: str) -> Settings:
        return Settings(  # type: ignore[call-arg]
            DATABASE_URL="sqlite+aiosqlite:///:memory:",
            SECRET_KEY="x",
            ANTHROPIC_API_KEY="y",
            ALLOWED_ORIGINS=value,
        )

    def test_simple_csv(self) -> None:
        s = self._make("a,b,c")
        assert s.ALLOWED_ORIGINS == ["a", "b", "c"]

    def test_two_domains(self) -> None:
        """The exact case the docstring promises."""
        s = self._make("a.com,b.com")
        assert s.ALLOWED_ORIGINS == ["a.com", "b.com"]

    def test_whitespace_stripped(self) -> None:
        s = self._make("  https://a.com ,\thttps://b.com  ")
        assert s.ALLOWED_ORIGINS == ["https://a.com", "https://b.com"]

    def test_empty_entries_filtered(self) -> None:
        s = self._make("a,,b, ,c")
        assert s.ALLOWED_ORIGINS == ["a", "b", "c"]

    def test_single_origin(self) -> None:
        s = self._make("https://only.example.com")
        assert s.ALLOWED_ORIGINS == ["https://only.example.com"]

    def test_list_passes_through(self) -> None:
        """Programmatic construction with a list (used by tests) bypasses splitting."""
        s = Settings(  # type: ignore[call-arg]
            DATABASE_URL="sqlite+aiosqlite:///:memory:",
            SECRET_KEY="x",
            ANTHROPIC_API_KEY="y",
            ALLOWED_ORIGINS=["https://a.com", "https://b.com"],
        )
        assert s.ALLOWED_ORIGINS == ["https://a.com", "https://b.com"]

    def test_csv_from_env_source(
        self,
        clean_env: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The actual prod path: a CSV string arriving via the env source.

        Without ``NoDecode`` on the field, pydantic-settings JSON-decodes
        ``list[str]`` env vars before the validator runs, which raises
        ``SettingsError`` on a plain CSV string. This test pins that the
        env-source path produces the same result as kwargs construction.
        Regression test for the first prod-image boot, which crashed with
        ``error parsing value for field "ALLOWED_ORIGINS"``.
        """
        monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
        monkeypatch.setenv("SECRET_KEY", "x")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "y")
        monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.com,https://b.com")
        s = Settings()  # type: ignore[call-arg]
        assert s.ALLOWED_ORIGINS == ["https://a.com", "https://b.com"]


# ---------------------------------------------------------------------------
# 2. Required-in-prod fields fail fast when missing
# ---------------------------------------------------------------------------


class TestRequiredFieldsFailFast:
    """STORY-7.7: a clean prod env (no ``.env``, no relevant env vars) must
    NOT silently fall back to placeholder defaults — Pydantic must raise."""

    def test_no_env_raises(self, clean_env: Path) -> None:
        with pytest.raises(ValidationError) as exc_info:
            Settings()  # type: ignore[call-arg]
        # All three should be flagged as missing.
        missing = {err["loc"][0] for err in exc_info.value.errors()}
        assert "DATABASE_URL" in missing
        assert "SECRET_KEY" in missing
        assert "ANTHROPIC_API_KEY" in missing

    def test_missing_database_url_raises(
        self, clean_env: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SECRET_KEY", "x")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "y")
        with pytest.raises(ValidationError) as exc_info:
            Settings()  # type: ignore[call-arg]
        assert any(err["loc"] == ("DATABASE_URL",) for err in exc_info.value.errors())

    def test_missing_secret_key_raises(
        self, clean_env: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "y")
        with pytest.raises(ValidationError) as exc_info:
            Settings()  # type: ignore[call-arg]
        assert any(err["loc"] == ("SECRET_KEY",) for err in exc_info.value.errors())

    def test_missing_anthropic_key_raises(
        self, clean_env: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
        monkeypatch.setenv("SECRET_KEY", "x")
        with pytest.raises(ValidationError) as exc_info:
            Settings()  # type: ignore[call-arg]
        assert any(
            err["loc"] == ("ANTHROPIC_API_KEY",) for err in exc_info.value.errors()
        )

    def test_all_three_present_succeeds(
        self, clean_env: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Sanity: with all three present, construction succeeds."""
        monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
        monkeypatch.setenv("SECRET_KEY", "x")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "y")
        s = Settings()  # type: ignore[call-arg]
        assert s.DATABASE_URL == "sqlite+aiosqlite:///:memory:"
        assert s.SECRET_KEY == "x"
        assert s.ANTHROPIC_API_KEY == "y"
        # And the dev defaults for the other URLs survive untouched.
        assert s.FRONTEND_URL == "http://localhost:5173"
        assert s.PUBLIC_BACKEND_URL == "http://localhost:8000"
        assert s.ALLOWED_ORIGINS == ["http://localhost:5173"]


# ---------------------------------------------------------------------------
# 3. CORS middleware reflects settings.ALLOWED_ORIGINS
# ---------------------------------------------------------------------------


def _make_cors_app(origins: list[str]) -> FastAPI:
    """Build a minimal FastAPI app wired with the same CORS pattern main.py uses.

    We deliberately don't import ``app.main`` here — that would pull in DB
    engines, routers, lifespan hooks etc. The contract under test is
    "CORSMiddleware honours whatever list it's handed", which is a
    middleware-level concern.
    """
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/ping")
    async def _ping() -> dict[str, str]:
        return {"ok": "yes"}

    return app


class TestCorsReflectsSettings:
    """Preflight smoke: an OPTIONS request from an allowed origin gets the
    matching ``Access-Control-Allow-Origin`` header back; a non-allowed
    origin gets nothing."""

    def test_allowed_origin_passes_preflight(self) -> None:
        app = _make_cors_app(["https://a.com", "https://b.com"])
        client = TestClient(app)
        r = client.options(
            "/ping",
            headers={
                "origin": "https://a.com",
                "access-control-request-method": "GET",
            },
        )
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "https://a.com"

    def test_other_listed_origin_passes_preflight(self) -> None:
        app = _make_cors_app(["https://a.com", "https://b.com"])
        client = TestClient(app)
        r = client.options(
            "/ping",
            headers={
                "origin": "https://b.com",
                "access-control-request-method": "GET",
            },
        )
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "https://b.com"

    def test_disallowed_origin_blocked(self) -> None:
        app = _make_cors_app(["https://a.com"])
        client = TestClient(app)
        r = client.options(
            "/ping",
            headers={
                "origin": "https://evil.example.com",
                "access-control-request-method": "GET",
            },
        )
        # CORS middleware does NOT echo the header back for unlisted origins.
        assert (
            r.headers.get("access-control-allow-origin") != "https://evil.example.com"
        )

    def test_settings_csv_string_drives_middleware(self) -> None:
        """End-to-end: a CSV env string flows through Settings → list → CORS."""
        s = Settings(  # type: ignore[call-arg]
            DATABASE_URL="sqlite+aiosqlite:///:memory:",
            SECRET_KEY="x",
            ANTHROPIC_API_KEY="y",
            ALLOWED_ORIGINS="https://prod.example.com, https://staging.example.com",
        )
        app = _make_cors_app(s.ALLOWED_ORIGINS)
        client = TestClient(app)
        r = client.options(
            "/ping",
            headers={
                "origin": "https://staging.example.com",
                "access-control-request-method": "GET",
            },
        )
        assert r.status_code == 200
        assert (
            r.headers.get("access-control-allow-origin")
            == "https://staging.example.com"
        )
