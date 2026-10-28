"""File-system asset storage helpers (STORY-2.2).

Files are written to  uploads/{emailer_id}/{uuid}_{filename}
relative to the directory from which the backend process runs (backend/).

The UPLOAD_DIR module-level constant is intentionally a plain Path so that
tests can monkeypatch it to a temp directory without side-effects.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from urllib.parse import quote, unquote

from fastapi import Request

# Relative to cwd — backend/ when running uvicorn or pytest
UPLOAD_DIR: Path = Path("uploads")


def save_file(emailer_id: int, filename: str, data: bytes) -> str:
    """Write *data* to disk and return the storage path (relative to UPLOAD_DIR).

    The returned path is of the form ``{emailer_id}/{uuid}_{filename}``.
    This is stored in the DB so it can later be used to build the URL or
    delete the file.
    """
    dest_dir = UPLOAD_DIR / str(emailer_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    unique_name = f"{uuid.uuid4().hex}_{filename}"
    dest = dest_dir / unique_name
    dest.write_bytes(data)

    # Return path relative to UPLOAD_DIR, using forward slashes (URL-safe)
    return f"{emailer_id}/{unique_name}"


def save_preset_logo(preset_slug: str, filename: str, data: bytes) -> str:
    """Write a preset logo to disk and return its storage path.

    Presets aren't tied to an emailer, so they live under a dedicated
    ``presets/{preset_slug}/`` subtree of UPLOAD_DIR. The returned path is
    of the form ``presets/{preset_slug}/{uuid}_{filename}`` (relative to
    UPLOAD_DIR), suitable for building a ``/uploads/...`` URL.
    """
    dest_dir = UPLOAD_DIR / "presets" / preset_slug
    dest_dir.mkdir(parents=True, exist_ok=True)

    unique_name = f"{uuid.uuid4().hex}_{filename}"
    dest = dest_dir / unique_name
    dest.write_bytes(data)

    return f"presets/{preset_slug}/{unique_name}"


def read_file(storage_path: str) -> bytes:
    """Return the bytes of the file at *storage_path* (relative to UPLOAD_DIR).

    Raises ``FileNotFoundError`` if the file does not exist. Used to copy a
    preset's stored logo into an emailer-scoped asset.
    """
    return (UPLOAD_DIR / storage_path).read_bytes()


def storage_path_from_upload_url(logo_url: str) -> str | None:
    """Extract the UPLOAD_DIR-relative storage path from a logo URL.

    Preset ``logo_url`` values produced by ``save_preset_logo`` are stored
    as ``/uploads/presets/...`` (or an absolute URL ending in
    ``/uploads/...``). Returns the path after ``/uploads/`` so the file can
    be read back, or ``None`` when the URL is not an uploads-served path.
    """
    marker = "/uploads/"
    idx = logo_url.find(marker)
    if idx == -1:
        return None
    return unquote(logo_url[idx + len(marker) :])


def delete_file(storage_path: str) -> None:
    """Remove the file at *storage_path* (relative to UPLOAD_DIR).

    Silently ignores the call if the file does not exist — idempotent.
    """
    target = UPLOAD_DIR / storage_path
    try:
        target.unlink()
    except FileNotFoundError:
        pass


def get_asset_url(request: Request, storage_path: str) -> str:
    """Build the absolute URL for an asset so callers (including the AI pipeline)
    can reference it without knowing the server's hostname at write time.

    Example: ``http://localhost:8000/uploads/42/abc123_hero.png``

    storage_path is percent-encoded (path-safe) so non-ASCII filenames —
    e.g. macOS screenshots whose default name contains U+202F (narrow
    no-break space between time and AM/PM) — survive the round-trip
    through HTML / JSON / browser URL parsing without being normalized to
    a regular space, which would 404 against StaticFiles. See ADR-034.
    """
    base = str(request.base_url).rstrip("/")
    return f"{base}/uploads/{quote(storage_path)}"
