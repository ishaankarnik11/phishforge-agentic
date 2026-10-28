"""Tests for the shared preview link endpoints (STORY-4.5).

Covers both owner-side and public-side routes:

* POST/GET/DELETE ``/api/v1/emailers/{id}/preview-links``
* GET  ``/api/v1/public/preview/{token}``
* POST ``/api/v1/public/preview/{token}/suggest``

All tests run against the shared MySQL test DB from ``conftest.py``.
No external services are hit — the public endpoints don't touch
Anthropic at all, and brand kits are loaded from the checked-in JSON
files.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_message import ChatMessage
from app.models.emailer_version import EmailerVersion
from app.models.preview_link import PreviewLink

BASE_AUTH = "/api/v1/auth"
BASE_EMAILERS = "/api/v1/emailers"
BASE_PUBLIC = "/api/v1/public/preview"


def _parse_dt_utc(iso_string: str) -> datetime:
    """Parse an ISO datetime and coerce it to a UTC-aware datetime.

    MySQL ``DATETIME`` columns round-trip as naive; SQLAlchemy's
    ``DateTime(timezone=True)`` is best-effort there. This helper keeps
    tests portable whether the backend returns naive or aware ISO
    strings.
    """
    dt = datetime.fromisoformat(iso_string)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _register_and_login(
    client: AsyncClient, email: str = "owner@example.com"
) -> str:
    resp = await client.post(
        f"{BASE_AUTH}/register",
        json={"email": email, "password": "strongpass123", "name": "Owner"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_emailer(client: AsyncClient, token: str) -> int:
    resp = await client.post(
        BASE_EMAILERS,
        json={
            "name": "Preview Link Test",
            "category": "offer",
            "target_audience": "All users",
            "content_summary": "A test emailer for preview-link tests.",
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


async def _add_version(
    db_session: AsyncSession,
    emailer_id: int,
    *,
    version_number: int = 1,
    subject: str = "Hello World",
    html: str | None = "<html><body>v1</body></html>",
) -> EmailerVersion:
    """Insert an EmailerVersion row directly via the session."""
    version = EmailerVersion(
        emailer_id=emailer_id,
        version_number=version_number,
        mjml_source="<mjml></mjml>",
        compiled_html=html,
        subject_line=subject,
        preheader="Test preheader",
        source="generation",
    )
    db_session.add(version)
    await db_session.flush()
    return version


# ---------------------------------------------------------------------------
# Owner-side: POST /emailers/{id}/preview-links
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_preview_link_defaults(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Default body yields a 7-day link that follows the latest version."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)
    await _add_version(db_session, emailer_id)
    await db_session.commit()

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()

    assert body["emailer_id"] == emailer_id
    assert body["version_id"] is None
    assert len(body["token"]) == 64
    assert body["url"].endswith(f"/share/{body['token']}")

    expires = _parse_dt_utc(body["expires_at"])
    delta = expires - datetime.now(timezone.utc)
    # Should be ~7 days; allow slack for test latency and MySQL second-resolution.
    assert timedelta(days=6, hours=23) < delta <= timedelta(days=7, minutes=5)


@pytest.mark.asyncio
async def test_create_preview_link_custom_expiry_and_pin(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """expires_in_days and version_id are honoured."""
    token = await _register_and_login(client, email="pin@example.com")
    emailer_id = await _create_emailer(client, token)
    v1 = await _add_version(db_session, emailer_id, version_number=1)
    await db_session.commit()

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        json={"expires_in_days": 14, "version_id": v1.id},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["version_id"] == v1.id

    expires = _parse_dt_utc(body["expires_at"])
    delta = expires - datetime.now(timezone.utc)
    assert timedelta(days=13, hours=23) < delta <= timedelta(days=14, minutes=5)


@pytest.mark.asyncio
async def test_create_preview_link_rejects_out_of_range_expiry(
    client: AsyncClient,
) -> None:
    """expires_in_days above cap is rejected by Pydantic with 422."""
    token = await _register_and_login(client, email="cap@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        json={"expires_in_days": 90},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_preview_link_requires_auth(client: AsyncClient) -> None:
    resp = await client.post(f"{BASE_EMAILERS}/1/preview-links")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_preview_link_non_owner_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """User B cannot create a link for user A's emailer."""
    token_a = await _register_and_login(client, email="a@example.com")
    token_b = await _register_and_login(client, email="b@example.com")
    emailer_id = await _create_emailer(client, token_a)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token_b),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_preview_link_rejects_foreign_version_id(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Pinning a version that belongs to a different emailer is rejected."""
    token_a = await _register_and_login(client, email="own@example.com")
    emailer_a = await _create_emailer(client, token_a)
    # Second emailer owned by same user with its own version
    other_resp = await client.post(
        BASE_EMAILERS,
        json={
            "name": "Other",
            "category": "offer",
            "target_audience": "All",
            "content_summary": "other",
            "tone": "professional",
            "length": "short",
            "impersonation_sender_name": "Acme Bank",
            "impersonation_sender_email": "alerts@acmebank-secure.example",
            "impersonation_pretends_to_be": "An official security alert.",
            "lure_type": "credential_harvest",
            "urgency_level": "high",
            "pretext_scenario": "account_security_alert",
        },
        headers=_auth_headers(token_a),
    )
    emailer_b = int(other_resp.json()["id"])
    v_b = await _add_version(db_session, emailer_b, version_number=1)
    await db_session.commit()

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_a}/preview-links",
        json={"version_id": v_b.id},
        headers=_auth_headers(token_a),
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Owner-side: GET /emailers/{id}/preview-links
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_preview_links_filters_expired(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Expired links are hidden; active ones are returned newest-first."""
    token = await _register_and_login(client, email="list@example.com")
    emailer_id = await _create_emailer(client, token)
    await _add_version(db_session, emailer_id)

    # Insert one active and one already-expired link directly.
    now = datetime.now(timezone.utc)
    active = PreviewLink(
        emailer_id=emailer_id,
        token="a" * 64,
        version_id=None,
        created_by=None,
        expires_at=now + timedelta(days=7),
    )
    expired = PreviewLink(
        emailer_id=emailer_id,
        token="b" * 64,
        version_id=None,
        created_by=None,
        expires_at=now - timedelta(days=1),
    )
    db_session.add_all([active, expired])
    await db_session.commit()

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    tokens = [r["token"] for r in rows]
    assert "a" * 64 in tokens
    assert "b" * 64 not in tokens


@pytest.mark.asyncio
async def test_list_preview_links_non_owner_404(
    client: AsyncClient,
) -> None:
    token_a = await _register_and_login(client, email="la@example.com")
    token_b = await _register_and_login(client, email="lb@example.com")
    emailer_id = await _create_emailer(client, token_a)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token_b),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Owner-side: DELETE /emailers/{id}/preview-links/{token}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_preview_link(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Revocation makes the public endpoint return 404."""
    token = await _register_and_login(client, email="revoke@example.com")
    emailer_id = await _create_emailer(client, token)
    await _add_version(db_session, emailer_id)
    await db_session.commit()

    create = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token),
    )
    link_token = create.json()["token"]

    # Public endpoint works BEFORE revocation.
    pre = await client.get(f"{BASE_PUBLIC}/{link_token}")
    assert pre.status_code == 200

    # Revoke
    delete = await client.delete(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links/{link_token}",
        headers=_auth_headers(token),
    )
    assert delete.status_code == 204

    # Public endpoint now 404s
    post = await client.get(f"{BASE_PUBLIC}/{link_token}")
    assert post.status_code == 404


@pytest.mark.asyncio
async def test_revoke_preview_link_non_owner_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token_a = await _register_and_login(client, email="ra@example.com")
    token_b = await _register_and_login(client, email="rb@example.com")
    emailer_id = await _create_emailer(client, token_a)
    await _add_version(db_session, emailer_id)
    await db_session.commit()

    create = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token_a),
    )
    link_token = create.json()["token"]

    resp = await client.delete(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links/{link_token}",
        headers=_auth_headers(token_b),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_revoke_unknown_token_returns_404(
    client: AsyncClient,
) -> None:
    token = await _register_and_login(client, email="unk@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.delete(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links/nonexistent",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Public: GET /public/preview/{token}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_preview_follow_latest(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """An unpinned link always resolves to the current (latest) version."""
    token = await _register_and_login(client, email="pub@example.com")
    emailer_id = await _create_emailer(client, token)

    await _add_version(
        db_session,
        emailer_id,
        version_number=1,
        subject="v1 subject",
        html="<html>v1</html>",
    )
    await db_session.commit()

    create = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token),
    )
    link_token = create.json()["token"]

    # Fetch while v1 is latest
    resp1 = await client.get(f"{BASE_PUBLIC}/{link_token}")
    assert resp1.status_code == 200, resp1.text
    body1 = resp1.json()
    assert body1["version_number"] == 1
    assert body1["subject_line"] == "v1 subject"
    assert "v1" in body1["compiled_html"]
    assert body1["emailer_name"] == "Preview Link Test"
    # STORY-AP1.2: the preview frame now carries the emailer's inline
    # impersonated identity (replaces the old brand_kit payload).
    assert body1["identity"]["name"] == "Acme Bank"

    # Add v2 and confirm the same link now shows v2
    await _add_version(
        db_session,
        emailer_id,
        version_number=2,
        subject="v2 subject",
        html="<html>v2</html>",
    )
    await db_session.commit()

    resp2 = await client.get(f"{BASE_PUBLIC}/{link_token}")
    assert resp2.status_code == 200
    body2 = resp2.json()
    assert body2["version_number"] == 2
    assert body2["subject_line"] == "v2 subject"


@pytest.mark.asyncio
async def test_public_preview_pinned_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A pinned link keeps showing the pinned version even after new ones."""
    token = await _register_and_login(client, email="pin2@example.com")
    emailer_id = await _create_emailer(client, token)
    v1 = await _add_version(
        db_session, emailer_id, version_number=1, subject="v1", html="<v1/>"
    )
    await db_session.commit()

    create = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        json={"version_id": v1.id},
        headers=_auth_headers(token),
    )
    link_token = create.json()["token"]

    # Add v2 AFTER creating the pinned link.
    await _add_version(
        db_session, emailer_id, version_number=2, subject="v2", html="<v2/>"
    )
    await db_session.commit()

    resp = await client.get(f"{BASE_PUBLIC}/{link_token}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version_number"] == 1
    assert body["subject_line"] == "v1"


