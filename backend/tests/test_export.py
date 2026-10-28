"""Tests for GET /api/v1/emailers/{emailer_id}/export (STORY-5.1, 5.3, AP6.1).

Validates:
- Export success with correct Content-Disposition and filename
- No version -> 400
- No compiled HTML -> 400
- Auth required -> 401
- Wrong user -> 404
- Filename format convention
- STORY-AP6.1: exported HTML is the compiled HTML verbatim — NO simulation
  marker. The body must not contain "PhishForge", "Export Metadata", the
  creator email, or any metadata comment block.
- STORY-5.3: First export transitions status to "exported" and sets exported_at
- STORY-5.3: Second export keeps same status and exported_at unchanged
- STORY-5.1 AC-3: exported HTML has no data: URLs; image src values are
  absolute (http(s)://...). Bloated base64 images are stripped by Outlook
  and balloon email size, so we hard-fail any regression here.
"""

from __future__ import annotations

import re
import shutil
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.export import _slugify, build_export_filename
from app.mjml.renderer import compile_mjml
from app.models.emailer import Emailer
from app.models.emailer_version import EmailerVersion


def _mjml_available() -> bool:
    return bool(shutil.which("npx") and shutil.which("mjml"))


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


async def _create_emailer(
    client: AsyncClient,
    token: str,
    name: str = "Q4 Campaign",
) -> int:
    """Create a minimal emailer and return its ID."""
    resp = await client.post(
        BASE_EMAILERS,
        json={
            "name": name,
            "category": "offer",
            "target_audience": "All users",
            "content_summary": "A test emailer for export tests.",
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
    compiled_html: str | None = "<html><body>Hello</body></html>",
) -> EmailerVersion:
    """Insert a version directly into the DB and return it."""
    version = EmailerVersion(
        emailer_id=emailer_id,
        version_number=version_number,
        mjml_source="<mjml><mj-body></mj-body></mjml>",
        compiled_html=compiled_html,
        subject_line="Test Subject",
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return version


# ---------------------------------------------------------------------------
# Unit tests for helpers
# ---------------------------------------------------------------------------


class TestSlugify:
    def test_basic(self) -> None:
        assert _slugify("Q4 Campaign") == "q4-campaign"

    def test_special_chars(self) -> None:
        assert _slugify("Hello! World@#$%") == "hello-world"

    def test_multiple_spaces(self) -> None:
        assert _slugify("Multiple   Spaces   Here") == "multiple-spaces-here"

    def test_leading_trailing_spaces(self) -> None:
        assert _slugify("  trimmed  ") == "trimmed"

    def test_hyphens_preserved(self) -> None:
        assert _slugify("already-slugged") == "already-slugged"

    def test_numbers(self) -> None:
        assert _slugify("Test 123 Name") == "test-123-name"


class TestBuildExportFilename:
    def test_format(self) -> None:
        filename = build_export_filename("Q4 Campaign", 3)
        today = datetime.now(tz=timezone.utc).strftime("%Y%m%d")
        assert filename == f"q4-campaign_v3_{today}.html"

    def test_special_chars_in_name(self) -> None:
        filename = build_export_filename("Big Sale!!!", 1)
        today = datetime.now(tz=timezone.utc).strftime("%Y%m%d")
        assert filename == f"big-sale_v1_{today}.html"

    def test_pattern_matches(self) -> None:
        filename = build_export_filename("Some Name", 10)
        # STORY-AP1.2: brand_kit prefix dropped — {slug}_v{num}_{YYYYMMDD}.html
        pattern = r"^[a-z0-9-]+_v\d+_\d{8}\.html$"
        assert re.match(pattern, filename), (
            f"Filename {filename!r} does not match convention"
        )


# ---------------------------------------------------------------------------
# Export success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_success(client: AsyncClient, db_session: AsyncSession) -> None:
    """Export returns HTML file with correct Content-Disposition header."""
    token = await _register_and_login(client, email="export@example.com")
    emailer_id = await _create_emailer(client, token)
    html_content = "<html><body>Exported Email</body></html>"
    await _insert_version(db_session, emailer_id, 1, compiled_html=html_content)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    # STORY-AP6.1: body is the compiled HTML verbatim, no prepended marker.
    assert resp.text == html_content
    assert "PhishForge" not in resp.text
    assert "<!--" not in resp.text
    assert resp.headers["content-type"] == "text/html; charset=utf-8"

    # Check Content-Disposition header
    disposition = resp.headers["content-disposition"]
    assert disposition.startswith("attachment; filename=")

    # Extract and validate filename
    filename = disposition.split("filename=")[1].strip('"')
    today = datetime.now(tz=timezone.utc).strftime("%Y%m%d")
    assert filename == f"q4-campaign_v1_{today}.html"


@pytest.mark.asyncio
async def test_export_uses_latest_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """When multiple versions exist, export returns the latest one."""
    token = await _register_and_login(client, email="latest@example.com")
    emailer_id = await _create_emailer(client, token)
    await _insert_version(db_session, emailer_id, 1, compiled_html="<html>V1</html>")
    await _insert_version(db_session, emailer_id, 2, compiled_html="<html>V2</html>")

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    # STORY-AP6.1: body is exactly the latest version's compiled HTML.
    assert resp.text == "<html>V2</html>"
    assert "<!--" not in resp.text
    # Filename should reference v2
    disposition = resp.headers["content-disposition"]
    filename = disposition.split("filename=")[1].strip('"')
    assert "_v2_" in filename


# ---------------------------------------------------------------------------
# Error: no version exists -> 400
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_no_version_returns_400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client, email="noversion@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 400
    assert "No version exists" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Error: no compiled HTML -> 400
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_no_compiled_html_returns_400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client, email="nohtml@example.com")
    emailer_id = await _create_emailer(client, token)
    await _insert_version(db_session, emailer_id, 1, compiled_html=None)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 400
    assert "No compiled HTML available" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Auth required -> 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_requires_auth(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client, email="authreq@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(f"{BASE_EMAILERS}/{emailer_id}/export")

    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Wrong user -> 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_wrong_user_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token_a = await _register_and_login(client, email="ownerA@example.com")
    token_b = await _register_and_login(client, email="otherB@example.com")
    emailer_id = await _create_emailer(client, token_a)
    await _insert_version(db_session, emailer_id, 1)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token_b),
    )

    assert resp.status_code == 404
    assert "Emailer not found" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Nonexistent emailer -> 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_nonexistent_emailer_returns_404(
    client: AsyncClient,
) -> None:
    token = await _register_and_login(client, email="nonexist@example.com")

    resp = await client.get(
        f"{BASE_EMAILERS}/9999/export",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 404
    assert "Emailer not found" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Filename format validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_filename_format(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Filename follows convention: {slug}_v{version}_{YYYYMMDD}.html."""
    token = await _register_and_login(client, email="fname@example.com")
    emailer_id = await _create_emailer(client, token, name="Special Offer! #42")
    await _insert_version(db_session, emailer_id, 5)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    disposition = resp.headers["content-disposition"]
    filename = disposition.split("filename=")[1].strip('"')

    # Validate the pattern (STORY-AP1.2: brand_kit prefix dropped)
    pattern = r"^[a-z0-9-]+_v\d+_\d{8}\.html$"
    assert re.match(pattern, filename), (
        f"Filename {filename!r} does not match convention"
    )

    today = datetime.now(tz=timezone.utc).strftime("%Y%m%d")
    assert filename == f"special-offer-42_v5_{today}.html"


# ---------------------------------------------------------------------------
# STORY-AP6.1: clean export — NO simulation marker in the exported HTML.
# The metadata comment (PhishForge branding, emailer name, creator email,
# timestamps) that STORY-5.2 prepended has been removed: any such marker in
# the recipient's view-source would undermine the authorized-simulation
# realism. The download body is now the compiled HTML verbatim.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_body_is_compiled_html_byte_equal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """STORY-AP6.1: exported body equals the compiled HTML exactly."""
    token = await _register_and_login(client, email="clean@example.com")
    emailer_id = await _create_emailer(client, token, name="Clean Export")
    compiled_html = "<html><body>Hi</body></html>"
    await _insert_version(db_session, emailer_id, 1, compiled_html=compiled_html)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    # Byte-for-byte: nothing prepended, nothing appended.
    assert resp.text == compiled_html


@pytest.mark.asyncio
async def test_export_contains_no_simulation_marker(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """STORY-AP6.1: no PhishForge marker, metadata block, or creator email.

    The recipient's view-source must reveal nothing that flags the email as
    a PhishForge simulation.
    """
    creator_email = "marker@example.com"
    token = await _register_and_login(client, email=creator_email)
    emailer_id = await _create_emailer(client, token, name="Marker Check")
    compiled_html = "<html><body>OK</body></html>"
    await _insert_version(db_session, emailer_id, 1, compiled_html=compiled_html)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    body = resp.text

    assert "PhishForge" not in body
    assert "Export Metadata" not in body
    assert creator_email not in body
    assert "Marker Check" not in body  # emailer name must not leak
    assert "Creator:" not in body
    assert "Generated:" not in body
    assert "Exported:" not in body
    # No prepended HTML comment block at all.
    assert not body.startswith("<!--")
    assert body == compiled_html


# ---------------------------------------------------------------------------
# STORY-5.3: Export status tracking
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_first_export_transitions_status_to_exported(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """First export transitions status to exported and sets exported_at."""
    token = await _register_and_login(client, email="status1@example.com")
    emailer_id = await _create_emailer(client, token)
    await _insert_version(db_session, emailer_id, 1)

    # Verify initial status is "draft"
    result = await db_session.execute(select(Emailer).where(Emailer.id == emailer_id))
    emailer = result.scalar_one()
    assert emailer.status == "draft"
    assert emailer.exported_at is None

    # Perform the first export
    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200

    # Verify status transitioned to "exported" with a timestamp
    await db_session.refresh(emailer)
    assert emailer.status == "exported"
    assert emailer.exported_at is not None


@pytest.mark.asyncio
async def test_second_export_keeps_status_and_timestamp(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Subsequent exports do not change status or exported_at (AC-3)."""
    token = await _register_and_login(client, email="status2@example.com")
    emailer_id = await _create_emailer(client, token)
    await _insert_version(db_session, emailer_id, 1)

    # First export
    resp1 = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )
    assert resp1.status_code == 200

    # Capture the exported_at timestamp from the first export
    result = await db_session.execute(select(Emailer).where(Emailer.id == emailer_id))
    emailer = result.scalar_one()
    first_exported_at = emailer.exported_at
    assert emailer.status == "exported"
    assert first_exported_at is not None

    # Second export
    resp2 = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )
    assert resp2.status_code == 200

    # Verify status and exported_at remain unchanged
    await db_session.refresh(emailer)
    assert emailer.status == "exported"
    assert emailer.exported_at == first_exported_at


