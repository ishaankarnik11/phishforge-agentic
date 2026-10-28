"""Application settings loaded from environment / .env file.

STORY-7.7 posture:

* ``DATABASE_URL``, ``SECRET_KEY`` and ``ANTHROPIC_API_KEY`` are **required**
  at process start. There is no fallback default — Pydantic raises
  ``ValidationError`` on construction if any is missing. This is the
  fail-fast behaviour we want in prod (and ``backend/.env`` covers it
  for local dev).
* ``FRONTEND_URL`` and ``PUBLIC_BACKEND_URL`` keep ``localhost`` defaults
  so existing local dev / test flows are unaffected, but **must be
  overridden in any non-localhost deployment** (the values are baked
  into share links and exported HTML respectively).
* ``ALLOWED_ORIGINS`` is a comma-separated list of CORS origins parsed
  into ``list[str]``. Dev default is the Vite origin so ``pnpm dev``
  keeps working unchanged.
"""

from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    # ----- Required in every environment (no safe default) -----------
    # MySQL connection string. Prod points at the compose ``mysql``
    # service host; local dev typically uses ``localhost``.
    DATABASE_URL: str = Field(...)

    # JWT signing key. Rotate on every prod deploy — rotating
    # invalidates outstanding tokens (forces re-login).
    SECRET_KEY: str = Field(...)

    # Anthropic API key — every ``/generate`` call requires it.
    ANTHROPIC_API_KEY: str = Field(...)

    # ----- OpenAI (Asset Library image generation) --------------------
    # Optional — app starts without it; image generation endpoints
    # return 503 if called without a configured key.
    OPENAI_API_KEY: str | None = None
    OPENAI_IMAGE_MODEL: str = "gpt-image-1-mini"
    OPENAI_IMAGE_QUALITY: str = "low"
    OPENAI_IMAGE_TIMEOUT: int = 180

    # ----- Auth ------------------------------------------------------
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120

    # ----- LangSmith (optional; tracing silently skipped when absent)
    LANGSMITH_API_KEY: str | None = None
    LANGSMITH_PROJECT: str = "phishforge-poc"

    # ----- Public-facing URLs ---------------------------------------
    # Frontend origin used to build shareable preview URLs (STORY-4.5).
    # Default matches the Vite dev origin so local dev keeps working;
    # **MUST be overridden in any non-localhost deployment** (the value
    # is embedded in /share/<token> links shown to recipients).
    FRONTEND_URL: str = "http://localhost:5173"

    # Publicly reachable origin of THIS backend. Prepended to relative
    # asset paths (e.g. brand-kit logos stored as ``/static/brand/foo.svg``)
    # before the URL is baked into a generated email or returned to the
    # frontend. Default is the local uvicorn origin so dev/tests keep
    # working; **MUST be overridden in any non-localhost deployment**
    # so the exported HTML reaches a real CDN/host instead of localhost.
    PUBLIC_BACKEND_URL: str = "http://localhost:8000"

    # ----- CORS ------------------------------------------------------
    # Comma-separated list of origins permitted to call the API. Parsed
    # by the validator below into a ``list[str]`` (whitespace stripped,
    # empty entries dropped). Default is the Vite dev origin so local
    # dev keeps working without an env override. In prod this must list
    # every public origin the SPA is served from.
    #
    # ``NoDecode`` disables pydantic-settings' built-in JSON parsing for
    # complex types (``list[str]`` would otherwise be passed through
    # ``json.loads`` first). With ``NoDecode``, the raw env string flows
    # straight into the validator below, which does the comma split.
    ALLOWED_ORIGINS: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    # ----- Refiner model override (ADR-007 default = "haiku") -------
    REFINER_MODEL: str = "haiku"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def _split_allowed_origins(cls, value: object) -> object:
        """Accept a comma-separated string OR a list and normalise to ``list[str]``.

        Pydantic-Settings reads env vars as strings, so the raw ``ALLOWED_ORIGINS``
        env var arrives here as e.g. ``"https://a.com, https://b.com"``. We split
        on commas, strip whitespace and drop empties. Lists pass through (used
        by tests that construct ``Settings(ALLOWED_ORIGINS=[...])`` directly).
        """
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


settings = Settings()
