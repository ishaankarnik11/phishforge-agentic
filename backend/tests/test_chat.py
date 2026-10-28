"""Tests for chat/refinement endpoints (STORY-4.3).

POST /api/v1/emailers/{emailer_id}/chat  -- send refinement message
GET  /api/v1/emailers/{emailer_id}/chat  -- list chat history

All AI refiner calls are mocked so tests run fast and offline.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.schemas import RefineResult

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
REFINED_MJML = (
    "<mjml><mj-head></mj-head><mj-body><mj-section><mj-column>"
    "<mj-text>Hello Festive!</mj-text>"
    "</mj-column></mj-section></mj-body></mjml>"
)
SAMPLE_HTML = "<html><body><p>Hello</p></body></html>"
REFINED_HTML = "<html><body><p>Hello Festive!</p></body></html>"


def _make_refine_result(**overrides: Any) -> RefineResult:
    """Return a plausible RefineResult with optional field overrides."""
    defaults: dict[str, Any] = {
        "mjml": REFINED_MJML,
        "compiled_html": REFINED_HTML,
        "summary": "Applied refinement: make the headline festive",
        "model_used": "claude-haiku-4-5",
        "input_tokens": 800,
        "output_tokens": 400,
        "latency_ms": 1200,
    }
    defaults.update(overrides)
    return RefineResult(**defaults)


async def _register_and_login(
    client: AsyncClient, email: str = "chat@example.com"
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
            "name": "Chat Test Emailer",
            "category": "offer",
            "target_audience": "All users",
            "content_summary": "A test emailer for chat tests.",
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


async def _generate_version(client: AsyncClient, token: str, emailer_id: int) -> None:
    """Generate a version so the emailer has MJML to refine."""
    from app.ai.schemas import GenerationResult

    gen_result = GenerationResult(
        subject_line="Test Subject",
        preheader="Test Preheader",
        mjml=SAMPLE_MJML,
        compiled_html=SAMPLE_HTML,
        model_used="claude-sonnet-4-6",
        input_tokens=1200,
        output_tokens=800,
        cache_read_tokens=500,
        latency_ms=2500,
        warnings=[],
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


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Redirect file storage to a temp directory for test isolation."""
    import app.services.asset_storage as storage

    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)


