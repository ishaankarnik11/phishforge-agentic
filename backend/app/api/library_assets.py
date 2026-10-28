"""Library asset endpoints (STORY-A1.1 .. A1.6, A2.1, A3.1).

Routes are mounted at ``/api/v1/library-assets`` and registered
in ``main.py``.  All endpoints require authentication.

Assets are shared (decision D-1): every user sees every non-deleted
asset.  ``user_id`` tracks who created the asset.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from PIL import Image
from sqlalchemy import delete as sa_delete
from sqlalchemy import distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai.image_client import (
    ImageContentPolicyError,
    ImageGenerationError,
    ImageRateLimitError,
    ImageTimeoutError,
    image_client,
)
from app.ai.image_schemas import ImageGenerationRequest, StylePresets
from app.api.deps import CurrentUser
from app.database import get_db
from app.models.generation_log import GenerationLog
from app.models.library_asset import (
    LibraryAsset,
    LibraryAssetTag,
    LibraryAssetVersion,
)
from app.models.user import User
from app.schemas.library_asset import (
    BulkTagRequest,
    BulkTagResponse,
    EditPromptRequest,
    GenerateAssetRequest,
    LibraryAssetDetailRead,
    LibraryAssetListResponse,
    LibraryAssetRead,
    LibraryAssetUpdate,
    LibraryAssetVersionRead,
    RefineRequest,
    RegenerateRequest,
    SetPrimaryVersionRequest,
)

router = APIRouter(
    prefix="/library-assets",
    tags=["library-assets"],
)

logger = logging.getLogger(__name__)

# Base uploads directory for library assets
LIBRARY_ASSETS_UPLOAD_DIR: Path = Path("uploads/assets")

# Upload validation constants (STORY-A1.2)
UPLOAD_ALLOWED_MIME_TYPES: frozenset[str] = frozenset(
    {
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/svg+xml",
    }
)
UPLOAD_MAX_FILE_SIZE: int = 50 * 1024 * 1024  # 50 MB

# Map MIME types to file extensions for storage paths
_MIME_TO_EXT: dict[str, str] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _version_url(request: Request, path: str | None) -> str | None:
    """Convert a relative storage/thumbnail path to an absolute URL."""
    if path is None:
        return None
    base = str(request.base_url).rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def _build_version_read(
    request: Request, v: LibraryAssetVersion
) -> LibraryAssetVersionRead:
    return LibraryAssetVersionRead(
        id=v.id,
        version_number=v.version_number,
        thumbnail_url=_version_url(request, v.thumbnail_path),
        storage_url=_version_url(request, v.storage_path),
        width=v.width,
        height=v.height,
        file_size_bytes=v.file_size_bytes,
        prompt_text=v.prompt_text,
        refinement_instruction=v.refinement_instruction,
        model_used=v.model_used,
        cost_usd=float(v.cost_usd) if v.cost_usd is not None else None,
        created_at=v.created_at,
    )


def _build_asset_read(
    request: Request,
    asset: LibraryAsset,
    *,
    tags: list[str],
    owner_name: str | None,
    primary_version: LibraryAssetVersion | None,
) -> LibraryAssetRead:
    pv = (
        _build_version_read(request, primary_version)
        if primary_version is not None
        else None
    )
    return LibraryAssetRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tags,
        created_by_name=owner_name,
        primary_version=pv,
        created_at=asset.created_at,
    )


# ---------------------------------------------------------------------------
# GET /library-assets  -- paginated list with search, filter, sort
# ---------------------------------------------------------------------------


@router.get("", response_model=LibraryAssetListResponse)
async def list_library_assets(
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    search: Annotated[str | None, Query(max_length=200)] = None,
    source: Annotated[Literal["generated", "uploaded"] | None, Query()] = None,
    tag: Annotated[str | None, Query(max_length=100)] = None,
    sort: Annotated[Literal["newest", "oldest", "name"], Query()] = "newest",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
) -> LibraryAssetListResponse:
    """Return all non-deleted library assets with optional search/filter.

    All authenticated users see all assets (shared, per decision D-1).
    """
    # -- Base conditions: not soft-deleted ---------------------------------
    conditions: list[Any] = [LibraryAsset.deleted_at.is_(None)]

    # -- Source filter ------------------------------------------------------
    if source is not None:
        conditions.append(LibraryAsset.source == source)

    # -- Tag filter (asset must have this tag) -----------------------------
    if tag is not None:
        conditions.append(
            LibraryAsset.id.in_(
                select(LibraryAssetTag.asset_id).where(LibraryAssetTag.tag == tag)
            )
        )

    # -- Search (name, tags, prompt_text) ----------------------------------
    if search is not None:
        like_term = f"%{search}%"
        # Sub-query: asset ids where a tag matches
        tag_match_subq = select(LibraryAssetTag.asset_id).where(
            LibraryAssetTag.tag.ilike(like_term)
        )
        # Sub-query: asset ids where any version's prompt_text matches
        prompt_match_subq = select(LibraryAssetVersion.asset_id).where(
            LibraryAssetVersion.prompt_text.ilike(like_term)
        )
        conditions.append(
            or_(
                LibraryAsset.name.ilike(like_term),
                LibraryAsset.id.in_(tag_match_subq),
                LibraryAsset.id.in_(prompt_match_subq),
            )
        )

    # -- Count total (before pagination) -----------------------------------
    count_stmt = select(func.count()).select_from(LibraryAsset).where(*conditions)
    total: int = (await db.execute(count_stmt)).scalar_one()

    # -- Sort --------------------------------------------------------------
    order_clause: Any
    if sort == "newest":
        order_clause = LibraryAsset.created_at.desc()
    elif sort == "oldest":
        order_clause = LibraryAsset.created_at.asc()
    else:  # "name"
        order_clause = LibraryAsset.name.asc()

    # -- Main query with joined user + primary version ---------------------
    stmt = (
        select(LibraryAsset, User.name.label("owner_name"))
        .join(User, LibraryAsset.user_id == User.id)
        .where(*conditions)
        .order_by(order_clause)
        .offset(offset)
        .limit(limit)
        .options(
            selectinload(LibraryAsset.tags_rel),
        )
    )
    rows = (await db.execute(stmt)).all()

    # Collect primary version IDs to batch-load
    pv_ids = [
        r[0].primary_version_id for r in rows if r[0].primary_version_id is not None
    ]
    pv_map: dict[str, LibraryAssetVersion] = {}
    if pv_ids:
        pv_stmt = select(LibraryAssetVersion).where(LibraryAssetVersion.id.in_(pv_ids))
        pv_rows = (await db.execute(pv_stmt)).scalars().all()
        pv_map = {v.id: v for v in pv_rows}

    items: list[LibraryAssetRead] = []
    for asset, owner_name in rows:
        tags_list = [t.tag for t in asset.tags_rel]
        pv = pv_map.get(asset.primary_version_id) if asset.primary_version_id else None
        items.append(
            _build_asset_read(
                request,
                asset,
                tags=tags_list,
                owner_name=owner_name,
                primary_version=pv,
            )
        )

    return LibraryAssetListResponse(items=items, total=total)


# ---------------------------------------------------------------------------
# GET /library-assets/tags  -- all distinct tags (STORY-A1.3)
# ---------------------------------------------------------------------------


@router.get("/tags", response_model=list[str])
async def list_tags(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[str]:
    """Return all distinct tags from non-deleted assets, sorted ascending."""
    non_deleted_ids = select(LibraryAsset.id).where(LibraryAsset.deleted_at.is_(None))
    stmt = (
        select(distinct(LibraryAssetTag.tag))
        .where(LibraryAssetTag.asset_id.in_(non_deleted_ids))
        .order_by(LibraryAssetTag.tag.asc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# POST /library-assets/bulk-tag  -- add/remove tags in bulk (STORY-A1.3)
# ---------------------------------------------------------------------------


@router.post("/bulk-tag", response_model=BulkTagResponse)
async def bulk_tag(
    body: BulkTagRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BulkTagResponse:
    """Add or remove tags on multiple assets at once.

    Only non-deleted assets from the provided IDs are affected.
    Returns the number of assets actually modified.
    """
    # Find valid (non-deleted) asset IDs from the request
    valid_stmt = select(LibraryAsset.id).where(
        LibraryAsset.id.in_(body.asset_ids),
        LibraryAsset.deleted_at.is_(None),
    )
    valid_result = await db.execute(valid_stmt)
    valid_ids: list[str] = list(valid_result.scalars().all())

    if not valid_ids:
        return BulkTagResponse(updated=0)

    if body.action == "add":
        # For each valid asset x tag, check existence first to avoid
        # duplicate key errors.
        for asset_id in valid_ids:
            for tag in body.tags:
                exists_stmt = select(LibraryAssetTag).where(
                    LibraryAssetTag.asset_id == asset_id,
                    LibraryAssetTag.tag == tag,
                )
                exists_result = await db.execute(exists_stmt)
                if exists_result.scalar_one_or_none() is None:
                    db.add(LibraryAssetTag(asset_id=asset_id, tag=tag))

    elif body.action == "remove":
        del_stmt = sa_delete(LibraryAssetTag).where(
            LibraryAssetTag.asset_id.in_(valid_ids),
            LibraryAssetTag.tag.in_(body.tags),
        )
        await db.execute(del_stmt)

    await db.commit()
    return BulkTagResponse(updated=len(valid_ids))


# ---------------------------------------------------------------------------
# POST /library-assets/generate  -- generate an image and create asset
# ---------------------------------------------------------------------------


def _generate_thumbnail(source_path: Path, thumb_path: Path) -> None:
    """Create a 200x200 thumbnail from a source image (sync, CPU-bound)."""
    with Image.open(source_path) as img:
        img_resized = img.resize((200, 200), Image.Resampling.LANCZOS)
        img_resized.save(thumb_path, format="PNG")


@router.post(
    "/generate",
    response_model=LibraryAssetDetailRead,
    status_code=status.HTTP_201_CREATED,
)
async def generate_library_asset(
    body: GenerateAssetRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LibraryAssetDetailRead:
    """Generate an image via GPT Image 2 and persist as a library asset.

    Creates a LibraryAsset with source='generated', a single
    LibraryAssetVersion (v1), and optional tags.
    """
    # 1. Check service availability
    if not image_client.available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image generation service unavailable",
        )

    # 2. Build ImageGenerationRequest from user input
    style_presets = StylePresets()
    if body.style_presets is not None:
        style_presets = StylePresets(
            visual_style=body.style_presets.visual_style,
            mood=body.style_presets.mood,
            texture=body.style_presets.texture,
            layout=body.style_presets.layout,
        )

    gen_request = ImageGenerationRequest(
        prompt=body.prompt,
        style_presets=style_presets,
        width=body.width,
        height=body.height,
        quality=body.quality,
        reference_images=body.reference_images or [],
    )

    # 3. Call image_client (async — non-blocking on event loop)
    try:
        result = await image_client.generate_image(gen_request)
    except ImageContentPolicyError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="rejected",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Content policy violation: {exc}",
        ) from exc
    except ImageRateLimitError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: {exc}",
        ) from exc
    except ImageTimeoutError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Generation timed out",
        ) from exc
    except ImageGenerationError as exc:
        logger.error("Image generation failed: %s", exc)
        gen_log = GenerationLog(
            user_id=current_user.id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image generation failed. Please try again.",
        ) from exc

    # 4. Move generated file to proper storage path
    asset_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())

    asset_dir = LIBRARY_ASSETS_UPLOAD_DIR / str(current_user.id) / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)

    dest_path = asset_dir / "v1.png"
    shutil.move(result.image_path, str(dest_path))

    # 5. Generate thumbnail
    thumb_path = asset_dir / "v1_thumb.png"
    await asyncio.to_thread(_generate_thumbnail, dest_path, thumb_path)

    # Relative storage paths (for DB and URL construction)
    storage_path = f"uploads/assets/{current_user.id}/{asset_id}/v1.png"
    thumbnail_path = f"uploads/assets/{current_user.id}/{asset_id}/v1_thumb.png"

    # 6. Create LibraryAsset row
    now = datetime.now(tz=timezone.utc)
    asset = LibraryAsset(
        id=asset_id,
        user_id=current_user.id,
        name=body.name,
        source="generated",
        primary_version_id=version_id,
        created_at=now,
        updated_at=now,
    )
    db.add(asset)

    # 7. Create LibraryAssetVersion row
    version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=1,
        storage_path=storage_path,
        thumbnail_path=thumbnail_path,
        prompt_text=result.assembled_prompt,
        width=result.width,
        height=result.height,
        file_size_bytes=result.file_size_bytes,
        mime_type="image/png",
        model_used=result.model,
        cost_usd=float(result.cost_usd),
        latency_ms=result.latency_ms,
        created_at=now,
    )
    db.add(version)

    # 8. Create tag rows if provided
    if body.tags:
        for tag in body.tags:
            db.add(LibraryAssetTag(asset_id=asset_id, tag=tag))

    # Flush asset + version + tags so that the FK from generation_logs
    # to library_assets is satisfiable within the same transaction.
    await db.flush()

    # 9. Create GenerationLog row for cost tracking (STORY-A2.4)
    gen_log = GenerationLog(
        user_id=current_user.id,
        asset_id=asset_id,
        asset_version_id=version_id,
        operation="generate",
        model=result.model,
        prompt_text=result.assembled_prompt,
        cost_usd=result.cost_usd,
        latency_ms=result.latency_ms,
        status="success",
    )
    db.add(gen_log)

    await db.commit()

    # 10. Return LibraryAssetDetailRead
    version_read = _build_version_read(request, version)
    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=body.tags or [],
        created_by_name=current_user.name,
        primary_version=version_read,
        created_at=asset.created_at,
        versions=[version_read],
    )


# ---------------------------------------------------------------------------
# POST /library-assets/generate-with-refs  -- multipart generate (STORY-A2.5)
# ---------------------------------------------------------------------------

# Allowed MIME types for reference images uploaded in generate-with-refs
_REFERENCE_IMAGE_MIME_TYPES: frozenset[str] = frozenset(
    {"image/png", "image/jpeg", "image/webp"}
)
_MAX_REFERENCE_IMAGES: int = 16


@router.post(
    "/generate-with-refs",
    response_model=LibraryAssetDetailRead,
    status_code=status.HTTP_201_CREATED,
)
async def generate_library_asset_with_refs(
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    # Form fields (same as GenerateAssetRequest but as Form params)
    name: Annotated[str, Form(min_length=1, max_length=255)],
    prompt: Annotated[str, Form(min_length=10, max_length=2000)],
    width: Annotated[int, Form(ge=320, le=1024)] = 1024,
    height: Annotated[int, Form(ge=320, le=1024)] = 512,
    quality: Annotated[str, Form()] = "high",
    tags: Annotated[str | None, Form()] = None,  # comma-separated
    # Style presets as individual form fields
    style_visual: Annotated[str | None, Form()] = None,
    style_mood: Annotated[str | None, Form()] = None,
    style_texture: Annotated[str | None, Form()] = None,
    style_layout: Annotated[str | None, Form()] = None,
    # Reference images (optional, up to 16)
    reference_images: list[UploadFile] = [],  # noqa: B006
) -> LibraryAssetDetailRead:
    """Generate an image via GPT Image 2, optionally with reference images.

    Accepts multipart/form-data so that binary reference image files can be
    uploaded alongside the text parameters.  If no reference images are
    provided, this behaves identically to ``POST /generate``.

    Creates a LibraryAsset with source='generated', a single
    LibraryAssetVersion (v1), and optional tags (STORY-A2.5).
    """
    # -- Validate dimensions (must be multiples of 16) -------------------------
    if width % 16 != 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"width must be a multiple of 16, got {width}",
        )
    if height % 16 != 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"height must be a multiple of 16, got {height}",
        )

    # -- Validate quality ------------------------------------------------------
    allowed_qualities = {"low", "medium", "high"}
    if quality not in allowed_qualities:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"quality must be one of {sorted(allowed_qualities)}, got '{quality}'"
            ),
        )

    # -- Validate reference images ---------------------------------------------
    # Filter out empty uploads (FastAPI sends an empty UploadFile when
    # the field is present but no files are attached).
    actual_files = [f for f in reference_images if f.filename]

    if len(actual_files) > _MAX_REFERENCE_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum {_MAX_REFERENCE_IMAGES} reference images allowed",
        )

    for f in actual_files:
        mime = f.content_type or ""
        if mime not in _REFERENCE_IMAGE_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Unsupported reference image type: {mime!r}. "
                    f"Allowed: {sorted(_REFERENCE_IMAGE_MIME_TYPES)}"
                ),
            )

    # 1. Check service availability
    if not image_client.available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image generation service unavailable",
        )

    # 2. Save reference images to temp files
    temp_paths: list[str] = []
    try:
        for f in actual_files:
            suffix = _MIME_TO_EXT.get(f.content_type or "", "png")
            fd, tmp_file = tempfile.mkstemp(suffix=f".{suffix}")
            file_bytes = await f.read()
            os.write(fd, file_bytes)
            os.close(fd)
            temp_paths.append(tmp_file)

        # 3. Build style presets
        style_presets = StylePresets(
            visual_style=style_visual,
            mood=style_mood,
            texture=style_texture,
            layout=style_layout,
        )

        # 4. Build ImageGenerationRequest
        gen_request = ImageGenerationRequest(
            prompt=prompt,
            style_presets=style_presets,
            width=width,
            height=height,
            quality=quality,
            reference_images=temp_paths,
        )

        # 5. Call image_client
        try:
            result = await image_client.generate_image(gen_request)
        except ImageContentPolicyError as exc:
            gen_log = GenerationLog(
                user_id=current_user.id,
                operation="generate",
                model=image_client.model,
                cost_usd=Decimal("0"),
                latency_ms=0,
                status="rejected",
                error_message=str(exc),
            )
            db.add(gen_log)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Content policy violation: {exc}",
            ) from exc
        except ImageRateLimitError as exc:
            gen_log = GenerationLog(
                user_id=current_user.id,
                operation="generate",
                model=image_client.model,
                cost_usd=Decimal("0"),
                latency_ms=0,
                status="failed",
                error_message=str(exc),
            )
            db.add(gen_log)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: {exc}",
            ) from exc
        except ImageTimeoutError as exc:
            gen_log = GenerationLog(
                user_id=current_user.id,
                operation="generate",
                model=image_client.model,
                cost_usd=Decimal("0"),
                latency_ms=0,
                status="failed",
                error_message=str(exc),
            )
            db.add(gen_log)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Generation timed out",
            ) from exc
        except ImageGenerationError as exc:
            logger.error("Image generation (with refs) failed: %s", exc)
            gen_log = GenerationLog(
                user_id=current_user.id,
                operation="generate",
                model=image_client.model,
                cost_usd=Decimal("0"),
                latency_ms=0,
                status="failed",
                error_message=str(exc),
            )
            db.add(gen_log)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Image generation failed. Please try again.",
            ) from exc

    finally:
        # Clean up temp files regardless of success or failure
        for tmp_file in temp_paths:
            if os.path.exists(tmp_file):
                os.unlink(tmp_file)

    # 6. Move generated file to proper storage path
    asset_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())

    asset_dir = LIBRARY_ASSETS_UPLOAD_DIR / str(current_user.id) / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)

    dest_path = asset_dir / "v1.png"
    shutil.move(result.image_path, str(dest_path))

    # 7. Generate thumbnail
    thumb_path = asset_dir / "v1_thumb.png"
    await asyncio.to_thread(_generate_thumbnail, dest_path, thumb_path)

    # Relative storage paths (for DB and URL construction)
    storage_path = f"uploads/assets/{current_user.id}/{asset_id}/v1.png"
    thumbnail_path = f"uploads/assets/{current_user.id}/{asset_id}/v1_thumb.png"

    # 8. Parse tags from comma-separated string
    tag_list: list[str] = []
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    # 9. Create LibraryAsset row
    now = datetime.now(tz=timezone.utc)
    asset = LibraryAsset(
        id=asset_id,
        user_id=current_user.id,
        name=name,
        source="generated",
        primary_version_id=version_id,
        created_at=now,
        updated_at=now,
    )
    db.add(asset)

    # 10. Create LibraryAssetVersion row
    version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=1,
        storage_path=storage_path,
        thumbnail_path=thumbnail_path,
        prompt_text=result.assembled_prompt,
        width=result.width,
        height=result.height,
        file_size_bytes=result.file_size_bytes,
        mime_type="image/png",
        model_used=result.model,
        cost_usd=float(result.cost_usd),
        latency_ms=result.latency_ms,
        created_at=now,
    )
    db.add(version)

    # 11. Create tag rows
    for tag in tag_list:
        db.add(LibraryAssetTag(asset_id=asset_id, tag=tag))

    # Flush asset + version + tags so FK from generation_logs is satisfiable
    await db.flush()

    # 12. Create GenerationLog row for cost tracking
    gen_log = GenerationLog(
        user_id=current_user.id,
        asset_id=asset_id,
        asset_version_id=version_id,
        operation="generate",
        model=result.model,
        prompt_text=result.assembled_prompt,
        cost_usd=result.cost_usd,
        latency_ms=result.latency_ms,
        status="success",
    )
    db.add(gen_log)

    await db.commit()

    # 13. Return LibraryAssetDetailRead
    version_read = _build_version_read(request, version)
    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tag_list,
        created_by_name=current_user.name,
        primary_version=version_read,
        created_at=asset.created_at,
        versions=[version_read],
    )


# ---------------------------------------------------------------------------
# POST /library-assets/{asset_id}/regenerate  -- regenerate (same prompt, new seed)
# ---------------------------------------------------------------------------


@router.post(
    "/{asset_id}/regenerate",
    response_model=LibraryAssetDetailRead,
    status_code=status.HTTP_201_CREATED,
)
async def regenerate_library_asset(
    asset_id: str,
    body: RegenerateRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LibraryAssetDetailRead:
    """Regenerate an asset using the same prompt and parameters as an existing version.

    Creates a new version with a new API call (new seed = different image).
    The new version becomes the primary version. Each regeneration is
    counted as a new generation for cost tracking (STORY-A2.3).
    """
    # 1. Find asset (non-deleted)
    stmt = (
        select(LibraryAsset, User.name.label("owner_name"))
        .join(User, LibraryAsset.user_id == User.id)
        .where(
            LibraryAsset.id == asset_id,
            LibraryAsset.deleted_at.is_(None),
        )
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Library asset not found",
        )

    asset, owner_name = row

    # 2. Find source version
    source_version: LibraryAssetVersion | None = None
    if body.from_version_id is not None:
        for v in asset.versions:
            if v.id == body.from_version_id:
                source_version = v
                break
        if source_version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source version not found",
            )
    else:
        # Default to primary version
        if asset.primary_version_id:
            for v in asset.versions:
                if v.id == asset.primary_version_id:
                    source_version = v
                    break
        if source_version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No primary version found for this asset",
            )

    # 3. Source version must have prompt_text (can't regenerate uploaded assets)
    if source_version.prompt_text is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot regenerate: source version has no prompt (uploaded asset)",
        )

    # 4. Check service availability
    if not image_client.available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image generation service unavailable",
        )

    # 5. Build ImageGenerationRequest from source version's parameters
    gen_request = ImageGenerationRequest(
        prompt=source_version.prompt_text,
        width=source_version.width or 1024,
        height=source_version.height or 512,
        quality="high",
    )

    # 6. Call image_client (same prompt, new API call = new seed)
    try:
        result = await image_client.generate_image(gen_request)
    except ImageContentPolicyError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="rejected",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Content policy violation: {exc}",
        ) from exc
    except ImageRateLimitError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: {exc}",
        ) from exc
    except ImageTimeoutError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Generation timed out",
        ) from exc
    except ImageGenerationError as exc:
        logger.error("Image regeneration failed: %s", exc)
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image generation failed. Please try again.",
        ) from exc

    # 7. Determine next version number
    max_version_number = max(v.version_number for v in asset.versions)
    next_version_number = max_version_number + 1

    # 8. Move generated file to proper storage path
    version_id = str(uuid.uuid4())
    asset_dir = LIBRARY_ASSETS_UPLOAD_DIR / str(current_user.id) / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)

    dest_path = asset_dir / f"v{next_version_number}.png"
    shutil.move(result.image_path, str(dest_path))

    # 9. Generate 200x200 thumbnail
    thumb_path = asset_dir / f"v{next_version_number}_thumb.png"
    await asyncio.to_thread(_generate_thumbnail, dest_path, thumb_path)

    # Relative storage paths (for DB and URL construction)
    storage_path = (
        f"uploads/assets/{current_user.id}/{asset_id}/v{next_version_number}.png"
    )
    thumbnail_path = (
        f"uploads/assets/{current_user.id}/{asset_id}/v{next_version_number}_thumb.png"
    )

    # 10. Create new LibraryAssetVersion row
    now = datetime.now(tz=timezone.utc)
    new_version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=next_version_number,
        parent_version_id=source_version.id,
        storage_path=storage_path,
        thumbnail_path=thumbnail_path,
        prompt_text=result.assembled_prompt,
        width=result.width,
        height=result.height,
        file_size_bytes=result.file_size_bytes,
        mime_type="image/png",
        model_used=result.model,
        cost_usd=float(result.cost_usd),
        latency_ms=result.latency_ms,
        created_at=now,
    )
    db.add(new_version)

    # 11. Update primary_version_id to the new version
    asset.primary_version_id = version_id
    asset.updated_at = now

    # Flush so that the FK from generation_logs is satisfiable
    await db.flush()

    # 12. Create GenerationLog row for cost tracking
    gen_log = GenerationLog(
        user_id=current_user.id,
        asset_id=asset_id,
        asset_version_id=version_id,
        operation="generate",
        model=result.model,
        prompt_text=result.assembled_prompt,
        cost_usd=result.cost_usd,
        latency_ms=result.latency_ms,
        status="success",
    )
    db.add(gen_log)

    await db.commit()

    # 13. Re-fetch versions for the response (includes the new one)
    db.expire_all()
    refetch_stmt = (
        select(LibraryAsset)
        .where(LibraryAsset.id == asset_id)
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    asset = (await db.execute(refetch_stmt)).scalar_one()

    tags_list = [t.tag for t in asset.tags_rel]
    versions_read = [_build_version_read(request, v) for v in asset.versions]

    # Find the new primary version in the refreshed list
    pv: LibraryAssetVersion | None = None
    for v in asset.versions:
        if v.id == asset.primary_version_id:
            pv = v
            break

    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tags_list,
        created_by_name=owner_name,
        primary_version=(_build_version_read(request, pv) if pv else None),
        created_at=asset.created_at,
        versions=versions_read,
    )


# ---------------------------------------------------------------------------
# POST /library-assets/{asset_id}/refine  -- refine with new instruction (STORY-A3.1)
# ---------------------------------------------------------------------------

MAX_VERSIONS_PER_ASSET: int = 10


@router.post(
    "/{asset_id}/refine",
    response_model=LibraryAssetDetailRead,
    status_code=status.HTTP_201_CREATED,
)
async def refine_library_asset(
    asset_id: str,
    body: RefineRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LibraryAssetDetailRead:
    """Refine an asset by sending the original image + original prompt + new instruction
    to the OpenAI image edit endpoint.

    Creates a new version linked to the source version via ``parent_version_id``
    and stores the refinement instruction.  The new version becomes the primary.
    Maximum 10 versions per asset (STORY-A3.1).
    """
    # 1. Find asset (non-deleted)
    stmt = (
        select(LibraryAsset, User.name.label("owner_name"))
        .join(User, LibraryAsset.user_id == User.id)
        .where(
            LibraryAsset.id == asset_id,
            LibraryAsset.deleted_at.is_(None),
        )
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Library asset not found",
        )

    asset, owner_name = row

    # 2. Resolve source version (from_version_id or primary)
    source_version: LibraryAssetVersion | None = None
    if body.from_version_id is not None:
        for v in asset.versions:
            if v.id == body.from_version_id:
                source_version = v
                break
        if source_version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source version not found",
            )
    else:
        if asset.primary_version_id:
            for v in asset.versions:
                if v.id == asset.primary_version_id:
                    source_version = v
                    break
        if source_version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No primary version found for this asset",
            )

    # 3. Source must have prompt_text (can't refine uploaded w/o prompt)
    if source_version.prompt_text is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot refine: source version has no prompt (uploaded asset)",
        )

    # 4. Check version count <= 10
    if len(asset.versions) >= MAX_VERSIONS_PER_ASSET:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum {MAX_VERSIONS_PER_ASSET} versions per asset",
        )

    # 5. Check service availability
    if not image_client.available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image generation service unavailable",
        )

    # 6. Build combined prompt: original prompt + refinement instruction
    combined_prompt = f"{source_version.prompt_text}\n\nRefinement: {body.instruction}"

    # 7. Resolve the source image file path (storage_path is relative)
    absolute_source_path = str(Path(source_version.storage_path))

    # 8. Call image_client.edit_image
    size_str = f"{source_version.width}x{source_version.height}"
    try:
        result = await image_client.edit_image(
            image_path=absolute_source_path,
            prompt=combined_prompt,
            size=size_str,
            quality="high",
        )
    except ImageContentPolicyError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="refine",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="rejected",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Content policy violation: {exc}",
        ) from exc
    except ImageRateLimitError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="refine",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: {exc}",
        ) from exc
    except ImageTimeoutError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="refine",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Refinement timed out",
        ) from exc
    except ImageGenerationError as exc:
        logger.error("Image refinement failed: %s", exc)
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="refine",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image refinement failed. Please try again.",
        ) from exc

    # 9. Determine next version number
    max_version_number = max(v.version_number for v in asset.versions)
    next_version_number = max_version_number + 1

    # 10. Move generated file to proper storage path
    version_id = str(uuid.uuid4())
    asset_dir = LIBRARY_ASSETS_UPLOAD_DIR / str(current_user.id) / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)

    dest_path = asset_dir / f"v{next_version_number}.png"
    shutil.move(result.image_path, str(dest_path))

    # 11. Generate 200x200 thumbnail
    thumb_path = asset_dir / f"v{next_version_number}_thumb.png"
    await asyncio.to_thread(_generate_thumbnail, dest_path, thumb_path)

    # Relative storage paths (for DB and URL construction)
    storage_path = (
        f"uploads/assets/{current_user.id}/{asset_id}/v{next_version_number}.png"
    )
    thumbnail_path = (
        f"uploads/assets/{current_user.id}/{asset_id}/v{next_version_number}_thumb.png"
    )

    # 12. Create new LibraryAssetVersion row
    now = datetime.now(tz=timezone.utc)
    new_version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=next_version_number,
        parent_version_id=source_version.id,
        storage_path=storage_path,
        thumbnail_path=thumbnail_path,
        prompt_text=result.assembled_prompt,
        refinement_instruction=body.instruction,
        width=result.width,
        height=result.height,
        file_size_bytes=result.file_size_bytes,
        mime_type="image/png",
        model_used=result.model,
        cost_usd=float(result.cost_usd),
        latency_ms=result.latency_ms,
        created_at=now,
    )
    db.add(new_version)

    # 13. Update primary_version_id to the new version
    asset.primary_version_id = version_id
    asset.updated_at = now

    # Flush so that the FK from generation_logs is satisfiable
    await db.flush()

    # 14. Create GenerationLog row for cost tracking
    gen_log = GenerationLog(
        user_id=current_user.id,
        asset_id=asset_id,
        asset_version_id=version_id,
        operation="refine",
        model=result.model,
        prompt_text=result.assembled_prompt,
        cost_usd=result.cost_usd,
        latency_ms=result.latency_ms,
        status="success",
    )
    db.add(gen_log)

    await db.commit()

    # 15. Re-fetch versions for the response (includes the new one)
    db.expire_all()
    refetch_stmt = (
        select(LibraryAsset)
        .where(LibraryAsset.id == asset_id)
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    asset = (await db.execute(refetch_stmt)).scalar_one()

    tags_list = [t.tag for t in asset.tags_rel]
    versions_read = [_build_version_read(request, v) for v in asset.versions]

    # Find the new primary version in the refreshed list
    pv: LibraryAssetVersion | None = None
    for v in asset.versions:
        if v.id == asset.primary_version_id:
            pv = v
            break

    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tags_list,
        created_by_name=owner_name,
        primary_version=(_build_version_read(request, pv) if pv else None),
        created_at=asset.created_at,
        versions=versions_read,
    )


# ---------------------------------------------------------------------------
# POST /{asset_id}/mask-edit  -- mask-based image edit (STORY-A4.2)
# ---------------------------------------------------------------------------

# PNG magic bytes: first 8 bytes of every valid PNG file.
_PNG_MAGIC: bytes = b"\x89PNG\r\n\x1a\n"


@router.post(
    "/{asset_id}/mask-edit",
    response_model=LibraryAssetDetailRead,
    status_code=status.HTTP_201_CREATED,
)
async def mask_edit_library_asset(
    asset_id: str,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mask: UploadFile,
    instruction: Annotated[str, Form(min_length=5, max_length=2000)],
    from_version_id: Annotated[str | None, Form()] = None,
) -> LibraryAssetDetailRead:
    """Apply a mask-based edit to an existing asset image.

    The client draws a mask (PNG with transparent pixels = edit region)
    and submits it alongside a text instruction.  The backend passes the
    source image, mask, and instruction to the OpenAI ``images.edit``
    endpoint and stores the result as a new version (STORY-A4.2).

    Maximum 10 versions per asset.
    """
    # 1. Find asset (non-deleted)
    stmt = (
        select(LibraryAsset, User.name.label("owner_name"))
        .join(User, LibraryAsset.user_id == User.id)
        .where(
            LibraryAsset.id == asset_id,
            LibraryAsset.deleted_at.is_(None),
        )
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Library asset not found",
        )

    asset, owner_name = row

    # 2. Resolve source version (from_version_id or primary)
    source_version: LibraryAssetVersion | None = None
    if from_version_id is not None:
        for v in asset.versions:
            if v.id == from_version_id:
                source_version = v
                break
        if source_version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source version not found",
            )
    else:
        if asset.primary_version_id:
            for v in asset.versions:
                if v.id == asset.primary_version_id:
                    source_version = v
                    break
        if source_version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No primary version found for this asset",
            )

    # 3. Source must have storage_path (422 if not)
    if not source_version.storage_path:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot mask-edit: source version has no storage path",
        )

    # 4. Check version count <= 10
    if len(asset.versions) >= MAX_VERSIONS_PER_ASSET:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum {MAX_VERSIONS_PER_ASSET} versions per asset",
        )

    # 5. Read mask bytes and validate it's a PNG (magic bytes check)
    mask_bytes = await mask.read()
    if not mask_bytes or not mask_bytes[:8].startswith(_PNG_MAGIC):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Mask must be a PNG image",
        )

    # 6. Check service availability
    if not image_client.available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image generation service unavailable",
        )

    # 7. Save mask to a temp file
    temp_mask_fd, temp_mask_path = tempfile.mkstemp(suffix=".png")
    try:
        os.write(temp_mask_fd, mask_bytes)
        os.close(temp_mask_fd)

        # 8. Resolve source image path
        source_path = str(Path(source_version.storage_path))

        # 9. Build prompt from instruction
        prompt = instruction

        # 10. Call image_client.edit_image with mask
        size_str = f"{source_version.width}x{source_version.height}"
        try:
            result = await image_client.edit_image(
                image_path=source_path,
                prompt=prompt,
                mask_path=temp_mask_path,
                size=size_str,
                quality="high",
            )
        except ImageContentPolicyError as exc:
            gen_log = GenerationLog(
                user_id=current_user.id,
                asset_id=asset_id,
                operation="mask_edit",
                model=image_client.model,
                cost_usd=Decimal("0"),
                latency_ms=0,
                status="rejected",
                error_message=str(exc),
            )
            db.add(gen_log)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Content policy violation: {exc}",
            ) from exc
        except ImageRateLimitError as exc:
            gen_log = GenerationLog(
                user_id=current_user.id,
                asset_id=asset_id,
                operation="mask_edit",
                model=image_client.model,
                cost_usd=Decimal("0"),
                latency_ms=0,
                status="failed",
                error_message=str(exc),
            )
            db.add(gen_log)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: {exc}",
            ) from exc
        except ImageTimeoutError as exc:
            gen_log = GenerationLog(
                user_id=current_user.id,
                asset_id=asset_id,
                operation="mask_edit",
                model=image_client.model,
                cost_usd=Decimal("0"),
                latency_ms=0,
                status="failed",
                error_message=str(exc),
            )
            db.add(gen_log)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Mask edit timed out",
            ) from exc
        except ImageGenerationError as exc:
            logger.error("Mask edit failed: %s", exc)
            gen_log = GenerationLog(
                user_id=current_user.id,
                asset_id=asset_id,
                operation="mask_edit",
                model=image_client.model,
                cost_usd=Decimal("0"),
                latency_ms=0,
                status="failed",
                error_message=str(exc),
            )
            db.add(gen_log)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Mask edit failed. Please try again.",
            ) from exc

    finally:
        # 16. Clean up temp mask file
        if os.path.exists(temp_mask_path):
            os.unlink(temp_mask_path)

    # 11. Store result + thumbnail as new version
    max_version_number = max(v.version_number for v in asset.versions)
    next_version_number = max_version_number + 1

    version_id = str(uuid.uuid4())
    asset_dir = LIBRARY_ASSETS_UPLOAD_DIR / str(current_user.id) / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)

    dest_path = asset_dir / f"v{next_version_number}.png"
    shutil.move(result.image_path, str(dest_path))

    thumb_path = asset_dir / f"v{next_version_number}_thumb.png"
    await asyncio.to_thread(_generate_thumbnail, dest_path, thumb_path)

    storage_path = (
        f"uploads/assets/{current_user.id}/{asset_id}/v{next_version_number}.png"
    )
    thumbnail_path = (
        f"uploads/assets/{current_user.id}/{asset_id}/v{next_version_number}_thumb.png"
    )

    # 12. Create LibraryAssetVersion with refinement_instruction + parent_version_id
    now = datetime.now(tz=timezone.utc)
    new_version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=next_version_number,
        parent_version_id=source_version.id,
        storage_path=storage_path,
        thumbnail_path=thumbnail_path,
        prompt_text=result.assembled_prompt,
        refinement_instruction=instruction,
        width=result.width,
        height=result.height,
        file_size_bytes=result.file_size_bytes,
        mime_type="image/png",
        model_used=result.model,
        cost_usd=float(result.cost_usd),
        latency_ms=result.latency_ms,
        created_at=now,
    )
    db.add(new_version)

    # Update primary_version_id to the new version
    asset.primary_version_id = version_id
    asset.updated_at = now

    # Flush so that the FK from generation_logs is satisfiable
    await db.flush()

    # 13. Create GenerationLog with operation="mask_edit"
    gen_log = GenerationLog(
        user_id=current_user.id,
        asset_id=asset_id,
        asset_version_id=version_id,
        operation="mask_edit",
        model=result.model,
        prompt_text=result.assembled_prompt,
        cost_usd=result.cost_usd,
        latency_ms=result.latency_ms,
        status="success",
    )
    db.add(gen_log)

    # 14. Commit
    await db.commit()

    # 15. Re-fetch versions for the response
    db.expire_all()
    refetch_stmt = (
        select(LibraryAsset)
        .where(LibraryAsset.id == asset_id)
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    asset = (await db.execute(refetch_stmt)).scalar_one()

    tags_list = [t.tag for t in asset.tags_rel]
    versions_read = [_build_version_read(request, v) for v in asset.versions]

    pv: LibraryAssetVersion | None = None
    for v in asset.versions:
        if v.id == asset.primary_version_id:
            pv = v
            break

    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tags_list,
        created_by_name=owner_name,
        primary_version=(_build_version_read(request, pv) if pv else None),
        created_at=asset.created_at,
        versions=versions_read,
    )


# ---------------------------------------------------------------------------
# POST /{asset_id}/edit-prompt  -- edit prompt & regenerate (STORY-A3.3)
# ---------------------------------------------------------------------------


@router.post(
    "/{asset_id}/edit-prompt",
    response_model=LibraryAssetDetailRead,
    status_code=status.HTTP_201_CREATED,
)
async def edit_prompt_and_regenerate(
    asset_id: str,
    body: EditPromptRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LibraryAssetDetailRead:
    """Edit the prompt and generate a fresh image (no image input).

    Creates a new version using the modified prompt.  The new version becomes
    the primary.  Unlike refine, this is a fresh generation -- the original
    image is NOT sent to the API.  ``refinement_instruction`` is ``None``.
    Maximum 10 versions per asset (STORY-A3.3).
    """
    # 1. Find asset (non-deleted)
    stmt = (
        select(LibraryAsset, User.name.label("owner_name"))
        .join(User, LibraryAsset.user_id == User.id)
        .where(
            LibraryAsset.id == asset_id,
            LibraryAsset.deleted_at.is_(None),
        )
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Library asset not found",
        )

    asset, owner_name = row

    # 2. Resolve source version (from_version_id or primary)
    source_version: LibraryAssetVersion | None = None
    if body.from_version_id is not None:
        for v in asset.versions:
            if v.id == body.from_version_id:
                source_version = v
                break
        if source_version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source version not found",
            )
    else:
        if asset.primary_version_id:
            for v in asset.versions:
                if v.id == asset.primary_version_id:
                    source_version = v
                    break
        if source_version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No primary version found for this asset",
            )

    # 3. Source must be a generated asset (must have prompt_text)
    if source_version.prompt_text is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot edit prompt: source version has no prompt (uploaded asset)",
        )

    # 4. Check version count <= 10
    if len(asset.versions) >= MAX_VERSIONS_PER_ASSET:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum {MAX_VERSIONS_PER_ASSET} versions per asset",
        )

    # 5. Check service availability
    if not image_client.available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image generation service unavailable",
        )

    # 6. Build ImageGenerationRequest with the NEW prompt and source dimensions
    gen_request = ImageGenerationRequest(
        prompt=body.prompt,
        width=source_version.width or 1024,
        height=source_version.height or 512,
        quality="high",
    )

    # 7. Call image_client.generate_image (fresh generation, no image input)
    try:
        result = await image_client.generate_image(gen_request)
    except ImageContentPolicyError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="rejected",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Content policy violation: {exc}",
        ) from exc
    except ImageRateLimitError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: {exc}",
        ) from exc
    except ImageTimeoutError as exc:
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Generation timed out",
        ) from exc
    except ImageGenerationError as exc:
        logger.error("Edit-prompt generation failed: %s", exc)
        gen_log = GenerationLog(
            user_id=current_user.id,
            asset_id=asset_id,
            operation="generate",
            model=image_client.model,
            cost_usd=Decimal("0"),
            latency_ms=0,
            status="failed",
            error_message=str(exc),
        )
        db.add(gen_log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image generation failed. Please try again.",
        ) from exc

    # 8. Determine next version number
    max_version_number = max(v.version_number for v in asset.versions)
    next_version_number = max_version_number + 1

    # 9. Move generated file to proper storage path
    version_id = str(uuid.uuid4())
    asset_dir = LIBRARY_ASSETS_UPLOAD_DIR / str(current_user.id) / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)

    dest_path = asset_dir / f"v{next_version_number}.png"
    shutil.move(result.image_path, str(dest_path))

    # 10. Generate 200x200 thumbnail
    thumb_path = asset_dir / f"v{next_version_number}_thumb.png"
    await asyncio.to_thread(_generate_thumbnail, dest_path, thumb_path)

    # Relative storage paths (for DB and URL construction)
    storage_path = (
        f"uploads/assets/{current_user.id}/{asset_id}/v{next_version_number}.png"
    )
    thumbnail_path = (
        f"uploads/assets/{current_user.id}/{asset_id}/v{next_version_number}_thumb.png"
    )

    # 11. Create new LibraryAssetVersion row
    now = datetime.now(tz=timezone.utc)
    new_version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=next_version_number,
        parent_version_id=source_version.id,
        storage_path=storage_path,
        thumbnail_path=thumbnail_path,
        prompt_text=result.assembled_prompt,
        refinement_instruction=None,  # fresh generation, not a refinement
        width=result.width,
        height=result.height,
        file_size_bytes=result.file_size_bytes,
        mime_type="image/png",
        model_used=result.model,
        cost_usd=float(result.cost_usd),
        latency_ms=result.latency_ms,
        created_at=now,
    )
    db.add(new_version)

    # 12. Update primary_version_id to the new version
    asset.primary_version_id = version_id
    asset.updated_at = now

    # Flush so that the FK from generation_logs is satisfiable
    await db.flush()

    # 13. Create GenerationLog row for cost tracking
    gen_log = GenerationLog(
        user_id=current_user.id,
        asset_id=asset_id,
        asset_version_id=version_id,
        operation="generate",
        model=result.model,
        prompt_text=result.assembled_prompt,
        cost_usd=result.cost_usd,
        latency_ms=result.latency_ms,
        status="success",
    )
    db.add(gen_log)

    await db.commit()

    # 14. Re-fetch versions for the response (includes the new one)
    db.expire_all()
    refetch_stmt = (
        select(LibraryAsset)
        .where(LibraryAsset.id == asset_id)
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    asset = (await db.execute(refetch_stmt)).scalar_one()

    tags_list = [t.tag for t in asset.tags_rel]
    versions_read = [_build_version_read(request, v) for v in asset.versions]

    # Find the new primary version in the refreshed list
    pv: LibraryAssetVersion | None = None
    for v in asset.versions:
        if v.id == asset.primary_version_id:
            pv = v
            break

    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tags_list,
        created_by_name=owner_name,
        primary_version=(_build_version_read(request, pv) if pv else None),
        created_at=asset.created_at,
        versions=versions_read,
    )


# ---------------------------------------------------------------------------
# POST /library-assets/upload  -- upload an image and create asset
# ---------------------------------------------------------------------------


def _extract_dimensions(
    file_bytes: bytes, mime_type: str
) -> tuple[int | None, int | None]:
    """Extract width/height from image bytes. Returns (None, None) for SVG."""
    if mime_type == "image/svg+xml":
        return None, None
    import io

    with Image.open(io.BytesIO(file_bytes)) as img:
        return img.size  # (width, height)


@router.post(
    "/upload",
    response_model=LibraryAssetDetailRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_library_asset(
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile,
    name: Annotated[str, Form()],
    tags: Annotated[str | None, Form()] = None,
) -> LibraryAssetDetailRead:
    """Upload an image file and persist it as a library asset.

    Creates a LibraryAsset with source='uploaded', a single
    LibraryAssetVersion (v1), and optional comma-separated tags.

    Accepts: PNG, JPEG, WebP, GIF, SVG. Max 50 MB per file.
    """
    # 1. Validate MIME type
    mime_type = file.content_type or ""
    if mime_type not in UPLOAD_ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unsupported file type: {mime_type!r}. "
                f"Allowed: {sorted(UPLOAD_ALLOWED_MIME_TYPES)}"
            ),
        )

    # 2. Read file bytes and validate size
    file_bytes = await file.read()
    if len(file_bytes) > UPLOAD_MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File exceeds 50 MB limit",
        )

    # 3. Extract image dimensions (sync CPU work -> run in thread)
    width, height = await asyncio.to_thread(_extract_dimensions, file_bytes, mime_type)

    # 4. Generate UUIDs
    asset_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())

    # 5. Determine file extension and store file on disk
    ext = _MIME_TO_EXT.get(mime_type, "bin")
    asset_dir = LIBRARY_ASSETS_UPLOAD_DIR / str(current_user.id) / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)

    dest_path = asset_dir / f"v1.{ext}"
    dest_path.write_bytes(file_bytes)

    # 6. Generate thumbnail (skip for SVG)
    thumbnail_path_str: str | None = None
    if mime_type != "image/svg+xml":
        thumb_path = asset_dir / "v1_thumb.png"
        await asyncio.to_thread(_generate_thumbnail, dest_path, thumb_path)
        thumbnail_path_str = f"uploads/assets/{current_user.id}/{asset_id}/v1_thumb.png"

    # Relative storage path (for DB and URL construction)
    storage_path = f"uploads/assets/{current_user.id}/{asset_id}/v1.{ext}"

    # 7. Parse tags from comma-separated string
    tag_list: list[str] = []
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    # 8. Create LibraryAsset row
    now = datetime.now(tz=timezone.utc)
    asset = LibraryAsset(
        id=asset_id,
        user_id=current_user.id,
        name=name,
        source="uploaded",
        primary_version_id=version_id,
        created_at=now,
        updated_at=now,
    )
    db.add(asset)

    # 9. Create LibraryAssetVersion row
    version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=1,
        storage_path=storage_path,
        thumbnail_path=thumbnail_path_str,
        prompt_text=None,
        width=width,
        height=height,
        file_size_bytes=len(file_bytes),
        mime_type=mime_type,
        model_used=None,
        cost_usd=None,
        latency_ms=None,
        created_at=now,
    )
    db.add(version)

    # 10. Create tag rows
    for tag in tag_list:
        db.add(LibraryAssetTag(asset_id=asset_id, tag=tag))

    await db.commit()

    # 11. Return LibraryAssetDetailRead
    version_read = _build_version_read(request, version)
    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tag_list,
        created_by_name=current_user.name,
        primary_version=version_read,
        created_at=asset.created_at,
        versions=[version_read],
    )


# ---------------------------------------------------------------------------
# PATCH /library-assets/{asset_id}/primary-version  -- set primary version (STORY-A3.2)
# ---------------------------------------------------------------------------


@router.patch("/{asset_id}/primary-version", response_model=LibraryAssetDetailRead)
async def set_primary_version(
    asset_id: str,
    body: SetPrimaryVersionRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LibraryAssetDetailRead:
    """Set the primary version of an asset to a specific version.

    The target version must belong to this asset.  Returns the full
    asset detail including all versions (STORY-A3.2).
    """
    # 1. Find asset (non-deleted) with versions and tags
    stmt = (
        select(LibraryAsset, User.name.label("owner_name"))
        .join(User, LibraryAsset.user_id == User.id)
        .where(
            LibraryAsset.id == asset_id,
            LibraryAsset.deleted_at.is_(None),
        )
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Library asset not found",
        )

    asset, owner_name = row

    # 2. Verify version_id belongs to this asset
    target_version: LibraryAssetVersion | None = None
    for v in asset.versions:
        if v.id == body.version_id:
            target_version = v
            break

    if target_version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found for this asset",
        )

    # 3. Set primary_version_id
    asset.primary_version_id = body.version_id
    asset.updated_at = datetime.now(tz=timezone.utc)
    await db.commit()

    # 4. Build and return LibraryAssetDetailRead
    tags_list = [t.tag for t in asset.tags_rel]
    versions_read = [_build_version_read(request, v) for v in asset.versions]
    pv_read = _build_version_read(request, target_version)

    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tags_list,
        created_by_name=owner_name,
        primary_version=pv_read,
        created_at=asset.created_at,
        versions=versions_read,
    )


# ---------------------------------------------------------------------------
# PATCH /library-assets/{asset_id}  -- update name and/or tags (STORY-A1.3)
# ---------------------------------------------------------------------------


@router.patch("/{asset_id}", response_model=LibraryAssetDetailRead)
async def update_library_asset(
    asset_id: str,
    body: LibraryAssetUpdate,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LibraryAssetDetailRead:
    """Update an asset's name and/or tags.

    If ``tags`` is provided the existing tags are fully replaced.
    Returns the full asset detail (with versions) like GET detail.
    """
    # Load asset + owner name + relationships
    stmt = (
        select(LibraryAsset, User.name.label("owner_name"))
        .join(User, LibraryAsset.user_id == User.id)
        .where(
            LibraryAsset.id == asset_id,
            LibraryAsset.deleted_at.is_(None),
        )
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Library asset not found",
        )

    asset, owner_name = row

    # Update name if provided
    if body.name is not None:
        asset.name = body.name

    # Replace tags if provided
    if body.tags is not None:
        # Delete all existing tags
        del_stmt = sa_delete(LibraryAssetTag).where(
            LibraryAssetTag.asset_id == asset_id
        )
        await db.execute(del_stmt)
        # Insert new tags
        for tag in body.tags:
            db.add(LibraryAssetTag(asset_id=asset_id, tag=tag))

    await db.commit()

    # Expire the cached asset so the re-fetch below actually hits the DB
    # for relationships (selectinload returns stale data otherwise).
    db.expire_all()

    # Re-fetch to get updated tags (the in-memory tags_rel may be stale)
    refetch_stmt = (
        select(LibraryAsset)
        .where(LibraryAsset.id == asset_id)
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    asset = (await db.execute(refetch_stmt)).scalar_one()

    # Resolve primary version
    pv: LibraryAssetVersion | None = None
    if asset.primary_version_id:
        for v in asset.versions:
            if v.id == asset.primary_version_id:
                pv = v
                break

    tags_list = [t.tag for t in asset.tags_rel]
    versions_read = [_build_version_read(request, v) for v in asset.versions]

    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tags_list,
        created_by_name=owner_name,
        primary_version=(_build_version_read(request, pv) if pv else None),
        created_at=asset.created_at,
        versions=versions_read,
    )


# ---------------------------------------------------------------------------
# GET /library-assets/{asset_id}  -- single asset detail with all versions
# ---------------------------------------------------------------------------


@router.get("/{asset_id}", response_model=LibraryAssetDetailRead)
async def get_library_asset(
    asset_id: str,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LibraryAssetDetailRead:
    """Return a single library asset with all its versions.

    Returns 404 if the asset does not exist or is soft-deleted.
    """
    stmt = (
        select(LibraryAsset, User.name.label("owner_name"))
        .join(User, LibraryAsset.user_id == User.id)
        .where(
            LibraryAsset.id == asset_id,
            LibraryAsset.deleted_at.is_(None),
        )
        .options(
            selectinload(LibraryAsset.tags_rel),
            selectinload(LibraryAsset.versions),
        )
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Library asset not found",
        )

    asset, owner_name = row

    # Resolve primary version
    pv: LibraryAssetVersion | None = None
    if asset.primary_version_id:
        for v in asset.versions:
            if v.id == asset.primary_version_id:
                pv = v
                break

    tags_list = [t.tag for t in asset.tags_rel]
    versions_read = [_build_version_read(request, v) for v in asset.versions]

    return LibraryAssetDetailRead(
        id=asset.id,
        name=asset.name,
        source=asset.source,
        tags=tags_list,
        created_by_name=owner_name,
        primary_version=(_build_version_read(request, pv) if pv else None),
        created_at=asset.created_at,
        versions=versions_read,
    )


# ---------------------------------------------------------------------------
# DELETE /library-assets/{asset_id}  -- soft-delete an asset (STORY-A1.6)
# ---------------------------------------------------------------------------


@router.delete(
    "/{asset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_library_asset(
    asset_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Soft-delete a library asset by setting ``deleted_at``.

    Files on disk are **not** removed so that existing emailers
    referencing the asset URLs continue to work.  The asset is
    hidden from list/detail queries but remains recoverable by
    an admin (STORY-A1.6).
    """
    stmt = select(LibraryAsset).where(
        LibraryAsset.id == asset_id,
        LibraryAsset.deleted_at.is_(None),
    )
    result = await db.execute(stmt)
    asset = result.scalar_one_or_none()

    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Library asset not found",
        )

    asset.deleted_at = datetime.now(tz=timezone.utc)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
