"""Tests for chat-based asset reference (STORY-A5.4).

Covers:
- Refiner receives library assets in system prompt when assets exist
- Refiner system prompt has no asset section when no library assets
- Asset references are correctly formatted (name: URL pairs)
- Chat endpoint fetches library assets and passes to refiner
- Deleted assets are excluded
- RefineInput.library_assets field is populated correctly

All AI refiner calls are mocked so tests run fast and offline.
Uses real MySQL DB for the chat endpoint tests (via conftest fixtures).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import MODEL_HAIKU
from app.ai.refiner import refine_emailer
from app.ai.schemas import (
    AssetReference,
    LlmCallLogEntry,
    RefineInput,
    RefineResult,
)
from app.models.library_asset import (
    LibraryAsset,
    LibraryAssetVersion,
)
from app.models.user import User
from app.services.auth_service import hash_password
from app.services.mjml_sanitize import SanitizeResult

BASE_AUTH = "/api/v1/auth"
BASE_EMAILERS = "/api/v1/emailers"

# STORY-AP1.2 — inline impersonated identity, spread into RefineInput(...) in
# the unit tests below (replaces the removed ``brand_kit_id``).
_REFINE_IDENTITY: dict[str, str] = {
    "impersonation_sender_name": "Acme Bank",
    "impersonation_sender_email": "alerts@acmebank-secure.example",
    "impersonation_pretends_to_be": "An official Acme Bank security alert.",
    "lure_type": "credential_harvest",
    "urgency_level": "high",
}


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SAMPLE_MJML = (
    "<mjml><mj-head></mj-head><mj-body><mj-section><mj-column>"
    '<mj-image src="https://placeholder.com/hero.png" alt="Hero" />'
    "<mj-text>Hello</mj-text>"
    "</mj-column></mj-section></mj-body></mjml>"
)

REFINED_MJML = (
    "<mjml><mj-head></mj-head><mj-body><mj-section><mj-column>"
    '<mj-image src="/uploads/assets/1/diwali/v1.png" alt="Diwali Banner" />'
    "<mj-text>Hello</mj-text>"
    "</mj-column></mj-section></mj-body></mjml>"
)

SAMPLE_HTML = "<html><body><p>Hello</p></body></html>"

SAMPLE_LLM_RESPONSE = f"""\
SUBJECT: Test Subject
PREHEADER: Test preheader

{REFINED_MJML}"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ok_sanitize(mjml: str) -> SanitizeResult:
    return SanitizeResult(repaired_mjml=mjml, warnings=[], hard_errors=[])


def _make_log_entry(**overrides: object) -> LlmCallLogEntry:
    defaults = {
        "stage_name": "refiner",
        "emailer_id": 42,
        "model": MODEL_HAIKU,
        "input_tokens": 900,
        "output_tokens": 1800,
        "cache_read_tokens": 600,
        "cache_write_tokens": 0,
        "latency_ms": 1200,
        "success": True,
        "error_message": None,
        "called_at": datetime.now(tz=timezone.utc),
    }
    defaults.update(overrides)
    return LlmCallLogEntry(**defaults)  # type: ignore[arg-type]


def _make_refine_result(**overrides: Any) -> RefineResult:
    defaults: dict[str, Any] = {
        "mjml": REFINED_MJML,
        "compiled_html": SAMPLE_HTML,
        "summary": "Applied refinement: use Diwali banner as hero image",
        "model_used": "claude-haiku-4-5",
        "input_tokens": 800,
        "output_tokens": 400,
        "latency_ms": 1200,
    }
    defaults.update(overrides)
    return RefineResult(**defaults)


