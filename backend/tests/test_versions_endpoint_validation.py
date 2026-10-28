"""STORY-7.10 — POST /emailers/{id}/versions integrates the MJML sanitizer.

These tests assert the HTTP-layer contract:

* Auto-repairable input -> 201 with a sane ``compiled_html``.
* Hard-fail input -> 422 with the documented body shape and **no** new
  ``EmailerVersion`` row.
* The repaired MJML (not the raw input) is what gets persisted.
* The response body's ``mjml_source`` matches what's persisted.
"""

from __future__ import annotations

import logging
import shutil

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.emailer_version import EmailerVersion

BASE_AUTH = "/api/v1/auth"
BASE_EMAILERS = "/api/v1/emailers"


def _mjml_available() -> bool:
    return bool(shutil.which("npx") and shutil.which("mjml"))


pytestmark = pytest.mark.skipif(
    not _mjml_available(),
    reason="mjml CLI not on PATH; install with `npm install -g mjml`",
)


# ---------------------------------------------------------------------------
# Helpers (mirror tests/test_versions.py)
# ---------------------------------------------------------------------------


async def _register_and_login(
    client: AsyncClient, email: str = "validator@example.com"
) -> str:
    resp = await client.post(
        f"{BASE_AUTH}/register",
        json={"email": email, "password": "strongpass123", "name": "Test"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_emailer(client: AsyncClient, token: str) -> int:
    resp = await client.post(
        BASE_EMAILERS,
        json={
            "name": "Validator Emailer",
            "category": "offer",
            "target_audience": "All users",
            "content_summary": "Validator integration test.",
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


async def _row_count(db: AsyncSession, emailer_id: int) -> int:
    rows = await db.execute(
        select(EmailerVersion).where(EmailerVersion.emailer_id == emailer_id)
    )
    return len(list(rows.scalars().all()))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


V8_MALFORMED = """\
<mjml>
  <mj-body>
    <mj-divider>
      <mj-divider>
        <mj-divider>
          <mj-section>
            <mj-column>
              <mj-text>Hello</mj-text>
              <mj-text>World</mj-text>
            </mj-column>
          </mj-section>
        </mj-divider>
      </mj-divider>
    </mj-divider>
  </mj-body>
</mjml>
"""


VALID_MJML = """\
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>hello world</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
"""


HARD_FAIL_MJML = """\
<mjml>
  <mj-body>
    <mj-section>
      <mj-text>oops, no column wrapper</mj-text>
    </mj-section>
  </mj-body>
</mjml>
"""


# ---------------------------------------------------------------------------
# Auto-repair path: 201 + persisted MJML is the REPAIRED form
# ---------------------------------------------------------------------------


async def test_create_version_auto_repairs_v8_pattern(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client, email="autorepair@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": V8_MALFORMED},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["version_number"] == 1
    # The persisted MJML should NOT contain the broken nested-divider pattern.
    assert "</mj-divider>" not in body["mjml_source"]
    # Both text bodies must survive.
    assert "Hello" in body["mjml_source"]
    assert "World" in body["mjml_source"]
    # And the compiled HTML must be non-empty.
    assert body["compiled_html"]
    assert len(body["compiled_html"]) > len(V8_MALFORMED) * 1.2


async def test_create_version_valid_mjml_passes_through(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client, email="valid@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": VALID_MJML},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    # Passthrough: the saved MJML is byte-identical to the input.
    assert body["mjml_source"] == VALID_MJML
    assert body["compiled_html"]
    assert "hello world" in body["compiled_html"]


# ---------------------------------------------------------------------------
# Hard-fail path: 422 + structured error + no row inserted
# ---------------------------------------------------------------------------


async def test_create_version_hard_fail_returns_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client, email="hardfail@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": HARD_FAIL_MJML},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 422, resp.text
    body = resp.json()
    # FastAPI wraps the HTTPException's dict detail under top-level "detail".
    assert "detail" in body
    detail = body["detail"]
    assert isinstance(detail, dict), f"expected dict detail, got {type(detail)}"
    assert detail["detail"] == "MJML validation failed"
    errors = detail["errors"]
    assert isinstance(errors, list)
    assert errors, "errors list must be non-empty on a hard fail"
    # Each error has the documented shape: line/tag/message.
    for err in errors:
        assert set(err.keys()) == {"line", "tag", "message"}
        assert isinstance(err["line"], int)
        assert isinstance(err["tag"], str)
        assert isinstance(err["message"], str)
    # At least one error mentions mj-text (the offending tag in this fixture).
    assert any("mj-text" in (e["tag"] or e["message"]) for e in errors)

    # Critical AC-4 assertion: no version row was created.
    assert await _row_count(db_session, emailer_id) == 0


async def test_create_version_no_row_on_validation_failure_among_existing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Hard fail leaves the existing rows intact and adds nothing."""
    token = await _register_and_login(client, email="noromix@example.com")
    emailer_id = await _create_emailer(client, token)

    # Seed one valid version.
    valid_resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": VALID_MJML},
        headers=_auth_headers(token),
    )
    assert valid_resp.status_code == 201
    seeded_count = await _row_count(db_session, emailer_id)
    assert seeded_count == 1

    # Submit a hard-fail; expect 422 and unchanged row count.
    fail_resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": HARD_FAIL_MJML},
        headers=_auth_headers(token),
    )
    assert fail_resp.status_code == 422
    assert await _row_count(db_session, emailer_id) == seeded_count


# ---------------------------------------------------------------------------
# Empty source still rejected by Pydantic min_length=1
# ---------------------------------------------------------------------------


async def test_create_version_empty_mjml_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_and_login(client, email="empty@example.com")
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/versions",
        json={"mjml_source": ""},
        headers=_auth_headers(token),
    )

    # Pydantic rejects min_length=1 BEFORE the sanitizer is ever called;
    # response shape is FastAPI's default validation 422 (detail=list).
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# STORY-7.10 AC-5: suspicious-output heuristic logs a WARNING when the
# compiled HTML is unusually small relative to the MJML source. The
# heuristic in app/api/versions.py is::
#
#     if len(compiled_html) < len(body.mjml_source) * 1.2:
#         logger.warning(
#             "MJML compile produced suspiciously small HTML — emailer=%d "
#             "mjml_len=%d compiled_len=%d mjml_head=%r",
#             emailer_id, len(body.mjml_source), len(compiled_html),
#             body.mjml_source[:500],
#         )
#
# The most reliable way to drive this branch in a unit test is to
# monkeypatch ``compile_mjml`` (where it is imported, in app.api.versions)
# to return a deliberately short HTML string. We keep the input MJML as a
# real, valid document so the sanitizer / 422 path is not triggered.
# ---------------------------------------------------------------------------


async def test_create_version_logs_warning_on_suspiciously_small_html(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A short compiled HTML relative to the MJML source emits a WARNING.

    We monkeypatch ``app.api.versions.compile_mjml`` to short-circuit the
    real compiler and return a tiny HTML payload, then post valid MJML.
    The endpoint must still succeed (201), the row must still land, and a
    WARNING-level log record must be emitted with ``mjml_len``,
    ``compiled_len`` and a head-snippet of the MJML source.
    """
    token = await _register_and_login(client, email="warnsmall@example.com")
    emailer_id = await _create_emailer(client, token)

    # The MJML source is large enough that our short-circuited compile_mjml
    # output will easily fall under ``len(mjml) * 1.2``.
    long_mjml = (
        "<mjml>\n"
        "  <mj-body>\n"
        "    <mj-section>\n"
        "      <mj-column>\n"
        f"        <mj-text>{'Hello world. ' * 80}</mj-text>\n"
        "      </mj-column>\n"
        "    </mj-section>\n"
        "  </mj-body>\n"
        "</mjml>\n"
    )
    short_html = "<html><body>tiny</body></html>"
    assert len(short_html) < len(long_mjml) * 1.2  # sanity-check our setup

    async def _fake_compile(_src: str) -> str:
        return short_html

    monkeypatch.setattr("app.api.versions.compile_mjml", _fake_compile)

    with caplog.at_level(logging.WARNING, logger="app.api.versions"):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer_id}/versions",
            json={"mjml_source": long_mjml},
            headers=_auth_headers(token),
        )

    assert resp.status_code == 201, resp.text

    # Find the suspicious-output WARNING record.
    suspicious_records = [
        r
        for r in caplog.records
        if r.name == "app.api.versions"
        and r.levelno == logging.WARNING
        and "suspiciously small HTML" in r.getMessage()
    ]
    assert len(suspicious_records) == 1, (
        "Expected exactly one 'suspiciously small HTML' WARNING; "
        f"got {len(suspicious_records)}: "
        f"{[r.getMessage() for r in caplog.records]}"
    )

    msg = suspicious_records[0].getMessage()
    # Both lengths must appear in the formatted message.
    assert f"mjml_len={len(long_mjml)}" in msg
    assert f"compiled_len={len(short_html)}" in msg
    # The first 500 chars of the MJML source must appear (repr'd).
    expected_head = long_mjml[:500]
    assert repr(expected_head) in msg
    # And the emailer ID must be referenced.
    assert f"emailer={emailer_id}" in msg
