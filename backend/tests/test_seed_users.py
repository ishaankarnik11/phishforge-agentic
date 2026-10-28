"""STORY-7.5 AC-4 — idempotent seed users.

Validates :func:`app.services.seed_users.seed_users`:

* First call inserts the three documented seed accounts.
* Second call is a no-op — no duplicates, no exceptions, identical row count.
* Existing rows with the same email are left intact (no password reset,
  no role change).
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth_service import verify_password
from app.services.seed_users import SEED_USERS, seed_users


async def _user_count(db: AsyncSession) -> int:
    result = await db.execute(select(func.count()).select_from(User))
    return int(result.scalar_one())


@pytest.mark.asyncio
async def test_seed_users_first_call_creates_three_users(
    db_session: AsyncSession,
) -> None:
    """First seed run inserts the three PRD-mandated accounts."""
    assert await _user_count(db_session) == 0

    created = await seed_users(db_session)

    assert len(created) == 3
    assert {u.email for u in created} == {
        "priya@phishforge.io",
        "rahul@phishforge.io",
        "admin@phishforge.io",
    }
    # Roles: priya/rahul are editors, admin is admin.
    by_email = {u.email: u for u in created}
    assert by_email["priya@phishforge.io"].role == "editor"
    assert by_email["rahul@phishforge.io"].role == "editor"
    assert by_email["admin@phishforge.io"].role == "admin"
    # Names.
    assert by_email["priya@phishforge.io"].name == "Priya Sharma"
    assert by_email["rahul@phishforge.io"].name == "Rahul Mehta"
    assert by_email["admin@phishforge.io"].name == "Admin"
    # Passwords are bcrypt-hashed and verifiable.
    for seed in SEED_USERS:
        row = by_email[seed.email]
        assert row.password_hash != seed.password, (
            "Password must be hashed, not stored in cleartext."
        )
        assert verify_password(seed.password, row.password_hash)

    assert await _user_count(db_session) == 3


@pytest.mark.asyncio
async def test_seed_users_second_call_is_idempotent(
    db_session: AsyncSession,
) -> None:
    """Calling seed_users twice must not duplicate rows or raise."""
    first = await seed_users(db_session)
    assert len(first) == 3
    assert await _user_count(db_session) == 3

    # Capture the original IDs so we can assert that the rows returned by
    # the second call are the *same* rows, not freshly-inserted dupes.
    first_ids = {u.email: u.id for u in first}

    # No exception, no integrity error, no duplicates.
    second = await seed_users(db_session)

    assert len(second) == 3
    assert await _user_count(db_session) == 3, (
        "Second seed_users call duplicated rows — idempotency broken."
    )
    second_ids = {u.email: u.id for u in second}
    assert second_ids == first_ids, (
        "Second call returned different IDs; rows were re-inserted instead of fetched."
    )


@pytest.mark.asyncio
async def test_seed_users_does_not_overwrite_existing_row(
    db_session: AsyncSession,
) -> None:
    """An existing row with one of the seed emails is left untouched."""
    # Pre-create priya with a different name + password.
    custom = User(
        email="priya@phishforge.io",
        name="Custom Name",
        password_hash="custom-hash-not-bcrypt",
        role="admin",  # promoted manually
    )
    db_session.add(custom)
    await db_session.commit()
    await db_session.refresh(custom)
    custom_id = custom.id

    persisted = await seed_users(db_session)

    # Three rows total: the customised priya plus rahul + admin.
    assert await _user_count(db_session) == 3
    by_email = {u.email: u for u in persisted}
    assert by_email["priya@phishforge.io"].id == custom_id
    assert by_email["priya@phishforge.io"].name == "Custom Name"
    assert by_email["priya@phishforge.io"].password_hash == "custom-hash-not-bcrypt"
    assert by_email["priya@phishforge.io"].role == "admin"
