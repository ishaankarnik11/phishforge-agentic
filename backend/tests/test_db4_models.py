"""Unit tests for STORY-DB.4 models: ExportLog and PreviewLink.

Covers:
- Direct instantiation and persistence of ExportLog rows.
- Direct instantiation and persistence of PreviewLink rows.
- Token uniqueness on PreviewLink.
- FK cascade: deleting the parent Emailer removes child rows in both tables.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.emailer import Emailer
from app.models.emailer_version import EmailerVersion
from app.models.export_log import ExportLog
from app.models.preview_link import PreviewLink
from app.models.user import User


async def _make_user(db_session: AsyncSession, email: str = "user@example.com") -> User:
    user = User(email=email, name="Test", password_hash="x", role="editor")
    db_session.add(user)
    await db_session.flush()
    return user


async def _make_emailer(db_session: AsyncSession, user_id: int) -> Emailer:
    emailer = Emailer(
        user_id=user_id,
        name="Test Emailer",
        status="draft",
        category="offer",
        target_audience="All customers",
        content_summary="A short content summary for testing.",
        cta_text="Buy now",
        cta_url="https://example.com",
        tone="professional",
        length="short",
        language="english",
    )
    db_session.add(emailer)
    await db_session.flush()
    return emailer


@pytest.mark.asyncio
async def test_export_log_insert_and_select(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    emailer = await _make_emailer(db_session, user.id)

    log = ExportLog(
        emailer_id=emailer.id,
        version_number=1,
        exported_by=user.id,
        filename="emailer_v1.html",
    )
    db_session.add(log)
    await db_session.commit()

    result = await db_session.execute(
        select(ExportLog).where(ExportLog.emailer_id == emailer.id)
    )
    rows = result.scalars().all()
    assert len(rows) == 1
    fetched = rows[0]
    assert fetched.version_number == 1
    assert fetched.exported_by == user.id
    assert fetched.filename == "emailer_v1.html"
    assert fetched.exported_at is not None


@pytest.mark.asyncio
async def test_preview_link_insert_and_select(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    emailer = await _make_emailer(db_session, user.id)

    version = EmailerVersion(
        emailer_id=emailer.id,
        version_number=1,
        mjml_source="<mjml></mjml>",
        source="generation",
    )
    db_session.add(version)
    await db_session.flush()

    expires = datetime.now(timezone.utc) + timedelta(days=7)
    link = PreviewLink(
        emailer_id=emailer.id,
        token="abc123token",
        version_id=version.id,
        created_by=user.id,
        expires_at=expires,
    )
    db_session.add(link)
    await db_session.commit()

    result = await db_session.execute(
        select(PreviewLink).where(PreviewLink.token == "abc123token")
    )
    fetched = result.scalar_one()
    assert fetched.emailer_id == emailer.id
    assert fetched.version_id == version.id
    assert fetched.created_by == user.id
    assert fetched.expires_at is not None
    assert fetched.created_at is not None


@pytest.mark.asyncio
async def test_preview_link_token_unique(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    emailer = await _make_emailer(db_session, user.id)

    expires = datetime.now(timezone.utc) + timedelta(days=7)
    db_session.add(
        PreviewLink(
            emailer_id=emailer.id,
            token="duplicate-token",
            expires_at=expires,
        )
    )
    await db_session.commit()

    db_session.add(
        PreviewLink(
            emailer_id=emailer.id,
            token="duplicate-token",
            expires_at=expires,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_cascade_delete_removes_children(db_session: AsyncSession) -> None:
    """Deleting the parent Emailer via the ORM cascades to export_logs and
    preview_links because the relationships declare ``cascade="all, delete-orphan"``.
    """
    user = await _make_user(db_session)
    emailer = await _make_emailer(db_session, user.id)
    emailer_id = emailer.id

    db_session.add(
        ExportLog(
            emailer_id=emailer.id,
            version_number=1,
            exported_by=user.id,
            filename="a.html",
        )
    )
    db_session.add(
        PreviewLink(
            emailer_id=emailer.id,
            token="tok-cascade",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
    )
    await db_session.commit()

    # Reload the emailer with children eager-loaded (relationships are lazy="raise"),
    # then delete via the ORM to trigger the declared delete-orphan cascade.
    result = await db_session.execute(
        select(Emailer)
        .where(Emailer.id == emailer_id)
        .options(
            selectinload(Emailer.export_logs),
            selectinload(Emailer.preview_links),
        )
    )
    fresh_emailer = result.scalar_one()
    assert len(fresh_emailer.export_logs) == 1
    assert len(fresh_emailer.preview_links) == 1

    await db_session.delete(fresh_emailer)
    await db_session.commit()

    remaining_logs = (
        (
            await db_session.execute(
                select(ExportLog).where(ExportLog.emailer_id == emailer_id)
            )
        )
        .scalars()
        .all()
    )
    remaining_links = (
        (
            await db_session.execute(
                select(PreviewLink).where(PreviewLink.emailer_id == emailer_id)
            )
        )
        .scalars()
        .all()
    )
    assert remaining_logs == []
    assert remaining_links == []
