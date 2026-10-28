# STORY-7.7: Hardcoded Endpoints Audit for Production Deploy

**Audit Date:** 2026-04-26  
**Status:** Complete  
**Scope:** Frontend (`/frontend/src/**/*.{ts,tsx,js,jsx}`) and Backend (`/backend/app/**/*.py`)

## Summary

The application has **6 blocking issues** that prevent non-localhost deployment. All are configuration defaults in `app/config.py` and `app/main.py` that must be environment-driven in production. The frontend is correctly designed for reverse proxy deployment (uses relative API paths), but the dev Vite proxy is hardcoded.

---

## Blocking Issues (Must Fix for STORY-7.7)

### Backend Configuration Defaults

**File:** `/backend/app/config.py`

| Line | Variable | Current Default | Issue | Fix |
|------|----------|-----------------|-------|-----|
| 9 | `DATABASE_URL` | `mysql+aiomysql://acme_app:acme_pass@localhost:3306/acme_emailer` | Hardcoded localhost DB, will fail in container | Require environment variable, no default |
| 11 | `SECRET_KEY` | `"change-me-in-production"` | Insecure default; if forgotten, breaks JWT auth | Require environment variable, no default |
| 23 | `FRONTEND_URL` | `"http://localhost:5173"` | Hardcoded dev origin; preview URLs will point to localhost in prod | Require environment variable, default to empty string with validation |
| 30 | `PUBLIC_BACKEND_URL` | `"http://localhost:8000"` | Hardcoded dev origin; asset/logo URLs in exported emails will point to localhost | Require environment variable, default to empty string with validation |

**Recommendation:**  
Remove all defaults except optional/secondary settings. For `FRONTEND_URL` and `PUBLIC_BACKEND_URL`, either require them or add validation to warn if defaults are detected at startup in non-dev environments.

---

### CORS Middleware

**File:** `/backend/app/main.py:100`

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Issue:**  
Hardcoded `allow_origins` list only permits Vite dev server. When the frontend is deployed to a different subdomain (e.g., `https://mailer.example.com`), CORS will reject all requests from the browser.

**Fix:**  
Read from environment variable `ALLOWED_ORIGINS` (comma-separated list). Example:
```python
origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, ...)
```

**Configuration file:** `app/config.py`  
**New field needed:**
```python
ALLOWED_ORIGINS: str = "http://localhost:5173"  # dev default; override in .env for prod
```

---

### Frontend Vite Dev Proxy

**File:** `/frontend/vite.config.ts:8-12`

```typescript
server: {
  proxy: {
    "/api": {
      target: "http://localhost:8000",
      changeOrigin: true,
    },
  },
}
```

**Issue:**  
Blocks frontend development against non-localhost backends. During QA/staging, developers cannot test against a staging backend without manually changing this config.

**Fix:**  
Make the target configurable via environment variable:
```typescript
server: {
  proxy: {
    "/api": {
      target: process.env.VITE_BACKEND_URL || "http://localhost:8000",
      changeOrigin: true,
    },
  },
}
```

**Then in `.env.local` (development):**
```
VITE_BACKEND_URL=http://localhost:8000
```

**Or for staging QA:**
```
VITE_BACKEND_URL=https://api.staging.example.com
```

---

## Environment Variables Summary

### Required for Production (No Safe Default)

These MUST be provided as environment variables in production. Do not set defaults.

- **`DATABASE_URL`** — MySQL connection string. No localhost default.
- **`SECRET_KEY`** — JWT signing key. Must be cryptographically strong, never the placeholder `"change-me-in-production"`.
- **`ANTHROPIC_API_KEY`** — Anthropic API key for Claude LLM calls.

### Required for Production (Must Override Dev Default)

These have dev defaults but MUST be overridden for production domains.

- **`FRONTEND_URL`** — URL of the frontend application (used for preview link generation). Dev default: `http://localhost:5173`. Prod example: `https://mailer.example.com`.
- **`PUBLIC_BACKEND_URL`** — Public URL of the backend (used in exported emails for asset/logo CDN URLs). Dev default: `http://localhost:8000`. Prod example: `https://api-mailer.example.com`.
- **`ALLOWED_ORIGINS`** — Comma-separated list of CORS-allowed origins. Dev default: `http://localhost:5173`. Prod example: `https://mailer.example.com`.

