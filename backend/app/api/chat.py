"""Chat/refinement endpoints (STORY-4.3).

POST /emailers/{emailer_id}/chat  -- send a refinement message
GET  /emailers/{emailer_id}/chat  -- list chat history

The POST endpoint saves the user message, calls the AI refiner, saves the
assistant reply, creates a new EmailerVersion with the refined MJML, and
returns the assistant message alongside the new version.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.exceptions import AIGenerationError
from app.ai.refiner import refine_emailer
from app.ai.schemas import AssetReference, RefineInput
from app.ai.schemas import ChatMessage as AIChatMessage
from app.api.deps import CurrentUser
from app.database import get_db
from app.mjml.renderer import MjmlRendererError, compile_mjml
from app.models.asset import Asset
from app.models.chat_message import ChatMessage
from app.models.emailer_version import EmailerVersion
from app.models.library_asset import LibraryAsset, LibraryAssetVersion
from app.schemas.chat import ChatMessageCreate, ChatMessageRead, RefineResponse
from app.schemas.emailer_version import EmailerVersionRead
from app.services import rate_limit_service
from app.services.emailer_service import get_owned_emailer
from app.services.mjml_sanitize import (
    MJMLValidationError,
    sanitize_and_validate,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/emailers/{emailer_id}/chat",
    tags=["chat"],
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _get_latest_version(
    emailer_id: int,
    db: AsyncSession,
) -> EmailerVersion:
    """Return the latest EmailerVersion for *emailer_id*, or raise 400."""
    result = await db.execute(
        select(EmailerVersion)
        .where(EmailerVersion.emailer_id == emailer_id)
        .order_by(EmailerVersion.version_number.desc())
        .limit(1)
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Generate an emailer version first",
        )
    return version


# Roles from `chat_messages` that may be replayed to the Anthropic messages API.
# Anthropic only accepts `user` / `assistant`. The `suggestion` role (added in
# STORY-4.5) is a reviewer side-channel, NOT part of the owner-AI conversation,
# so it is excluded here; leaking it into `messages=[...]` would 400 on the
# provider. `system` is never emitted as a row role in practice but is kept in
# the allow-list as a future-proof guard.
_AI_REPLAYABLE_ROLES: frozenset[str] = frozenset({"user", "assistant"})


async def _load_chat_history(
    emailer_id: int,
    db: AsyncSession,
) -> list[ChatMessage]:
    """Return all chat messages for *emailer_id* ordered by created_at asc.

    Note: returns ALL roles (including ``suggestion``) so the owner-facing
    ``GET /chat`` endpoint can render reviewer suggestions in the UI. Callers
    that feed history back into the refiner LLM must filter to
    ``_AI_REPLAYABLE_ROLES`` before constructing ``AIChatMessage`` entries.
    """
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.emailer_id == emailer_id)
        .order_by(ChatMessage.created_at.asc())
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# POST /emailers/{emailer_id}/chat
# ---------------------------------------------------------------------------


@router.post("", response_model=RefineResponse)
async def post_chat_message(
    emailer_id: int,
    body: ChatMessageCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RefineResponse:
    """Send a refinement instruction and receive the AI-refined version.

    1. Verify emailer ownership.
    2. Get the latest EmailerVersion (400 if none).
    3. Load existing chat history from DB.
    4. Save the user message.
    5. Build RefineInput and call refine_emailer().
    6. Save the assistant response message.
    7. Create a new EmailerVersion with the refined MJML.
    8. Return RefineResponse.
    """
    # 1. Auth + ownership check
    emailer = await get_owned_emailer(db, emailer_id, current_user.id)

    # 1b. Enforce per-user and per-emailer refinement caps (STORY-7.4).
    # RateLimitExceeded is handled by the app-level exception handler.
    await rate_limit_service.check_refinement_limit(db, current_user.id, emailer_id)

    # 2. Get latest version (version_number used directly below — 5d)
    latest_version = await _get_latest_version(emailer_id, db)

    # 3. Load chat history. Filter to roles the Anthropic messages API accepts
    # (`user` / `assistant`); reviewer `suggestion` rows (STORY-4.5) are
    # dropped here because they are a side-channel, not part of the owner-AI
    # conversation. Without this filter the refiner request would 400 from
    # Anthropic the first time a reviewer comment lands in history.
    history_rows = await _load_chat_history(emailer_id, db)
    chat_history = [
        AIChatMessage(role=msg.role, content=msg.content)
        for msg in history_rows
        if msg.role in _AI_REPLAYABLE_ROLES
    ]

    # 4. Save user message
    user_msg = ChatMessage(
        emailer_id=emailer_id,
        role="user",
        content=body.content,
    )
    db.add(user_msg)
    await db.flush()

    # 4b. STORY-A5.4: Fetch library assets for asset reference resolution.
    # The refiner can resolve user instructions like "use the Diwali banner
    # as the hero image" by matching against available asset names.
    asset_stmt = (
        select(LibraryAsset.name, LibraryAssetVersion.storage_path)
        .join(
            LibraryAssetVersion,
            LibraryAsset.primary_version_id == LibraryAssetVersion.id,
        )
        .where(LibraryAsset.deleted_at.is_(None))
        .order_by(LibraryAsset.name)
        .limit(100)
    )
    asset_rows = (await db.execute(asset_stmt)).all()
    library_assets = [
        AssetReference(name=name, url=f"/uploads/{path}") for name, path in asset_rows
    ]

    # 4c. STORY-AP1.2: resolve the impersonation logo to a serving URL the same
    # way the library assets above are resolved (relative ``/uploads/...``),
    # so the refiner can keep the impersonated brand's logo consistent.
    impersonation_logo_url: str | None = None
    if emailer.impersonation_logo_asset_id is not None:
        logo_path = await db.scalar(
            select(Asset.storage_path).where(
                Asset.id == emailer.impersonation_logo_asset_id
            )
        )
        if logo_path is not None:
            impersonation_logo_url = f"/uploads/{logo_path}"

    # 5. Build RefineInput from the inline impersonated identity and call refiner.
    #    STORY-AP1.2: the brand-kit lookup is gone — the refiner consumes the
    #    same impersonation fields the generator does.
    inp = RefineInput(
        emailer_id=emailer_id,
        current_mjml=latest_version.mjml_source,
        instruction=body.content,
        chat_history=chat_history,
        library_assets=library_assets,
        impersonation_sender_name=emailer.impersonation_sender_name or "",
        impersonation_sender_email=emailer.impersonation_sender_email or "",
        impersonation_pretends_to_be=emailer.impersonation_pretends_to_be or "",
        impersonation_primary_color=emailer.impersonation_primary_color,
        impersonation_logo_url=impersonation_logo_url,
        # STORY-AP3.1 / CR-001: thread the pretext so chat tweaks stay
        # on-pretext ("make it more urgent", "match the sample's header"). The
        # scenario is the cover story; the refiner is text-only — it edits the
        # existing MJML, which already encodes the mimicked structure, so no
        # sample images are sent on refine.
        pretext_scenario=emailer.pretext_scenario,
        lure_type=emailer.lure_type,
        urgency_level=emailer.urgency_level,
        pretext_tell=emailer.pretext_tell,
    )

    # Pass the DB session so the refinement LLM call is persisted to
    # llm_call_logs for per-emailer cost tracking (STORY-7.3).
    try:
        refine_result = await refine_emailer(inp, db=db)
    except AIGenerationError as exc:
        # STORY-7.11: refiner retry exhausted. Surface as 422 with the same
        # body shape STORY-7.10 uses for the manual save endpoint. The user
        # message and assistant message rows are still in the session here;
        # roll back so the chat history stays in sync with the version
        # timeline (matches the post-7.10 behaviour for save-time 422s).
        logger.warning(
            "Refiner failed validation after retry for emailer %d: %d errors",
            emailer_id,
            len(exc.errors),
        )
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "MJML validation failed",
                "errors": [e.to_dict() for e in exc.errors],
            },
        ) from exc
    except Exception as exc:
        logger.exception("Refiner failed for emailer %d: %s", emailer_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    # 6. Save assistant message
    assistant_msg = ChatMessage(
        emailer_id=emailer_id,
        role="assistant",
        content=refine_result.summary,
    )
    db.add(assistant_msg)
    await db.flush()

    # 6a. STORY-7.10: sanitize + strict-validate the refiner's MJML before
    #     persisting.  On failure we abort the chat turn with a 422 carrying
    #     the same shape the manual save endpoint uses.  STORY-7.11 will
    #     add a refiner-side retry that consumes this error.
    try:
        sanitize_result = await sanitize_and_validate(refine_result.mjml)
    except MJMLValidationError as exc:
        logger.warning(
            "Refiner produced invalid MJML for emailer %d: %d errors",
            emailer_id,
            len(exc.errors),
        )
        # The user message and assistant message rows are still in the
        # session at this point; rolling back ensures we don't half-write.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "MJML validation failed",
                "errors": [e.to_dict() for e in exc.errors],
            },
        ) from exc

    repaired_mjml = sanitize_result.repaired_mjml

    # 6b. Recompile if sanitizer rewrote the MJML, else trust the refiner's
    #     compile result.
    refined_compiled: str | None = refine_result.compiled_html
    if repaired_mjml != refine_result.mjml or refined_compiled is None:
        try:
            refined_compiled = await compile_mjml(repaired_mjml)
        except MjmlRendererError as exc:
            logger.warning(
                "MJML compile failed post-sanitize for emailer %d: %s",
                emailer_id,
                exc,
            )
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "detail": "MJML compilation failed",
                    "errors": [{"line": 0, "tag": "", "message": str(exc)}],
                },
            ) from exc

    # 7. Create new EmailerVersion
    # 5d: derive next version from already-fetched latest_version, avoiding a
    # second MAX() query against the database.
    next_ver = latest_version.version_number + 1

    warnings: list[str] = list(sanitize_result.warnings)
    if refined_compiled is None:
        warnings.append("MJML compilation failed during refinement")

    new_version = EmailerVersion(
        emailer_id=emailer_id,
        version_number=next_ver,
        mjml_source=repaired_mjml,
        compiled_html=refined_compiled,
        model_used=refine_result.model_used,
        input_tokens=refine_result.input_tokens,
        output_tokens=refine_result.output_tokens,
        source="refinement",
        change_summary=refine_result.summary,
    )
    db.add(new_version)
    await db.commit()
    await db.refresh(assistant_msg)
    await db.refresh(new_version)

    # 8. Return response
    return RefineResponse(
        message=ChatMessageRead.model_validate(assistant_msg),
        version=EmailerVersionRead.model_validate(new_version),
        summary=refine_result.summary,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/chat
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ChatMessageRead])
async def list_chat_messages(
    emailer_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ChatMessageRead]:
    """Return all chat messages for this emailer, ordered by created_at asc."""
    await get_owned_emailer(db, emailer_id, current_user.id)

    history = await _load_chat_history(emailer_id, db)
    return [ChatMessageRead.model_validate(msg) for msg in history]