@pytest.mark.asyncio
async def test_public_preview_expired_link_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """An expired link returns a neutral 404 (same shape as unknown)."""
    token = await _register_and_login(client, email="exp@example.com")
    emailer_id = await _create_emailer(client, token)
    await _add_version(db_session, emailer_id)

    expired = PreviewLink(
        emailer_id=emailer_id,
        token="c" * 64,
        version_id=None,
        created_by=None,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db_session.add(expired)
    await db_session.commit()

    resp = await client.get(f"{BASE_PUBLIC}/{'c' * 64}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_public_preview_unknown_token_returns_404(
    client: AsyncClient,
) -> None:
    resp = await client.get(f"{BASE_PUBLIC}/definitely-not-a-real-token")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_public_preview_no_version_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Link on an emailer with zero versions 404s (nothing to show)."""
    token = await _register_and_login(client, email="nov@example.com")
    emailer_id = await _create_emailer(client, token)

    link = PreviewLink(
        emailer_id=emailer_id,
        token="d" * 64,
        version_id=None,
        created_by=None,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db_session.add(link)
    await db_session.commit()

    resp = await client.get(f"{BASE_PUBLIC}/{'d' * 64}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_public_preview_requires_no_auth(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Public endpoint explicitly does NOT require a Bearer token."""
    token = await _register_and_login(client, email="noauth@example.com")
    emailer_id = await _create_emailer(client, token)
    await _add_version(db_session, emailer_id)
    await db_session.commit()

    create = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token),
    )
    link_token = create.json()["token"]

    # Fetch WITHOUT Authorization header
    resp = await client.get(f"{BASE_PUBLIC}/{link_token}")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Public: POST /public/preview/{token}/suggest
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_suggest_writes_chat_message(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A successful suggestion inserts a chat_messages row with role=suggestion."""
    token = await _register_and_login(client, email="sug@example.com")
    emailer_id = await _create_emailer(client, token)
    version = await _add_version(db_session, emailer_id)
    await db_session.commit()

    create = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token),
    )
    link_token = create.json()["token"]

    resp = await client.post(
        f"{BASE_PUBLIC}/{link_token}/suggest",
        json={"text": "Please change the CTA color", "reviewer_name": "Priya"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["role"] == "suggestion"
    assert body["emailer_id"] == emailer_id
    assert body["version_id"] == version.id
    assert body["content"].startswith("[Suggestion from Priya]: ")
    assert "change the CTA color" in body["content"]

    # Verify DB state
    result = await db_session.execute(
        select(ChatMessage).where(ChatMessage.emailer_id == emailer_id)
    )
    rows = list(result.scalars().all())
    assert len(rows) == 1
    assert rows[0].role == "suggestion"
    assert rows[0].version_id == version.id


@pytest.mark.asyncio
async def test_public_suggest_without_reviewer_name(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Omitting reviewer_name stores the raw text unprefixed."""
    token = await _register_and_login(client, email="raw@example.com")
    emailer_id = await _create_emailer(client, token)
    await _add_version(db_session, emailer_id)
    await db_session.commit()

    create = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token),
    )
    link_token = create.json()["token"]

    resp = await client.post(
        f"{BASE_PUBLIC}/{link_token}/suggest",
        json={"text": "Looks great!"},
    )
    assert resp.status_code == 201
    assert resp.json()["content"] == "Looks great!"


