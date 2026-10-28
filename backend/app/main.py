"""FastAPI application factory."""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.assets import router as assets_router
from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.emailers import router as emailers_router
from app.api.export import router as export_router
from app.api.generate import router as generate_router
from app.api.impersonation_presets import router as impersonation_presets_router
from app.api.library_assets import router as library_assets_router
from app.api.preview_links import router as preview_links_router
from app.api.public_preview import router as public_preview_router
from app.api.versions import router as versions_router
from app.config import settings
from app.database import async_session_factory, get_db
from app.services.impersonation_preset_service import (
    seed_sample_presets as seed_presets,
)
from app.services.rate_limit_service import RateLimitExceeded
from app.services.seed_users import seed_users

logger = logging.getLogger(__name__)

# Ensure the uploads directory exists so StaticFiles doesn't fail on startup
UPLOADS_DIR = Path("uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Repo-committed brand assets (logos, etc.) referenced from brand kits
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: seed POC users on startup (STORY-8.2).

    On startup we open a short-lived ``AsyncSession`` and call
    :func:`app.services.seed_users.seed_users`, which is idempotent —
    running it on a clean DB inserts the three POC accounts, running it
    on a DB that already has them is a no-op.

    Seeding failures (DB unreachable, integrity error, etc.) are logged
    at ``ERROR`` but **do not crash the app**. The ``/healthz`` endpoint
    surfaces DB issues separately, and we'd rather start the API and
    return 503s from healthz than fail to boot at all.
    """
    try:
        async with async_session_factory() as session:
            persisted = await seed_users(session)
        logger.info(
            "Seed users ensured on startup: %d POC account(s) present (%s).",
            len(persisted),
            ", ".join(sorted(u.email for u in persisted)),
        )
    except Exception:  # noqa: BLE001 — see docstring; we deliberately swallow.
        logger.exception(
            "Seed users failed on startup; continuing without crashing the app. "
            "Check /healthz for DB connectivity."
        )

    # STORY-AP1.2: seed a couple of neutral SAMPLE impersonation presets so
    # the AP-1 demo flow works on a fresh DB. Idempotent; operator edits are
    # preserved. Failures are logged at ERROR but do not crash the app —
    # same posture as the user seed above.
    try:
        async with async_session_factory() as session:
            inserted = await seed_presets(session)
        logger.info(
            "Seed impersonation presets ensured on startup: %d row(s) newly inserted.",
            inserted,
        )
    except Exception:  # noqa: BLE001 — same swallow rationale as above.
        logger.exception(
            "Seed impersonation presets failed on startup; continuing without "
            "crashing the app. Check /healthz for DB connectivity."
        )

    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Acme Emailer API",
        version="0.1.0",
        description="Backend for the Acme Emailer Studio POC",
        lifespan=lifespan,
    )

    # CORS: origins are env-driven via ``ALLOWED_ORIGINS`` (comma-separated)
    # parsed into a ``list[str]`` by ``Settings`` (see app/config.py). Dev
    # default is the Vite origin so ``pnpm dev`` keeps working unchanged;
    # prod sets this to every public SPA origin (STORY-7.7).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limit_handler(
        _request: Request, exc: RateLimitExceeded
    ) -> JSONResponse:
        """Convert RateLimitExceeded into a 429 response with a stable JSON body.

        Body shape (STORY-7.4)::

            {"detail": "<human message>",
             "limit_type": "<machine key>",
             "limit": <int>}
        """
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "detail": exc.message,
                "limit_type": exc.limit_type,
                "limit": exc.limit,
            },
        )

    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(admin_router, prefix="/api/v1")
    app.include_router(impersonation_presets_router, prefix="/api/v1")
    app.include_router(emailers_router, prefix="/api/v1")
    app.include_router(export_router, prefix="/api/v1")
    app.include_router(assets_router, prefix="/api/v1")
    app.include_router(generate_router, prefix="/api/v1")
    app.include_router(library_assets_router, prefix="/api/v1")
    app.include_router(chat_router, prefix="/api/v1")
    app.include_router(versions_router, prefix="/api/v1")
    app.include_router(preview_links_router, prefix="/api/v1")
    app.include_router(public_preview_router, prefix="/api/v1")

    # ------------------------------------------------------------------
    # Test-seam introspection endpoint — STORY-7.11 AC-9.
    # ------------------------------------------------------------------
    # Mounted ONLY when the MJML_LLM_FAILURE_INJECT env var is non-empty
    # at process start. Production environments must never set the env
    # var, so this endpoint is invisible in prod. The router itself
    # imports cleanly with or without the env var; the gate here is a
    # belt-and-braces guarantee it cannot be reached when off.
    if os.environ.get("MJML_LLM_FAILURE_INJECT", "").strip():
        from app.api.test_seam import router as test_seam_router

        app.include_router(test_seam_router, prefix="/api/v1")
        logger.warning(
            "MJML_LLM_FAILURE_INJECT is set; mounting /api/v1/_test/* "
            "introspection endpoint (TEST-ONLY — must be unset in prod)."
        )

    # Serve uploaded assets as static files at /uploads/
    app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
    # Serve repo-committed brand assets (logos) at /static/
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/healthz", tags=["ops"])
    async def healthz(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
        try:
            await db.execute(text("SELECT 1"))
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Database unreachable") from exc
        return {"status": "ok", "database": "connected"}

    return app


app = create_app()
