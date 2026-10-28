"""Idempotent seed of POC user accounts (STORY-7.5 AC-4).

Three pre-set operator accounts for the POC environment (the security
firm's own staff who log in to run anti-phishing audits)::

    priya@phishforge.io / password123  (name: "Priya Sharma", role: editor)
    rahul@phishforge.io / password123  (name: "Rahul Mehta",  role: editor)
    admin@phishforge.io / password123  (name: "Admin",        role: admin)

This module provides a single idempotent ``seed_users`` coroutine that:

* inserts any of the three accounts that don't already exist (matched on
  ``email``, which is unique-indexed on the ``users`` table),
* leaves existing rows untouched (no password reset, no role change),
* returns a list of every seed user's :class:`User` row, regardless of
  whether the call inserted them or merely fetched them.

Calling it twice in a row must produce no duplicates and no exceptions —
that's the whole point of "idempotent". The accompanying test asserts this
contract.

This module deliberately does **not** read the seed list from environment
variables: the POC password is documented in the PRD and the security
posture is "treat it as a demo bank". For real deployments the seeds would
be replaced by SSO; this script is single-purpose POC scaffolding.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth_service import get_user_by_email, hash_password


@dataclass(frozen=True)
class SeedUser:
    email: str
    name: str
    password: str
    role: str


# The canonical POC seed list. Order is stable so the returned list is
# also stable, which makes assertions in the test simpler.
SEED_USERS: tuple[SeedUser, ...] = (
    SeedUser(
        email="priya@phishforge.io",
        name="Priya Sharma",
        password="password123",
        role="editor",
    ),
    SeedUser(
        email="rahul@phishforge.io",
        name="Rahul Mehta",
        password="password123",
        role="editor",
    ),
    SeedUser(
        email="admin@phishforge.io",
        name="Admin",
        password="password123",
        role="admin",
    ),
)


async def seed_users(db: AsyncSession) -> list[User]:
    """Insert any missing seed accounts; return the full set of seed users.

    Idempotent: calling this function multiple times will never create
    duplicates and will not raise an integrity error. Existing rows are
    returned as-is — passwords, names, and roles are not overwritten so
    a developer who has hand-edited a row keeps their changes.

    Parameters
    ----------
    db:
        Caller-managed :class:`AsyncSession`. The function commits its own
        inserts and refreshes each persisted row before returning, so the
        caller does not need to call ``db.commit()`` afterwards.
    """
    persisted: list[User] = []
    inserted_any = False
    for seed in SEED_USERS:
        existing = await get_user_by_email(db, seed.email)
        if existing is not None:
            persisted.append(existing)
            continue

        user = User(
            email=seed.email,
            name=seed.name,
            password_hash=hash_password(seed.password),
            role=seed.role,
        )
        db.add(user)
        persisted.append(user)
        inserted_any = True

    if inserted_any:
        await db.commit()
        for user in persisted:
            # Only refresh rows that were just inserted; rows fetched via
            # get_user_by_email are already attached and current.
            if user.id is None:
                await db.refresh(user)

    return persisted
