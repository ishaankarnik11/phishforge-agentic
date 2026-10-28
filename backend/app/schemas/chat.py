"""Pydantic v2 schemas for chat endpoints (stub).

Minimal stub to satisfy the import chain in schemas/__init__.py.
The full implementation will arrive with the chat/refinement story.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.emailer_version import EmailerVersionRead


class ChatMessageCreate(BaseModel):
    """Body for creating a chat message."""

    content: str = Field(..., min_length=1)


class ChatMessageRead(BaseModel):
    """Read representation of a chat message."""

    id: int
    emailer_id: int
    role: str
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RefineResponse(BaseModel):
    """Response from a refine/chat endpoint."""

    message: ChatMessageRead
    version: EmailerVersionRead
    summary: str
    warnings: list[str] = []
