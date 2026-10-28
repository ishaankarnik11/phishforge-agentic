"""Tests for /api/v1/emailers/{emailer_id}/versions endpoints (STORY-4.1).

Versions are inserted directly via the DB session (not through the generate
endpoint, which requires the AI pipeline).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.emailer_version import EmailerVersion

BASE_AUTH = "/api/v1/auth"
BASE_EMAILERS = "/api/v1/emailers"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _register_and_login(
    client: AsyncClient, email: str = "user@example.com"
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
            "name": "Test Emailer",
            "category": "offer",
            "target_audience": "All users",
            "content_summary": "A test emailer for version tests.",
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


async def _insert_version(
    db: AsyncSession,
    emailer_id: int,
    version_number: int,
    *,
    mjml_source: str = "<mjml><mj-body></mj-body></mjml>",
    compiled_html: str | None = "<html><body></body></html>",
    subject_line: str | None = "Test Subject",
    preheader: str | None = "Test Preheader",
    model_used: str | None = "claude-sonnet-4-20250514",
    input_tokens: int | None = 100,
    output_tokens: int | None = 200,
) -> EmailerVersion:
    """Insert a version directly into the DB and return it."""
    version = EmailerVersion(
        emailer_id=emailer_id,
        version_number=version_number,
        mjml_source=mjml_source,
        compiled_html=compiled_html,
        subject_line=subject_line,
        preheader=preheader,
        model_used=model_used,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return version


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/versions — list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_versions_empty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_versions_with_data(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    await _insert_version(db_session, emailer_id, 1, subject_line="V1 Subject")
    await _insert_version(db_session, emailer_id, 2, subject_line="V2 Subject")

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    # Sorted by version_number descending
    assert body[0]["version_number"] == 2
    assert body[1]["version_number"] == 1
    # Summary fields only
    assert body[0]["subject_line"] == "V2 Subject"
    assert "id" in body[0]
    assert "created_at" in body[0]
    # Full fields should NOT be present in summary
    assert "mjml_source" not in body[0]
    assert "compiled_html" not in body[0]


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/versions/latest
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_latest_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    await _insert_version(db_session, emailer_id, 1, subject_line="V1")
    await _insert_version(db_session, emailer_id, 2, subject_line="V2")
    await _insert_version(db_session, emailer_id, 3, subject_line="V3")

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/versions/latest",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["version_number"] == 3
    assert body["subject_line"] == "V3"
    assert body["emailer_id"] == emailer_id
    # Full fields should be present
    assert "mjml_source" in body
    assert "compiled_html" in body
    assert "preheader" in body
    assert "model_used" in body
    assert "input_tokens" in body
    assert "output_tokens" in body


@pytest.mark.asyncio
async def test_get_latest_version_no_versions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/versions/latest",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 404
    assert "No versions found" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/versions/{version_number}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_specific_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    await _insert_version(db_session, emailer_id, 1, subject_line="First Version")
    await _insert_version(db_session, emailer_id, 2, subject_line="Second Version")

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/versions/1",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["version_number"] == 1
    assert body["subject_line"] == "First Version"
    assert body["emailer_id"] == emailer_id
    assert "mjml_source" in body
    assert "compiled_html" in body


@pytest.mark.asyncio
async def test_get_nonexistent_version_number(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    await _insert_version(db_session, emailer_id, 1)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/versions/99",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 404
    assert "Version not found" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# 404 for nonexistent emailer
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_versions_nonexistent_emailer(client: AsyncClient) -> None:
    token = await _register_and_login(client)

    resp = await client.get(
        f"{BASE_EMAILERS}/9999/versions",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 404
    assert "Emailer not found" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_get_latest_nonexistent_emailer(client: AsyncClient) -> None:
    token = await _register_and_login(client)

    resp = await client.get(
        f"{BASE_EMAILERS}/9999/versions/latest",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 404
    assert "Emailer not found" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_get_version_nonexistent_emailer(client: AsyncClient) -> None:
    token = await _register_and_login(client)

    resp = await client.get(
        f"{BASE_EMAILERS}/9999/versions/1",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 404
    assert "Emailer not found" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# 404 for wrong user (cross-user isolation)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_versions_wrong_user(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """User B cannot see versions belonging to user A's emailer."""
    token_a = await _register_and_login(client, email="usera@example.com")
    token_b = await _register_and_login(client, email="userb@example.com")

    emailer_id = await _create_emailer(client, token_a)
    await _insert_version(db_session, emailer_id, 1)

    # B cannot list A's versions
    list_resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        headers=_auth_headers(token_b),
    )
    assert list_resp.status_code == 404

    # B cannot get latest of A's emailer
    latest_resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/versions/latest",
        headers=_auth_headers(token_b),
    )
    assert latest_resp.status_code == 404

    # B cannot get specific version of A's emailer
    version_resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/versions/1",
        headers=_auth_headers(token_b),
    )
    assert version_resp.status_code == 404


# ---------------------------------------------------------------------------
# Auth required
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_versions_requires_auth(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(f"{BASE_EMAILERS}/{emailer_id}/versions")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_latest_requires_auth(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(f"{BASE_EMAILERS}/{emailer_id}/versions/latest")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_version_requires_auth(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(f"{BASE_EMAILERS}/{emailer_id}/versions/1")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /emailers/{emailer_id}/versions — create version (STORY-4.2)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_version_first_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Creating a version when none exist should yield version_number=1."""
    token = await _register_and_login(client, email="creator@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": "<mjml><mj-body></mj-body></mjml>"},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["version_number"] == 1
    assert body["emailer_id"] == emailer_id
    assert body["mjml_source"] == "<mjml><mj-body></mj-body></mjml>"
    # model_used / input_tokens / output_tokens should be None for manual saves
    assert body["model_used"] is None
    assert body["input_tokens"] is None
    assert body["output_tokens"] is None


@pytest.mark.asyncio
async def test_create_version_auto_increments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Creating a version after existing ones should auto-increment."""
    token = await _register_and_login(client, email="inc@example.com")
    emailer_id = await _create_emailer(client, token)

    # Insert two versions via DB
    await _insert_version(db_session, emailer_id, 1)
    await _insert_version(db_session, emailer_id, 2)

    # POST should create version 3
    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={
            "mjml_source": "<mjml><mj-body><mj-section></mj-section></mj-body></mjml>"
        },
        headers=_auth_headers(token),
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["version_number"] == 3


@pytest.mark.asyncio
async def test_create_version_empty_mjml_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """An empty mjml_source should be rejected by validation."""
    token = await _register_and_login(client, email="empty@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": ""},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_version_nonexistent_emailer(
    client: AsyncClient,
) -> None:
    """POST to a non-existent emailer should return 404."""
    token = await _register_and_login(client, email="noexist@example.com")

    resp = await client.post(
        f"{BASE_EMAILERS}/9999/versions",
        json={"mjml_source": "<mjml><mj-body></mj-body></mjml>"},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 404
    assert "Emailer not found" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_version_wrong_user(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """User B cannot create a version on user A's emailer."""
    token_a = await _register_and_login(client, email="ownerA@example.com")
    token_b = await _register_and_login(client, email="otherB@example.com")
    emailer_id = await _create_emailer(client, token_a)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": "<mjml><mj-body></mj-body></mjml>"},
        headers=_auth_headers(token_b),
    )

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_version_requires_auth(client: AsyncClient) -> None:
    token = await _register_and_login(client, email="authpost@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": "<mjml><mj-body></mj-body></mjml>"},
    )

    assert resp.status_code == 401
