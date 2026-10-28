"""Pydantic schemas for asset upload and management (STORY-2.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# STORY-AP2.3: an asset is either an in-email image ("content", the default)
# or a screenshot of the real email the model should mimic ("sample").
AssetKind = Literal["content", "sample"]
ALLOWED_ASSET_KINDS: frozenset[str] = frozenset({"content", "sample"})

ALLOWED_MIME_TYPES: frozenset[str] = frozenset(
    {
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/svg+xml",
    }
)

MAX_FILE_SIZE_BYTES: int = 5 * 1024 * 1024  # 5 MB
MAX_ASSETS_PER_EMAILER: int = 10


class AssetRead(BaseModel):
    """Response schema for a single asset."""

    id: str
    emailer_id: int
    filename: str
    label: str
    mime_type: str
    kind: AssetKind  # STORY-AP2.3: "content" (embedded) | "sample" (mimic only)
    size_bytes: int
    url: str  # absolute URL computed at response time
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetLabelUpdate(BaseModel):
    """Request body for PATCH /{asset_id} — update the human-readable label."""

    label: str = Field(..., min_length=1, max_length=255)
