"""Pydantic v2 schemas for authentication endpoints."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    """Payload for POST /auth/register."""

    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    name: str = Field(..., min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v.strip()


class LoginRequest(BaseModel):
    """Payload for POST /auth/login."""

    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    """Returned on successful register or login."""

    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    """Public user representation — never includes password_hash."""

    id: int
    email: EmailStr
    name: str | None
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}
