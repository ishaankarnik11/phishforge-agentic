"""Tests for /api/v1/auth endpoints (STORY-7.1)."""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from jose import jwt

from app.config import settings
from app.services.auth_service import ALGORITHM, create_access_token, hash_password

BASE = "/api/v1/auth"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _register(client: AsyncClient, email: str = "test@example.com") -> dict[str, str]:
    resp = await client.post(
        f"{BASE}/register",
        json={"email": email, "password": "securepass", "name": "Test User"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------
# POST /auth/register
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_happy_path(client: AsyncClient) -> None:
    data = await _register(client)
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    # Token must decode cleanly
    payload = jwt.decode(data["access_token"], settings.SECRET_KEY, algorithms=[ALGORITHM])
    assert "sub" in payload


@pytest.mark.asyncio
async def test_register_duplicate_email_returns_409(client: AsyncClient) -> None:
    await _register(client)
    resp = await client.post(
        f"{BASE}/register",
        json={"email": "test@example.com", "password": "anotherpass", "name": "Dupe"},
    )
    assert resp.status_code == 409
    assert "already registered" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_register_short_password_returns_422(client: AsyncClient) -> None:
    resp = await client.post(
        f"{BASE}/register",
        json={"email": "short@example.com", "password": "abc", "name": "Short"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_invalid_email_returns_422(client: AsyncClient) -> None:
    resp = await client.post(
        f"{BASE}/register",
        json={"email": "not-an-email", "password": "validpass123", "name": "Bad"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_correct_credentials(client: AsyncClient) -> None:
    await _register(client)
    resp = await client.post(
        f"{BASE}/login",
        json={"email": "test@example.com", "password": "securepass"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password_returns_401(client: AsyncClient) -> None:
    await _register(client)
    resp = await client.post(
        f"{BASE}/login",
        json={"email": "test@example.com", "password": "wrongpass"},
    )
    assert resp.status_code == 401
    assert "Invalid" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_login_unknown_email_returns_401(client: AsyncClient) -> None:
    resp = await client.post(
        f"{BASE}/login",
        json={"email": "nobody@example.com", "password": "somepass"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /auth/me
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_me_with_valid_token(client: AsyncClient) -> None:
    data = await _register(client)
    resp = await client.get(
        f"{BASE}/me",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "test@example.com"
    assert body["name"] == "Test User"
    assert body["role"] == "editor"
    assert "id" in body
    assert "created_at" in body
    # password_hash must never be exposed
    assert "password_hash" not in body


@pytest.mark.asyncio
async def test_me_no_token_returns_401(client: AsyncClient) -> None:
    resp = await client.get(f"{BASE}/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_invalid_token_returns_401(client: AsyncClient) -> None:
    resp = await client.get(
        f"{BASE}/me",
        headers={"Authorization": "Bearer this.is.not.valid"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_expired_token_returns_401(client: AsyncClient) -> None:
    """Forge a token with exp in the past."""
    expired_payload = {
        "sub": "999",
        "exp": datetime.now(tz=timezone.utc) - timedelta(hours=1),
    }
    expired_token = jwt.encode(expired_payload, settings.SECRET_KEY, algorithm=ALGORITHM)
    resp = await client.get(
        f"{BASE}/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /auth/logout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_logout_returns_200(client: AsyncClient) -> None:
    resp = await client.post(f"{BASE}/logout")
    assert resp.status_code == 200
    assert "Logged out" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Service-layer unit tests (not going through HTTP)
# ---------------------------------------------------------------------------


def test_password_hash_and_verify() -> None:
    from app.services.auth_service import verify_password

    hashed = hash_password("mysecret")
    assert verify_password("mysecret", hashed)
    assert not verify_password("wrong", hashed)


def test_create_and_decode_access_token() -> None:
    from app.services.auth_service import decode_access_token

    token = create_access_token(42)
    assert decode_access_token(token) == 42


def test_decode_invalid_token_raises() -> None:
    from jose import JWTError

    from app.services.auth_service import decode_access_token

    with pytest.raises(JWTError):
        decode_access_token("garbage.token.here")
