"""Tests for POST /api/v1/emailers/{emailer_id}/generate (STORY-3.1, STORY-3.4).

All AI pipeline calls are mocked so tests run fast and offline.

STORY-3.4: MJML compilation now happens inside the pipeline, so the endpoint
no longer calls ``compile_mjml`` directly.  The endpoint reads
``compiled_html`` from the ``GenerationResult``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.ai.schemas import GenerationResult

BASE_AUTH = "/api/v1/auth"
BASE_EMAILERS = "/api/v1/emailers"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_MJML = (
    "<mjml><mj-head></mj-head><mj-body><mj-section><mj-column>"
    "<mj-text>Hello</mj-text>"
    "</mj-column></mj-section></mj-body></mjml>"
)
SAMPLE_HTML = "<html><body><p>Hello</p></body></html>"


def _make_generation_result(**overrides: Any) -> GenerationResult:
    """Return a plausible GenerationResult with optional field overrides."""
    defaults: dict[str, Any] = {
        "subject_line": "Great offer inside!",
        "preheader": "Don't miss out on this deal",
        "mjml": SAMPLE_MJML,
        "compiled_html": SAMPLE_HTML,
        "model_used": "claude-sonnet-4-6",
        "input_tokens": 1200,
        "output_tokens": 800,
        "cache_read_tokens": 500,
        "cache_write_tokens": 100,
        "latency_ms": 2500,
        "warnings": [],
    }
    defaults.update(overrides)
    return GenerationResult(**defaults)


async def _register_and_login(
    client: AsyncClient, email: str = "gen@example.com"
) -> str:
    """Register a user and return a Bearer token."""
    resp = await client.post(
        f"{BASE_AUTH}/register",
        json={"email": email, "password": "strongpass123", "name": "Test User"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_emailer(client: AsyncClient, token: str) -> int:
    """Create a minimal emailer and return its ID."""
    resp = await client.post(
        BASE_EMAILERS,
        json={
            "name": "Pipeline Test",
            "category": "offer",
            "target_audience": "All users",
            "content_summary": "A test emailer for generate tests.",
            "tone": "professional",
            "length": "short",
            "impersonation_sender_name": "Acme Bank",
            "impersonation_sender_email": "alerts@acmebank-secure.example",
            "impersonation_pretends_to_be": "An official security alert.",
            "lure_type": "credential_harvest",
            "urgency_level": "high",
            "pretext_scenario": "account_security_alert",
        },
        headers=_auth_headers(token),
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Redirect file storage to a temp directory for test isolation."""
    import app.services.asset_storage as storage

    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_happy_path(client: AsyncClient) -> None:
    """Full happy path: pipeline succeeds with compiled HTML, version created."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    gen_result = _make_generation_result()

    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        return_value=gen_result,
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/generate",
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["version_number"] == 1
    assert body["subject_line"] == "Great offer inside!"
    assert body["preheader"] == "Don't miss out on this deal"
    assert body["mjml_source"] == SAMPLE_MJML
    assert body["compiled_html"] == SAMPLE_HTML
    assert body["model_used"] == "claude-sonnet-4-6"
    assert body["input_tokens"] == 1200
    assert body["output_tokens"] == 800
    # STORY-7.8 AC-1/AC-7: cache token fields surface on GenerateResponse so
    # the editor cost badge can show "saved $X via cache" without a follow-up
    # GET /emailers/{id}/cost round-trip.
    assert body["cache_read_tokens"] == 500
    assert body["cache_write_tokens"] == 100
    assert body["latency_ms"] == 2500
    assert body["warnings"] == []
    assert body["version_id"] > 0

    # Verify emailer status transitioned to in_review
    emailer_resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}",
        headers=_auth_headers(token),
    )
    assert emailer_resp.status_code == 200
    assert emailer_resp.json()["status"] == "in_review"


# ---------------------------------------------------------------------------
# Auth / ownership
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_requires_auth(client: AsyncClient) -> None:
    """Request without auth token returns 401."""
    resp = await client.post(f"{BASE_EMAILERS}/1/generate")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_generate_wrong_user(client: AsyncClient) -> None:
    """User B cannot generate for user A's emailer."""
    token_a = await _register_and_login(client, email="a@example.com")
    token_b = await _register_and_login(client, email="b@example.com")
    emailer_id = await _create_emailer(client, token_a)

    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        return_value=_make_generation_result(),
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/generate",
            headers=_auth_headers(token_b),
        )

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_generate_emailer_not_found(client: AsyncClient) -> None:
    """Generate on non-existent emailer returns 404."""
    token = await _register_and_login(client)

    resp = await client.post(
        f"{BASE_EMAILERS}/99999/generate",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Pipeline error
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_pipeline_error(client: AsyncClient) -> None:
    """When the AI pipeline raises, endpoint returns 500 with detail."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        side_effect=ValueError("Brand kit not found: bad-kit"),
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/generate",
            headers=_auth_headers(token),
        )

    assert resp.status_code == 500
    assert "Brand kit not found" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# MJML compile failure (now handled inside pipeline)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_mjml_compile_failure_in_pipeline(client: AsyncClient) -> None:
    """STORY-7.10 changed the contract: when the pipeline returned MJML
    without a compiled_html (e.g. its compile retry path failed), the
    save endpoint now re-runs ``sanitize_and_validate`` + ``compile_mjml``.

    If the MJML is *valid*, we end up with a successful row + non-null
    compiled_html — the previous "graceful degradation to None" behaviour
    is gone (it was the bug that motivated the story).  The pipeline's
    pre-existing warnings still surface in the response.
    """
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    gen_result = _make_generation_result(
        compiled_html=None,
        warnings=[
            "MJML compilation error: npx not found",
            "MJML compilation failed after all retry attempts. "
            "The MJML source is included but compiled HTML is unavailable.",
        ],
    )

    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        return_value=gen_result,
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/generate",
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Post-7.10: valid MJML always compiles to a non-empty HTML at save time.
    assert body["compiled_html"]
    assert body["mjml_source"] == SAMPLE_MJML
    # Pipeline-level warnings (npx-not-found from the pipeline retry path)
    # still propagate to the response.
    assert any("npx not found" in w for w in body["warnings"])
    assert body["version_number"] == 1


# ---------------------------------------------------------------------------
# Version numbering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_version_numbering(client: AsyncClient) -> None:
    """Second generate creates version 2, third creates version 3."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    gen_result = _make_generation_result()

    for expected_version in (1, 2, 3):
        with patch(
            "app.api.generate.generate_emailer",
            new_callable=AsyncMock,
            return_value=gen_result,
        ):
            resp = await client.post(
                f"{BASE_EMAILERS}/{emailer_id}/generate",
                headers=_auth_headers(token),
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["version_number"] == expected_version


# ---------------------------------------------------------------------------
# MJML renderer unit tests
# ---------------------------------------------------------------------------


# The renderer now uses temp-file I/O (BUG-6): it writes the MJML to a temp
# ``input.mjml``, runs ``npx mjml <input> -o <output.html>``, and reads the
# compiled HTML back from the output file (never from a stdout pipe, which
# corrupted UTF-8 on Windows). These mocks therefore drive behaviour through
# the output file + return code rather than through stdout bytes.


def _output_path_from_args(args: tuple[Any, ...]) -> Path | None:
    """Extract the ``-o <output.html>`` path the renderer passed to mjml."""
    str_args = [str(a) for a in args]
    if "-o" in str_args:
        idx = str_args.index("-o")
        if idx + 1 < len(str_args):
            return Path(str_args[idx + 1])
    return None


@pytest.mark.asyncio
async def test_mjml_renderer_success(monkeypatch: pytest.MonkeyPatch) -> None:
    """compile_mjml returns the HTML written to the output file on success."""
    import asyncio

    from app.mjml.renderer import compile_mjml

    async def mock_create_subprocess_exec(*args: Any, **kwargs: Any) -> AsyncMock:
        # Emulate mjml writing the compiled HTML to the -o output file.
        out = _output_path_from_args(args)
        assert out is not None, "renderer must pass an -o output path"
        out.write_text("<html>compiled</html>", encoding="utf-8")
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"", b""))
        proc.returncode = 0
        return proc

    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        mock_create_subprocess_exec,
    )

    result = await compile_mjml("<mjml>test</mjml>")
    assert result == "<html>compiled</html>"