### Optional (Existing Env Vars)

- **`LANGSMITH_API_KEY`** — Optional LangSmith tracing. Silently skipped if absent.
- **`LANGSMITH_PROJECT`** — Optional LangSmith project name. Defaults to `"acme-emailer-poc"`.
- **`REFINER_MODEL`** — Optional Anthropic model override. Defaults to `"haiku"`.
- **`TEST_DATABASE_URL`** — Optional test DB URL. Derived from `DATABASE_URL` if absent.
- **`MJML_LLM_FAILURE_INJECT`** — Test-only introspection endpoint gate. Must be unset in production.

---

## Non-Blocking Findings

### Frontend is Correctly Designed for Reverse Proxy

**Status: ✅ No Action Required**

1. **API calls use relative paths:** All frontend API calls use relative paths like `/api/v1/...`, not hardcoded origins.
   - Example: `/frontend/src/api/auth.ts:10` — `fetch("/api/v1/auth/login")`
   - This works behind any reverse proxy or on any domain.

2. **No `window.location.origin` assumptions:** No code breaks if the domain changes.

3. **No inline asset URLs:** Images/logos are fetched from the API, not baked into the bundle.

### Backend Correctly Uses Environment Variables

**Status: ✅ No Action Required**

1. **Logo URLs:** `/backend/app/ai/brand_kit.py:58` — `resolve_logo_url()` correctly uses `settings.PUBLIC_BACKEND_URL`.
2. **Asset storage URLs:** `/backend/app/services/asset_storage.py:64` — `get_asset_url()` correctly uses `request.base_url` (dynamic).
3. **Preview link generation:** `/backend/app/services/preview_link_service.py:109` — Uses `settings.FRONTEND_URL`.
4. **JWT/Auth:** Uses `settings.SECRET_KEY` from environment.

---

## Test Data with Localhost (Safe to Ignore)

The following test files include hardcoded `http://localhost:8000` and `http://localhost:5173` in test mock data. These are not production code and do not block deployment:

- `/frontend/src/components/AssetStrip.test.tsx:37, 48`
- `/frontend/src/components/AssetUploadPanel.test.tsx:32`
- `/frontend/src/components/Editor/ShareLinkDialog.test.tsx:15, 24, 33`
- `/frontend/src/api/assets.test.ts:27`
- `/frontend/src/api/previewLinks.test.ts:24`
- `/frontend/src/pages/BriefPage.test.tsx:361, 378`
- `/frontend/src/api/emailers.test.ts:618, 644` (blob URL mocks)

### SVG Namespace URLs (Safe)

Multiple files contain `xmlns="http://www.w3.org/2000/svg"` in SVG markup. These are standard XML namespace declarations, not endpoints, and are safe.

### .env.example (Expected)

`/backend/.env.example:1` contains `localhost` URLs as dev reference. This is intentional and does not affect production.

---

## Configuration Checklist for STORY-7.7 Implementation

- [ ] Remove or make conditional all hardcoded localhost defaults in `app/config.py`
- [ ] Move `allow_origins` in `app/main.py` to `ALLOWED_ORIGINS` env var
- [ ] Make `VITE_BACKEND_URL` configurable in `vite.config.ts`
- [ ] Create `.env.production` template or deployment documentation listing all required env vars
- [ ] Add startup validation: warn if `PUBLIC_BACKEND_URL` or `FRONTEND_URL` still contain localhost in non-dev environments
- [ ] Update Docker entrypoint to require `DATABASE_URL`, `SECRET_KEY`, and `ANTHROPIC_API_KEY` at startup
- [ ] Document the two-subdomain Nginx setup:
  - Frontend subdomain: points to Vite dev server or built dist
  - Backend subdomain: points to FastAPI app
  - Both subdomains must be added to `ALLOWED_ORIGINS` for CORS

---

## References

- **STORY-7.7:** Containerize app for production deploy
- **Nginx Proxy Manager:** Two custom subdomains (frontend + backend)
- **Architecture:** Frontend behind reverse proxy, backend with CORS, both env-driven