# ---------------------------------------------------------------------------
# POST /emailers/{emailer_id}/chat — happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_happy_path(client: AsyncClient) -> None:
    """POST chat: user message saved, refiner called, assistant message
    saved, new version created."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)
    await _generate_version(client, token, emailer_id)

    refine_result = _make_refine_result()

    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        return_value=refine_result,
    ) as mock_refine:
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/chat",
            json={"content": "Make the headline festive"},
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Check the assistant message
    assert body["message"]["role"] == "assistant"
    assert "festive" in body["message"]["content"].lower()
    assert body["message"]["emailer_id"] == emailer_id

    # Check the new version
    assert body["version"]["emailer_id"] == emailer_id
    assert body["version"]["version_number"] == 2  # after the initial generate
    assert body["version"]["mjml_source"] == REFINED_MJML
    assert body["version"]["compiled_html"] == REFINED_HTML

    # Check summary
    assert "festive" in body["summary"].lower()

    # Verify refiner was called with correct args
    mock_refine.assert_called_once()
    call_input = mock_refine.call_args[0][0]
    assert call_input.emailer_id == emailer_id
    assert call_input.instruction == "Make the headline festive"
    assert call_input.current_mjml == SAMPLE_MJML


# ---------------------------------------------------------------------------
# POST /emailers/{emailer_id}/chat — no version exists (400)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_no_version_returns_400(client: AsyncClient) -> None:
    """POST chat on an emailer with no generated version returns 400."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/chat",
        json={"content": "Make the headline festive"},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 400, resp.text
    assert "Generate" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# POST /emailers/{emailer_id}/chat — chat history passed to refiner
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_history_passed_to_refiner(client: AsyncClient) -> None:
    """After two chat rounds, the third round passes prior messages as history."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)
    await _generate_version(client, token, emailer_id)

    refine_result = _make_refine_result()

    # Round 1
    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        return_value=refine_result,
    ) as mock_r1:
        resp1 = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/chat",
            json={"content": "Change color to red"},
            headers=_auth_headers(token),
        )
    assert resp1.status_code == 200
    # First call should have no chat history
    r1_input = mock_r1.call_args[0][0]
    assert len(r1_input.chat_history) == 0

    # Round 2
    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        return_value=refine_result,
    ) as mock_r2:
        resp2 = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/chat",
            json={"content": "Also make it bigger"},
            headers=_auth_headers(token),
        )
    assert resp2.status_code == 200
    # Second call should have 2 history messages (user + assistant from round 1)
    r2_input = mock_r2.call_args[0][0]
    assert len(r2_input.chat_history) == 2
    assert r2_input.chat_history[0].role == "user"
    assert r2_input.chat_history[0].content == "Change color to red"
    assert r2_input.chat_history[1].role == "assistant"

    # Round 3
    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        return_value=refine_result,
    ) as mock_r3:
        resp3 = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/chat",
            json={"content": "Now add a footer"},
            headers=_auth_headers(token),
        )
    assert resp3.status_code == 200
    # Third call should have 4 history messages (2 from round 1 + 2 from round 2)
    r3_input = mock_r3.call_args[0][0]
    assert len(r3_input.chat_history) == 4


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/chat — list messages in order
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_chat_returns_messages_in_order(client: AsyncClient) -> None:
    """GET chat returns messages ordered by created_at asc."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)
    await _generate_version(client, token, emailer_id)

    refine_result = _make_refine_result()

    # Send two chat messages
    for content in ["First message", "Second message"]:
        with patch(
            "app.api.chat.refine_emailer",
            new_callable=AsyncMock,
            return_value=refine_result,
        ):
            resp = await client.post(
                f"{BASE_EMAILERS}/{emailer_id}/chat",
                json={"content": content},
                headers=_auth_headers(token),
            )
            assert resp.status_code == 200

    # GET chat history
    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/chat",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200
    messages = resp.json()

    # 2 rounds * 2 messages each (user + assistant) = 4
    assert len(messages) == 4
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "First message"
    assert messages[1]["role"] == "assistant"
    assert messages[2]["role"] == "user"
    assert messages[2]["content"] == "Second message"
    assert messages[3]["role"] == "assistant"


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/chat — empty history
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_chat_empty_history(client: AsyncClient) -> None:
    """GET chat for an emailer with no messages returns empty list."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/chat",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# Auth: 401 without token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_post_requires_auth(client: AsyncClient) -> None:
    """POST chat without auth token returns 401."""
    resp = await client.post(
        f"{BASE_EMAILERS}/1/chat",
        json={"content": "hello"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_chat_get_requires_auth(client: AsyncClient) -> None:
    """GET chat without auth token returns 401."""
    resp = await client.get(f"{BASE_EMAILERS}/1/chat")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Wrong user: 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_post_wrong_user(client: AsyncClient) -> None:
    """User B cannot POST chat to user A's emailer."""
    token_a = await _register_and_login(client, email="a@example.com")
    token_b = await _register_and_login(client, email="b@example.com")
    emailer_id = await _create_emailer(client, token_a)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/chat",
        json={"content": "hello"},
        headers=_auth_headers(token_b),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_chat_get_wrong_user(client: AsyncClient) -> None:
    """User B cannot GET chat for user A's emailer."""
    token_a = await _register_and_login(client, email="a2@example.com")
    token_b = await _register_and_login(client, email="b2@example.com")
    emailer_id = await _create_emailer(client, token_a)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/chat",
        headers=_auth_headers(token_b),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Refiner error: 500
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_refiner_error_returns_500(client: AsyncClient) -> None:
    """When the refiner raises, the endpoint returns 500."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)
    await _generate_version(client, token, emailer_id)

    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        side_effect=ValueError("Brand kit not found"),
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/chat",
            json={"content": "Make it red"},
            headers=_auth_headers(token),
        )

    assert resp.status_code == 500
    assert "Brand kit not found" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Validation: empty content
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_empty_content_returns_422(client: AsyncClient) -> None:
    """POST chat with empty content returns 422."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/chat",
        json={"content": ""},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Compilation warning when compiled_html is None
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Regression: reviewer `suggestion` rows must NOT reach the refiner
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_filters_suggestion_role_from_refiner_history(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Reviewer ``suggestion`` rows (STORY-4.5) must not be forwarded to the
    Anthropic messages API, which only accepts ``user``/``assistant``.

    Seeds a ``chat_messages`` row with ``role='suggestion'`` directly via the
    ORM (on the same session the request handler uses, per the test
    ``db_session`` fixture), then POSTs a chat refine request and asserts the
    mocked refiner received only allow-listed roles in
    ``call_input.chat_history``.
    """
    from app.models.chat_message import ChatMessage

    token = await _register_and_login(client, email="suggestion-filter@example.com")
    emailer_id = await _create_emailer(client, token)
    await _generate_version(client, token, emailer_id)

    # Seed a prior user/assistant turn plus a reviewer suggestion directly on
    # the shared test session. The `client` fixture overrides `get_db` to yield
    # the same `db_session`, so these inserts are visible to the request
    # handler in the same transaction.
    db_session.add(
        ChatMessage(emailer_id=emailer_id, role="user", content="earlier ask")
    )
    db_session.add(
        ChatMessage(emailer_id=emailer_id, role="assistant", content="earlier reply")
    )
    db_session.add(
        ChatMessage(
            emailer_id=emailer_id,
            role="suggestion",
            content="[Suggestion from Alice]: please tighten the CTA copy",
        )
    )
    await db_session.flush()

    refine_result = _make_refine_result()

    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        return_value=refine_result,
    ) as mock_refine:
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/chat",
            json={"content": "Now finalise it"},
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200, resp.text

    mock_refine.assert_called_once()
    call_input = mock_refine.call_args[0][0]

    # The refiner must never see a suggestion role.
    seen_roles = {m.role for m in call_input.chat_history}
    assert "suggestion" not in seen_roles, (
        f"Suggestion role leaked into refiner history: {seen_roles}"
    )

    # Only Anthropic-valid roles may appear in what we forward.
    assert seen_roles <= {"user", "assistant"}, (
        f"Unexpected roles forwarded to refiner: {seen_roles - {'user', 'assistant'}}"
    )

    # And the legitimate prior turns are preserved.
    assert any(
        m.role == "user" and m.content == "earlier ask" for m in call_input.chat_history
    )
    assert any(
        m.role == "assistant" and m.content == "earlier reply"
        for m in call_input.chat_history
    )


# ---------------------------------------------------------------------------
# Compilation warning when compiled_html is None
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_compilation_failure_warning(client: AsyncClient) -> None:
    """STORY-7.10 changed the contract: a refiner that returns MJML with
    ``compiled_html=None`` no longer leads to a saved row with null HTML.

    The save endpoint re-runs ``sanitize_and_validate`` + ``compile_mjml``,
    so if the MJML is valid the row ends up with non-null compiled HTML.
    The previous warning ("MJML compilation failed during refinement") is
    therefore not emitted in the success path.
    """
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)
    await _generate_version(client, token, emailer_id)

    refine_result = _make_refine_result(compiled_html=None)

    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        return_value=refine_result,
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/chat",
            json={"content": "Change the footer"},
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200
    body = resp.json()
    # Post-7.10: valid MJML compiles successfully on save, even if the
    # refiner stage couldn't.
    assert body["version"]["compiled_html"]
    # The legacy "compilation failed during refinement" warning must NOT
    # appear when the save-time recompile succeeded.
    assert not any("MJML compilation failed" in w for w in body["warnings"])