@pytest.mark.asyncio
async def test_mjml_renderer_nonzero_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-zero exit code raises MjmlRendererError carrying stderr."""
    import asyncio

    from app.mjml.renderer import MjmlRendererError, compile_mjml

    async def mock_create_subprocess_exec(*args: Any, **kwargs: Any) -> AsyncMock:
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"", b"Error: invalid MJML"))
        proc.returncode = 1
        return proc

    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        mock_create_subprocess_exec,
    )

    with pytest.raises(MjmlRendererError, match="invalid MJML"):
        await compile_mjml("<mjml>bad</mjml>")


@pytest.mark.asyncio
async def test_mjml_renderer_npx_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """A missing npx is wrapped in MjmlRendererError with a helpful message."""
    import asyncio

    from app.mjml.renderer import MjmlRendererError, compile_mjml

    async def mock_create_subprocess_exec(*args: Any, **kwargs: Any) -> None:
        raise FileNotFoundError("npx")

    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        mock_create_subprocess_exec,
    )

    with pytest.raises(MjmlRendererError, match="npx is not installed"):
        await compile_mjml("<mjml>test</mjml>")


@pytest.mark.asyncio
async def test_mjml_renderer_empty_output(monkeypatch: pytest.MonkeyPatch) -> None:
    """A zero exit but no/empty output file raises MjmlRendererError."""
    import asyncio

    from app.mjml.renderer import MjmlRendererError, compile_mjml

    async def mock_create_subprocess_exec(*args: Any, **kwargs: Any) -> AsyncMock:
        # Exit 0 but never write the output file -> empty HTML.
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"", b""))
        proc.returncode = 0
        return proc

    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        mock_create_subprocess_exec,
    )

    with pytest.raises(MjmlRendererError, match="empty output"):
        await compile_mjml("<mjml>test</mjml>")


# ---------------------------------------------------------------------------
# Status transition: already in_review stays in_review
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_response_includes_cache_token_fields_with_zero_default(
    client: AsyncClient,
) -> None:
    """STORY-7.8 AC-1/AC-7: GenerateResponse exposes cache_read_tokens and
    cache_write_tokens. When the pipeline reports zero (e.g. no cache hits
    or cache misses on a cold start) the response still includes the fields
    with a value of 0, so the frontend can rely on them being present.
    """
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    gen_result = _make_generation_result(
        cache_read_tokens=0,
        cache_write_tokens=0,
    )

    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        return_value=gen_result,
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/generate",
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "cache_read_tokens" in body
    assert "cache_write_tokens" in body
    assert body["cache_read_tokens"] == 0
    assert body["cache_write_tokens"] == 0


@pytest.mark.asyncio
async def test_generate_already_in_review_stays(client: AsyncClient) -> None:
    """Generating again on an already in_review emailer does not change status."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    gen_result = _make_generation_result()

    # First generate: draft -> in_review
    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        return_value=gen_result,
    ):
        resp1 = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/generate",
            headers=_auth_headers(token),
        )
    assert resp1.status_code == 200

    # Verify in_review
    emailer_resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}", headers=_auth_headers(token)
    )
    assert emailer_resp.json()["status"] == "in_review"

    # Second generate: should still be in_review
    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        return_value=gen_result,
    ):
        resp2 = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/generate",
            headers=_auth_headers(token),
        )
    assert resp2.status_code == 200
    assert resp2.json()["version_number"] == 2

    emailer_resp2 = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}", headers=_auth_headers(token)
    )
    assert emailer_resp2.json()["status"] == "in_review"


