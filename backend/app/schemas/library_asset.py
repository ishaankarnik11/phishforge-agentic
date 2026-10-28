"""Pydantic schemas for the Asset Library (STORY-A1.1, STORY-A1.3, STORY-A2.1).

Covers list, detail, create, update, bulk-tag, and generate operations for
library assets, versions, and tags. These schemas are distinct from the
per-emailer ``AssetRead`` in ``app.schemas.asset``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LibraryAssetVersionRead(BaseModel):
    """Response schema for a single asset version."""

    id: str
    version_number: int
    thumbnail_url: str | None = None
    storage_url: str | None = None
    width: int | None = None
    height: int | None = None
    file_size_bytes: int | None = None
    prompt_text: str | None = None
    refinement_instruction: str | None = None
    model_used: str | None = None
    cost_usd: float | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LibraryAssetRead(BaseModel):
    """Response schema for a library asset card in the grid."""

    id: str
    name: str
    source: str  # 'generated' | 'uploaded'
    tags: list[str] = Field(default_factory=list)
    created_by_name: str | None = None
    primary_version: LibraryAssetVersionRead | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LibraryAssetListResponse(BaseModel):
    """Paginated list response for library assets."""

    items: list[LibraryAssetRead]
    total: int


class LibraryAssetDetailRead(LibraryAssetRead):
    """Full detail response including all versions."""

    versions: list[LibraryAssetVersionRead] = Field(default_factory=list)


class LibraryAssetCreate(BaseModel):
    """Request body when creating a library asset shell (before upload/generation)."""

    name: str = Field(..., min_length=1, max_length=255)
    tags: list[str] | None = None


# ---------------------------------------------------------------------------
# STORY-A1.3: Tag management schemas
# ---------------------------------------------------------------------------


class LibraryAssetUpdate(BaseModel):
    """Request body for PATCH /library-assets/{asset_id}."""

    name: str | None = Field(None, min_length=1, max_length=255)
    tags: list[str] | None = None


class BulkTagRequest(BaseModel):
    """Request body for POST /library-assets/bulk-tag."""

    asset_ids: list[str] = Field(..., min_length=1)
    action: Literal["add", "remove"]
    tags: list[str] = Field(..., min_length=1)


class BulkTagResponse(BaseModel):
    """Response body for POST /library-assets/bulk-tag."""

    updated: int


# ---------------------------------------------------------------------------
# STORY-A2.1: Generate image request schemas
# ---------------------------------------------------------------------------


class StylePresetsInput(BaseModel):
    """Style presets for image generation (4 orthogonal axes)."""

    visual_style: str | None = None
    mood: str | None = None
    texture: str | None = None
    layout: str | None = None


class GenerateAssetRequest(BaseModel):
    """Request body for POST /library-assets/generate."""

    name: str = Field(..., min_length=1, max_length=255)
    prompt: str = Field(..., min_length=10, max_length=2000)
    style_presets: StylePresetsInput | None = None
    width: int = Field(default=1024, ge=320, le=1024)
    height: int = Field(default=512, ge=320, le=1024)
    quality: str = Field(default="high")
    tags: list[str] | None = None
    reference_images: list[str] | None = None

    @field_validator("width", "height")
    @classmethod
    def _must_be_multiple_of_16(cls, v: int) -> int:
        if v % 16 != 0:
            raise ValueError(f"Dimension must be a multiple of 16, got {v}")
        return v

    @field_validator("quality")
    @classmethod
    def _valid_quality(cls, v: str) -> str:
        allowed = {"low", "medium", "high"}
        if v not in allowed:
            raise ValueError(f"quality must be one of {allowed}, got '{v}'")
        return v


# ---------------------------------------------------------------------------
# STORY-A2.3: Regenerate asset request schema
# ---------------------------------------------------------------------------


class RegenerateRequest(BaseModel):
    """Request body for POST /library-assets/{asset_id}/regenerate."""

    from_version_id: str | None = None
    """Which version to regenerate from. Defaults to primary version if None."""


# ---------------------------------------------------------------------------
# STORY-A3.1: Refine image request schema
# ---------------------------------------------------------------------------


class RefineRequest(BaseModel):
    """Request body for POST /library-assets/{asset_id}/refine."""

    instruction: str = Field(..., min_length=5, max_length=2000)
    """Natural-language refinement instruction to combine with the original prompt."""

    from_version_id: str | None = None
    """Which version to refine from. Defaults to primary version if None."""


# ---------------------------------------------------------------------------
# STORY-A3.3: Edit prompt and regenerate request schema
# ---------------------------------------------------------------------------


class EditPromptRequest(BaseModel):
    """Request body for POST /library-assets/{asset_id}/edit-prompt."""

    prompt: str = Field(..., min_length=10, max_length=2000)
    """New prompt to generate from (replaces the original prompt)."""

    from_version_id: str | None = None
    """Which version to use as the source. Defaults to primary version if None."""


# ---------------------------------------------------------------------------
# STORY-A3.2: Set primary version request schema
# ---------------------------------------------------------------------------


class SetPrimaryVersionRequest(BaseModel):
    """Request body for PATCH /library-assets/{asset_id}/primary-version."""

    version_id: str