async def _register_and_login(
    client: AsyncClient, email: str = "asset-ref@example.com"
) -> str:
    resp = await client.post(
        f"{BASE_AUTH}/register",
        json={"email": email, "password": "strongpass123", "name": "Test User"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_emailer(client: AsyncClient, token: str) -> int:
    resp = await client.post(
        BASE_EMAILERS,
        json={
            "name": "Asset Ref Test Emailer",
            "category": "offer",
            "target_audience": "All users",
            "content_summary": "A test emailer for asset ref tests.",
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


async def _create_user(
    db: AsyncSession, email: str = "asset-ref-db@example.com"
) -> User:
    user = User(
        email=email,
        name="Asset Ref Tester",
        password_hash=hash_password("testpass"),
        role="editor",
    )
    db.add(user)
    await db.flush()
    return user


async def _create_library_asset(
    db: AsyncSession,
    user: User,
    *,
    name: str = "Diwali Banner",
    storage_path: str = "assets/1/diwali/v1.png",
    deleted: bool = False,
) -> LibraryAsset:
    """Create a library asset with one version (primary)."""
    asset_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())

    asset = LibraryAsset(
        id=asset_id,
        user_id=user.id,
        name=name,
        source="generated",
        primary_version_id=version_id,
        deleted_at=(datetime.now(tz=timezone.utc) if deleted else None),
    )
    db.add(asset)
    await db.flush()

    version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=1,
        storage_path=storage_path,
        width=600,
        height=300,
        file_size_bytes=12345,
        mime_type="image/png",
    )
    db.add(version)
    await db.flush()

    return asset


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Redirect file storage to a temp directory for test isolation."""
    import app.services.asset_storage as storage

    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)


# ---------------------------------------------------------------------------
# Unit tests: AssetReference schema
# ---------------------------------------------------------------------------


class TestAssetReferenceSchema:
    """Tests for the AssetReference Pydantic model."""

    def test_asset_reference_fields(self) -> None:
        ref = AssetReference(name="Diwali Banner", url="/uploads/assets/diwali.png")
        assert ref.name == "Diwali Banner"
        assert ref.url == "/uploads/assets/diwali.png"

    def test_refine_input_library_assets_default_empty(self) -> None:
        inp = RefineInput(
            emailer_id=1,
            **_REFINE_IDENTITY,
            current_mjml="<mjml></mjml>",
            instruction="Fix it",
        )
        assert inp.library_assets == []

    def test_refine_input_with_library_assets(self) -> None:
        assets = [
            AssetReference(name="Diwali Banner", url="/uploads/diwali.png"),
            AssetReference(name="Holi Splash", url="/uploads/holi.png"),
        ]
        inp = RefineInput(
            emailer_id=1,
            **_REFINE_IDENTITY,
            current_mjml="<mjml></mjml>",
            instruction="Use the Diwali banner",
            library_assets=assets,
        )
        assert len(inp.library_assets) == 2
        assert inp.library_assets[0].name == "Diwali Banner"
        assert inp.library_assets[1].url == "/uploads/holi.png"


# ---------------------------------------------------------------------------
# Unit tests: refiner prompt injection
# ---------------------------------------------------------------------------


class TestRefinerAssetContext:
    """Tests that the refiner system prompt includes asset references."""

    @pytest.fixture(autouse=True)
    def _mock_llm_and_compiler(self) -> None:  # type: ignore[return]
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.compile_mjml", mock_compile),
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
        ):
            mock_client.complete = mock_complete
            self.mock_complete = mock_complete
            yield

    async def test_system_prompt_includes_assets_when_provided(self) -> None:
        """When library_assets is non-empty, the system prompt contains the
        AVAILABLE LIBRARY ASSETS section with name: URL pairs."""
        inp = RefineInput(
            emailer_id=42,
            **_REFINE_IDENTITY,
            current_mjml=SAMPLE_MJML,
            instruction="Use the Diwali banner as the hero image",
            library_assets=[
                AssetReference(name="Diwali Banner", url="/uploads/assets/diwali.png"),
                AssetReference(name="Holi Splash", url="/uploads/assets/holi.png"),
            ],
        )
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "AVAILABLE LIBRARY ASSETS" in system
        assert "- Diwali Banner: /uploads/assets/diwali.png" in system
        assert "- Holi Splash: /uploads/assets/holi.png" in system

    async def test_system_prompt_no_asset_section_when_empty(self) -> None:
        """When library_assets is empty, the system prompt does NOT contain
        the AVAILABLE LIBRARY ASSETS section."""
        inp = RefineInput(
            emailer_id=42,
            **_REFINE_IDENTITY,
            current_mjml=SAMPLE_MJML,
            instruction="Make the headline festive",
            library_assets=[],
        )
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "AVAILABLE LIBRARY ASSETS" not in system

    async def test_system_prompt_no_asset_section_when_default(self) -> None:
        """When library_assets is omitted (default), the system prompt does NOT
        contain the AVAILABLE LIBRARY ASSETS section."""
        inp = RefineInput(
            emailer_id=42,
            **_REFINE_IDENTITY,
            current_mjml=SAMPLE_MJML,
            instruction="Make the headline festive",
        )
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "AVAILABLE LIBRARY ASSETS" not in system

    async def test_asset_section_includes_clarification_instruction(self) -> None:
        """The asset section instructs the LLM to ask for clarification on
        ambiguous references."""
        inp = RefineInput(
            emailer_id=42,
            **_REFINE_IDENTITY,
            current_mjml=SAMPLE_MJML,
            instruction="Use the banner",
            library_assets=[
                AssetReference(name="Banner A", url="/uploads/a.png"),
            ],
        )
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "ambiguous" in system.lower()
        assert "clarification" in system.lower()

    async def test_existing_prompt_structure_preserved_with_assets(self) -> None:
        """Adding assets does not break the existing RULES / OUTPUT FORMAT
        sections of the system prompt."""
        inp = RefineInput(
            emailer_id=42,
            **_REFINE_IDENTITY,
            current_mjml=SAMPLE_MJML,
            instruction="Use the banner",
            library_assets=[
                AssetReference(name="Banner", url="/uploads/banner.png"),
            ],
        )
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "RULES:" in system
        assert "OUTPUT FORMAT:" in system
        assert "ONLY the requested changes" in system
        assert "SUBJECT:" in system

    async def test_existing_prompt_structure_preserved_without_assets(self) -> None:
        """Without assets, the existing prompt structure is fully preserved."""
        inp = RefineInput(
            emailer_id=42,
            **_REFINE_IDENTITY,
            current_mjml=SAMPLE_MJML,
            instruction="Make it festive",
        )
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "RULES:" in system
        assert "OUTPUT FORMAT:" in system
        assert "ONLY the requested changes" in system


# ---------------------------------------------------------------------------
# Integration tests: chat endpoint with library assets (real MySQL DB)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_endpoint_passes_library_assets_to_refiner(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """POST chat: when library assets exist in the DB, RefineInput includes
    them in library_assets."""
    # Create a user + library asset directly on the DB session
    user = await _create_user(db_session)
    await _create_library_asset(
        db_session,
        user,
        name="Diwali Banner",
        storage_path="assets/1/diwali/v1.png",
    )
    await _create_library_asset(
        db_session,
        user,
        name="Holi Splash",
        storage_path="assets/1/holi/v1.png",
    )
    await db_session.flush()

    # Register + create emailer via API (uses a separate user from the
    # auth flow, but library assets are shared/global)
    token = await _register_and_login(client, email="chat-asset-test@example.com")
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
            json={"content": "Use the Diwali banner as the hero image"},
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200, resp.text

    mock_refine.assert_called_once()
    call_input = mock_refine.call_args[0][0]
    assert isinstance(call_input, RefineInput)
    assert len(call_input.library_assets) == 2

    # Assets should be ordered by name
    names = [a.name for a in call_input.library_assets]
    assert names == sorted(names)

    # URLs should include /uploads/ prefix
    for asset_ref in call_input.library_assets:
        assert asset_ref.url.startswith("/uploads/")


@pytest.mark.asyncio
async def test_chat_endpoint_excludes_deleted_assets(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Deleted library assets must NOT appear in RefineInput.library_assets."""
    user = await _create_user(db_session, email="deleted-asset@example.com")
    await _create_library_asset(
        db_session,
        user,
        name="Active Banner",
        storage_path="assets/1/active/v1.png",
        deleted=False,
    )
    await _create_library_asset(
        db_session,
        user,
        name="Deleted Banner",
        storage_path="assets/1/deleted/v1.png",
        deleted=True,
    )
    await db_session.flush()

    token = await _register_and_login(client, email="chat-deleted-test@example.com")
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
            json={"content": "Use the banner"},
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200, resp.text

    call_input = mock_refine.call_args[0][0]
    asset_names = [a.name for a in call_input.library_assets]
    assert "Active Banner" in asset_names
    assert "Deleted Banner" not in asset_names


@pytest.mark.asyncio
async def test_chat_endpoint_empty_library_assets_when_none_exist(
    client: AsyncClient,
) -> None:
    """When no library assets exist, RefineInput.library_assets is empty."""
    token = await _register_and_login(client, email="chat-no-assets@example.com")
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

    call_input = mock_refine.call_args[0][0]
    assert call_input.library_assets == []


@pytest.mark.asyncio
async def test_chat_endpoint_asset_url_format(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Asset URLs in RefineInput should be /uploads/{storage_path}."""
    user = await _create_user(db_session, email="url-format@example.com")
    await _create_library_asset(
        db_session,
        user,
        name="Test Image",
        storage_path="assets/42/test-img/v1.png",
    )
    await db_session.flush()

    token = await _register_and_login(client, email="chat-url-format@example.com")
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
            json={"content": "Use the test image"},
            headers=_auth_headers(token),
        )

    assert resp.status_code == 200, resp.text

    call_input = mock_refine.call_args[0][0]
    assert len(call_input.library_assets) >= 1
    test_asset = next(a for a in call_input.library_assets if a.name == "Test Image")
    assert test_asset.url == "/uploads/assets/42/test-img/v1.png"