@pytest.mark.asyncio
async def test_public_suggest_length_cap_enforced(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """text over 5000 chars is rejected with 422 (Pydantic validation)."""
    token = await _register_and_login(client, email="cap2@example.com")
    emailer_id = await _create_emailer(client, token)
    await _add_version(db_session, emailer_id)
    await db_session.commit()

    create = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token),
    )
    link_token = create.json()["token"]

    resp = await client.post(
        f"{BASE_PUBLIC}/{link_token}/suggest",
        json={"text": "x" * 5001},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_public_suggest_empty_text_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Whitespace-only text is rejected by the validator."""
    token = await _register_and_login(client, email="empty@example.com")
    emailer_id = await _create_emailer(client, token)
    await _add_version(db_session, emailer_id)
    await db_session.commit()

    create = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/preview-links",
        headers=_auth_headers(token),
    )
    link_token = create.json()["token"]

    resp = await client.post(
        f"{BASE_PUBLIC}/{link_token}/suggest",
        json={"text": "   \n  "},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_public_suggest_expired_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Suggesting against an expired token returns the neutral 404."""
    token = await _register_and_login(client, email="expsug@example.com")
    emailer_id = await _create_emailer(client, token)
    await _add_version(db_session, emailer_id)

    expired = PreviewLink(
        emailer_id=emailer_id,
        token="e" * 64,
        version_id=None,
        created_by=None,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db_session.add(expired)
    await db_session.commit()

    resp = await client.post(
        f"{BASE_PUBLIC}/{'e' * 64}/suggest",
        json={"text": "hi"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_public_suggest_unknown_token_404(
    client: AsyncClient,
) -> None:
    resp = await client.post(
        f"{BASE_PUBLIC}/not-a-token/suggest",
        json={"text": "hi"},
    )
    assert resp.status_code == 404
