"""Generate endpoint — triggers AI pipeline for an emailer (STORY-3.1).

POST /emailers/{emailer_id}/generate

Orchestrates: load brief + assets -> build GenerationInput -> call AI
pipeline -> persist EmailerVersion -> return result.

STORY-3.4: MJML compilation is now handled inside the pipeline (with retry
logic).  The endpoint uses ``compiled_html`` from ``GenerationResult``
directly rather than calling ``compile_mjml`` itself.
"""

from __future__ import annotations

import base64
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai.exceptions import AIGenerationError
from app.ai.pipeline import generate_emailer
from app.ai.schemas import AssetRef, GenerationInput, SampleImage
from app.api.deps import CurrentUser
from app.database import get_db
from app.mjml.renderer import MjmlRendererError, compile_mjml
from app.models.asset import Asset
from app.models.emailer import Emailer
from app.models.emailer_version import EmailerVersion
from app.schemas.generate import GenerateResponse
from app.services import rate_limit_service
from app.services.asset_storage import get_asset_url, read_file
from app.services.emailer_service import get_owned_emailer, next_version_number
from app.services.mjml_sanitize import (
    MJMLValidationError,
    sanitize_and_validate,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/emailers/{emailer_id}",
    tags=["generate"],
)

# STORY-AP3.1: cap how many sample screenshots we send to the model as vision.
# Each is a sizeable image payload and the layout/style signal saturates after
# a couple; the pipeline also caps independently. Non-image mimetypes (e.g. a
# PDF mistakenly tagged "sample") are skipped — Anthropic vision wants raster
# images.
_MAX_SAMPLE_IMAGES = 3
_SAMPLE_IMAGE_MIMETYPES = frozenset(
    {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"}
)


def _collect_sample_images(assets: list[Asset]) -> list[SampleImage]:
    """Read ``kind="sample"`` image assets off disk and base64-encode them.

    STORY-AP3.1 task 2: samples are screenshots of the real email the auditor
    wants the simulation to mimic. We read the bytes via the storage layer and
    base64-encode them (rather than passing the ``/uploads/...`` URL) because
    that URL may not be reachable from the Anthropic API; base64 is
    self-contained. We cap the count and skip non-image / unreadable files so a
    bad upload never breaks generation.
    """
    samples: list[SampleImage] = []
    for asset in assets:
        if asset.kind != "sample":
            continue
        media_type = "image/jpeg" if asset.mime_type == "image/jpg" else asset.mime_type
        if asset.mime_type not in _SAMPLE_IMAGE_MIMETYPES:
            logger.info(
                "Skipping non-image sample asset %s (mime=%s) for vision input",
                asset.id,
                asset.mime_type,
            )
            continue
        try:
            raw = read_file(asset.storage_path)
        except FileNotFoundError:
            logger.warning(
                "Sample asset %s file missing at %s; skipping",
                asset.id,
                asset.storage_path,
            )
            continue
        samples.append(
            SampleImage(
                label=asset.label,
                media_type=media_type,
                data_base64=base64.b64encode(raw).decode("ascii"),
            )
        )
        if len(samples) >= _MAX_SAMPLE_IMAGES:
            break
    return samples


@router.post("/generate", response_model=GenerateResponse)
async def generate(
    emailer_id: int,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> GenerateResponse:
    """Run the AI pipeline to generate a new emailer version.

    1. Loads the emailer + assets (verifies ownership).
    2. Builds ``GenerationInput`` for the AI pipeline.
    3. Calls ``generate_emailer()`` to get MJML + compiled HTML + metadata.
    4. Creates a new ``EmailerVersion`` row.
    5. Transitions emailer status from ``draft`` to ``in_review``.
    """
    # 1. Load emailer with assets eagerly (lazy="raise" requires explicit load)
    emailer = await get_owned_emailer(
        db,
        emailer_id,
        current_user.id,
        options=[selectinload(Emailer.assets)],
    )

    # 1b. Enforce per-user daily generation cap (STORY-7.4).
    # RateLimitExceeded is handled by the app-level exception handler
    # registered in app.main, which converts it to a 429 JSON response.
    await rate_limit_service.check_generation_limit(db, current_user.id)

    # 2. Build asset refs with absolute URLs.
    #    STORY-AP2.3: ONLY "content"-kind assets are embedded as <mj-image> in
    #    the generated email. "sample"-kind assets are screenshots of the real
    #    email the auditor wants to mimic — they must NOT be embedded.
    asset_refs = [
        AssetRef(
            label=asset.label,
            url=get_asset_url(request, asset.storage_path),
        )
        for asset in emailer.assets
        if asset.kind == "content"
    ]

    # 2a. STORY-AP3.1: collect "sample"-kind assets as base64 image blocks so
    #     the pipeline can feed them to the model as VISION (the mimicry input).
    sample_images = _collect_sample_images(list(emailer.assets))

    # 2b. Resolve the impersonation logo to an absolute URL the same way
    #     EmailerRead does (via the asset's storage_path). STORY-AP1.2: the
    #     pipeline consumes the resolved URL, not the asset id.
    impersonation_logo_url: str | None = None
    if emailer.impersonation_logo_asset_id is not None:
        storage_path = await db.scalar(
            select(Asset.storage_path).where(
                Asset.id == emailer.impersonation_logo_asset_id
            )
        )
        if storage_path is not None:
            impersonation_logo_url = get_asset_url(request, storage_path)

    # 3. Build GenerationInput from the inline impersonated identity.
    #    STORY-AP1.2: the brand-kit lookup is gone — the simulation impersonates
    #    the sender captured on the emailer row (STORY-AP2.2).
    gen_input = GenerationInput(
        emailer_id=emailer.id,
        name=emailer.name,
        # CR-001: target_audience and length are now optional (may be None);
        # category / content_summary / tone are retired and no longer read.
        target_audience=emailer.target_audience,
        cta_text=emailer.cta_text,
        cta_url=emailer.cta_url,
        length=emailer.length,
        asset_urls=asset_refs,
        impersonation_sender_name=emailer.impersonation_sender_name or "",
        impersonation_sender_email=emailer.impersonation_sender_email or "",
        impersonation_pretends_to_be=emailer.impersonation_pretends_to_be or "",
        impersonation_primary_color=emailer.impersonation_primary_color,
        impersonation_logo_url=impersonation_logo_url,
        # CR-001: the pretext scenario is the believable cover story the lure
        # tells (distinct from lure_type, the mechanism). STORY-AP3.1: pretext
        # also drives the lure shape, urgency, and planted "tell"; samples are
        # fed to the pipeline as vision (see 2a).
        pretext_scenario=emailer.pretext_scenario,
        lure_type=emailer.lure_type,
        urgency_level=emailer.urgency_level,
        pretext_tell=emailer.pretext_tell,
        sample_images=sample_images,
    )

    # 4. Call AI pipeline (MJML compilation + retries happen inside).
    # Pass the DB session so each LLM call is persisted to llm_call_logs
    # for per-emailer cost tracking (STORY-7.3).
    try:
        gen_result = await generate_emailer(gen_input, db=db)
    except AIGenerationError as exc:
        # STORY-7.11: AI pipeline retry exhausted. Surface as 422 with the
        # same body shape STORY-7.10 documented for save-time validation.
        # STORY-7.12 will turn this into a user-facing error block + retry
        # button on the BriefPage.
        logger.warning(
            "AI pipeline failed validation after retry for emailer %d: %d errors",
            emailer_id,
            len(exc.errors),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "MJML validation failed",
                "errors": [e.to_dict() for e in exc.errors],
            },
        ) from exc
    except Exception as exc:
        logger.exception("AI pipeline failed for emailer %d", emailer_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Generation failed: {exc}",
        ) from exc

    # 5. Collect all warnings from pipeline (brand, asset, compilation)
    all_warnings: list[str] = list(gen_result.warnings)

    # 5a. STORY-7.10: sanitize + strict-validate before persisting.  If the
    #     LLM produced invalid MJML that the pipeline's own retries didn't
    #     catch, fail the request with the same 422 shape the manual save
    #     endpoint uses (STORY-7.11 will add an LLM-side retry that
    #     consumes this error and re-prompts; for now we hard-reject).
    try:
        sanitize_result = await sanitize_and_validate(gen_result.mjml)
    except MJMLValidationError as exc:
        logger.warning(
            "AI generation produced invalid MJML for emailer %d: %d errors",
            emailer_id,
            len(exc.errors),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "MJML validation failed",
                "errors": [e.to_dict() for e in exc.errors],
            },
        ) from exc

    repaired_mjml = sanitize_result.repaired_mjml
    all_warnings.extend(sanitize_result.warnings)

    # 5b. If the sanitizer rewrote the MJML, recompile so compiled_html
    #     matches what we are persisting.  If it left the MJML untouched
    #     keep the pipeline's already-compiled HTML.
    compiled_html: str | None = gen_result.compiled_html
    if repaired_mjml != gen_result.mjml or compiled_html is None:
        try:
            compiled_html = await compile_mjml(repaired_mjml)
        except MjmlRendererError as exc:
            logger.warning(
                "MJML compile failed post-sanitize for emailer %d: %s",
                emailer_id,
                exc,
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "detail": "MJML compilation failed",
                    "errors": [{"line": 0, "tag": "", "message": str(exc)}],
                },
            ) from exc

    # 6. Persist the version
    version_number = await next_version_number(db, emailer_id)
    version = EmailerVersion(
        emailer_id=emailer_id,
        version_number=version_number,
        mjml_source=repaired_mjml,
        compiled_html=compiled_html,
        subject_line=gen_result.subject_line,
        preheader=gen_result.preheader,
        model_used=gen_result.model_used,
        input_tokens=gen_result.input_tokens,
        output_tokens=gen_result.output_tokens,
        source="generation",
    )
    db.add(version)

    # 7. Transition status if currently draft
    if emailer.status == "draft":
        emailer.status = "in_review"

    await db.commit()
    await db.refresh(version)

    return GenerateResponse(
        version_id=version.id,
        version_number=version.version_number,
        subject_line=gen_result.subject_line,
        preheader=gen_result.preheader,
        mjml_source=repaired_mjml,
        compiled_html=compiled_html,
        model_used=gen_result.model_used,
        input_tokens=gen_result.input_tokens,
        output_tokens=gen_result.output_tokens,
        cache_read_tokens=gen_result.cache_read_tokens,
        cache_write_tokens=gen_result.cache_write_tokens,
        latency_ms=gen_result.latency_ms,
        warnings=all_warnings,
    )