# ---------------------------------------------------------------------------
# STORY-AP2.3 — sample-kind assets are NOT embedded in the generated email
# ---------------------------------------------------------------------------


_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00"
    b"\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def _upload(
    client: AsyncClient,
    token: str,
    emailer_id: int,
    filename: str,
    label: str,
    kind: str,
) -> str:
    """Upload one image asset with an explicit kind; return its id."""
    import io

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        files={"file": (filename, io.BytesIO(_TINY_PNG), "image/png")},
        data={"label": label, "kind": kind},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


@pytest.mark.asyncio
async def test_generate_excludes_sample_assets_from_asset_urls(
    client: AsyncClient,
) -> None:
    """A sample-kind asset must NOT appear in GenerationInput.asset_urls.

    The generate endpoint builds asset_urls (the in-email images injected as
    <mj-image>) from content-kind assets only, so a screenshot of the real
    email an auditor wants to mimic is never embedded into the lure. AP3.1
    consumes samples separately as vision input.
    """
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    await _upload(client, token, emailer_id, "logo.png", "Brand Logo", kind="content")
    await _upload(
        client, token, emailer_id, "real_email.png", "Real Email Sample", kind="sample"
    )

    gen_result = _make_generation_result()

    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        return_value=gen_result,
    ) as mock_generate:
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/generate",
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200, resp.text

    # Inspect the GenerationInput the endpoint built for the pipeline.
    gen_input = mock_generate.call_args.args[0]
    labels = {ref.label for ref in gen_input.asset_urls}
    assert "Brand Logo" in labels, "content asset should be embedded"
    assert "Real Email Sample" not in labels, "sample asset must NOT be embedded"
    assert len(gen_input.asset_urls) == 1
