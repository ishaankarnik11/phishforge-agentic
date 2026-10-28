"""Pydantic v2 schemas for emailer version endpoints (STORY-4.1, STORY-4.2)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class EmailerVersionCreate(BaseModel):
    """Body for POST /emailers/{emailer_id}/versions — save edited MJML."""

    mjml_source: str = Field(..., min_length=1)


class EmailerVersionRead(BaseModel):
    """Full version representation returned by GET /versions/{version_number}."""

    id: int
    emailer_id: int
    version_number: int
    mjml_source: str
    compiled_html: str | None
    subject_line: str | None
    preheader: str | None
    model_used: str | None
    input_tokens: int | None
    output_tokens: int | None
    change_summary: str | None = None
    source: str = "generation"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EmailerVersionSummary(BaseModel):
    """Slim view for the version list endpoint."""

    id: int
    version_number: int
    subject_line: str | None
    change_summary: str | None = None
    source: str = "generation"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