# ---------------------------------------------------------------------------
# STORY-5.4 AC-5: Backend regression — export still serves the latest
# version's compiled_html, byte-for-byte, with no extra mutation logic.
# The fix for STORY-5.4 is frontend-only: the editor forces a Save before
# calling GET /export, so the latest version row already reflects the
# canvas state. This test pins the backend contract.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_serves_latest_version_compiled_html_byte_for_byte(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """STORY-5.4 AC-5 / STORY-AP6.1: the export body is exactly the latest
    version's compiled_html — byte-for-byte, with no prefix or mutation.
    """
    token = await _register_and_login(client, email="story54@example.com")
    emailer_id = await _create_emailer(client, token, name="Story 5.4")

    # Two versions; latest (v2) carries the bytes the user expects to download.
    stale_html = "<html><body>STALE — v1</body></html>"
    fresh_html = (
        "<html><body><h1>FRESH</h1>"
        "<p>Edited inline at the canvas, just-saved by the frontend.</p>"
        "</body></html>"
    )
    await _insert_version(db_session, emailer_id, 1, compiled_html=stale_html)
    await _insert_version(db_session, emailer_id, 2, compiled_html=fresh_html)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200

    body = resp.text
    # Stale bytes from v1 must NOT leak through.
    assert "STALE" not in body

    # Fresh bytes from v2 are the entire body, byte-for-byte (no marker).
    assert body == fresh_html

    # Filename references v2 (latest), confirming the endpoint did not
    # silently downgrade to a prior version.
    disposition = resp.headers["content-disposition"]
    assert "_v2_" in disposition


# ---------------------------------------------------------------------------
# STORY-5.1 AC-3: exported HTML has no data: URLs; <img src=...> values are
# absolute (http(s)://...). MJML compiles <mj-image src="..."> to a plain
# <img src="..."> in the output HTML, so we audit every <img> tag in the
# exported body. We compile a real MJML fixture so the assertion is a true
# end-to-end regression — not a mocked renderer.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.skipif(
    not _mjml_available(),
    reason="mjml CLI not on PATH; install with `npm install -g mjml`",
)
async def test_export_has_no_data_urls_and_image_src_is_absolute(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """STORY-5.1 AC-3: external assets via absolute URL (not base64).

    Compile a real MJML doc with three remote images, persist the resulting
    HTML as the version's compiled_html, then export it and assert:

    1. The body contains no ``src="data:`` (no inline base64 — these bloat
       email size and Outlook strips them).
    2. Every ``<img src=...>`` value starts with ``http`` (i.e. an absolute
       URL the email client can fetch).
    """
    token = await _register_and_login(client, email="ac3@example.com")
    emailer_id = await _create_emailer(client, token, name="AC3 Image Test")

    mjml_source = """\
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-image src="https://cdn.example.com/hero.png" alt="Hero" />
        <mj-text>Some copy.</mj-text>
        <mj-image src="https://cdn.example.com/feature.jpg" alt="Feature" />
      </mj-column>
    </mj-section>
    <mj-section>
      <mj-column>
        <mj-image src="http://images.example.com/footer.gif" alt="Footer" />
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
"""
    compiled_html = await compile_mjml(mjml_source)
    # Sanity: the renderer actually emitted <img> tags.
    assert "<img " in compiled_html, "MJML did not produce any <img> tags"

    await _insert_version(db_session, emailer_id, 1, compiled_html=compiled_html)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/export",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200
    body = resp.text

    # AC-3 #1: no inline base64 anywhere in the response body.
    assert 'src="data:' not in body, (
        "Export contains a data: URL — base64 images bloat the email and "
        "are stripped by Outlook. Source: STORY-5.1 AC-3."
    )

    # AC-3 #2: every <img src=...> in the compiled HTML is absolute http(s).
    img_srcs = re.findall(r'<img\s[^>]*?src="([^"]*)"', body)
    assert img_srcs, "Expected at least one <img src=...> in the export"
    for src in img_srcs:
        assert src.startswith("http"), (
            f"Image src {src!r} is not absolute. Expected http:// or "
            "https:// per STORY-5.1 AC-3."
        )

    # And the three URLs we put in the MJML are all present (i.e. nothing
    # got silently rewritten or stripped).
    assert "https://cdn.example.com/hero.png" in img_srcs
    assert "https://cdn.example.com/feature.jpg" in img_srcs
    assert "http://images.example.com/footer.gif" in img_srcs
