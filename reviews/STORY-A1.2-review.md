# QA Review: STORY-A1.2 — Upload own images to library

**Reviewer:** qa-reviewer
**Date:** 2026-05-06
**Branch:** sprint-10/STORY-A1.2-upload-images
**Verdict:** APPROVE

---

## Acceptance Criteria Checklist

| # | Criterion | Status | Evidence |
|---|---|---|---|
| AC-1 | Upload via drag-drop or file picker | PASS | `UploadAssetModal.tsx` lines 367-414 (drop zone with `onDrop`, `onDragEnter`, `onDragLeave`) and hidden `<input type="file">` with `openPicker()`. Frontend tests confirm both paths (tests: "shows preview when a file is dropped", "shows preview and pre-fills name when a file is selected via picker"). |
| AC-2 | Accepts: PNG, JPEG, WebP, GIF, SVG | PASS | Backend: `UPLOAD_ALLOWED_MIME_TYPES` frozenset contains all 5 MIME types. Frontend: `ALLOWED_MIME_TYPES` array and `accept` attribute match. Client-side + server-side validation both enforce. |
| AC-3 | Max file size: 50 MB per file | PASS | Backend: `UPLOAD_MAX_FILE_SIZE = 50 * 1024 * 1024`, checked after `file.read()`. Frontend: `MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024`, checked before network call. Tests: `test_upload_file_too_large` (backend), "shows error when file is too large" (frontend). |
| AC-4 | On upload: auto-generates thumbnail, extracts dimensions, computes file size | PASS | Backend: `_generate_thumbnail()` creates 200x200 PNG thumbnail via Pillow. `_extract_dimensions()` extracts width/height. `file_size_bytes=len(file_bytes)`. SVG correctly skips thumbnail and returns null dimensions. Tests: `test_upload_thumbnail_created` verifies 200x200 on disk; `test_upload_svg_skips_thumbnail` verifies SVG behavior. |
| AC-5 | Uploaded assets appear in the library immediately | PASS | Backend commits to DB and returns 201 with full `LibraryAssetDetailRead`. Frontend mutation calls `queryClient.invalidateQueries({ queryKey: ["library-assets"] })` on success, triggering a re-fetch of the library grid. |
| AC-6 | User can set name and tags on upload | PASS | Backend accepts `name: Form()` (required) and `tags: Form()` (optional, comma-separated). Frontend provides name input (pre-filled from filename) and comma-separated tags input. Tests: `test_upload_with_tags` verifies tag persistence; "calls onSuccess on successful upload" verifies tags sent correctly. |

---

## Quality Gate Results

| Gate | Status | Details |
|---|---|---|
| Backend tests (`pytest tests/test_library_asset_upload.py`) | PASS | 12/12 passed in 28.58s |
| Frontend tests (`vitest UploadAssetModal.test.tsx`) | PASS | 18/18 passed in 1.61s |
| Regression tests (`test_library_assets.py`, `test_library_asset_generate.py`) | PASS | 36/36 passed in 35.90s |
| `ruff check` + `ruff format --check` (backend) | PASS | All checks passed, already formatted |
| `tsc --noEmit` (frontend) | PASS | No errors |
| ESLint (frontend) | PASS | No errors on all 4 modified/new files |
| mypy | PASS (no new errors) | 2 pre-existing errors in `app/ai/image_client.py` (from STORY-A2.2), none in upload code |
| No new test skips | PASS | No `pytest.mark.skip`, `it.skip`, or `describe.skip` found |
| No new TODOs/FIXMEs | PASS | Grep on all modified/new files returns no matches. The pre-existing TODO placeholders in `AssetLibraryPage.tsx` for generate/upload modals were replaced with working callbacks. |
| Coverage on new code | PASS | Upload endpoint (lines 411-541 of `library_assets.py`) has ~98% coverage (only 2 lines in the return block show as missed, likely a pytest-cov artifact since the 201 response body is fully asserted in happy-path tests). Frontend: 18 tests covering all UI states. |
| No integration tests in default pytest | PASS | All tests are unit tests with mocked DB fixtures; no `@pytest.mark.integration` |
| DB migration | N/A | Uses existing `library_assets`, `library_asset_versions`, `library_asset_tags` tables from STORY-A1.1 |

---

## Code Quality Observations

### Strengths

1. **Defense in depth on validation.** Both client-side and server-side validate MIME types and file size. Client rejects before network call; server re-validates. The MIME-to-extension map is server-controlled (no user-supplied filenames in storage paths), preventing path traversal.

2. **SVG handling is correct.** SVG skips Pillow-based thumbnail generation and dimension extraction (Pillow cannot open SVG). Returns `null` for width, height, and thumbnail_url. Dedicated test confirms.

3. **Good async patterns.** CPU-bound work (`_extract_dimensions`, `_generate_thumbnail`) runs in `asyncio.to_thread()`, avoiding event loop blocking.

4. **Frontend UX polish.** Drag counter ref pattern handles nested drag events correctly. Object URLs are properly revoked on cleanup. Form resets on success. Escape key closes modal. Loading state disables submit and close buttons.

5. **API client correctly omits Content-Type header** for multipart uploads (line 179 of `libraryAssets.ts`), letting the browser set the boundary.

### Minor Observations (non-blocking)

1. **No GIF upload test.** All other 4 accepted MIME types (PNG, JPEG, WebP, SVG) have explicit tests. GIF follows the same code path as PNG/JPEG/WebP and is validated by the MIME type check, so this is low-risk. Consider adding in a follow-up.

2. **MIME validation relies on client-declared `Content-Type`.** The server trusts `file.content_type` from the multipart header. A malicious client could send a non-image file with a spoofed `image/png` content type. For a POC with authenticated users, this is acceptable. For production, consider magic-byte validation (e.g., `python-magic` or checking Pillow's ability to open the file).

3. **Coverage report shows 49% for the full `library_assets.py` file**, but this is because the file contains 4 endpoints (list, generate, upload, detail) and only upload tests were scoped here. The list and generate endpoints have their own test files with their own coverage. The upload-specific new code is effectively at ~98%.

4. **`GenerateAssetStylePresets` and `GenerateAssetRequest` types** in `libraryAssets.ts` are part of the diff but belong to STORY-A2.1 (generate). They were included in the same diff because the API client file was modified. No concern -- just noting the scope overlap.

---

## Verdict: APPROVE

All 6 acceptance criteria are demonstrably met. All quality gates pass. The implementation is clean, well-tested (12 backend + 18 frontend = 30 tests), and follows established patterns. The pre-existing mypy errors in `image_client.py` are from STORY-A2.2 and not a regression. No blocking issues found.

Ready to commit and merge to `feature/asset-library`.
