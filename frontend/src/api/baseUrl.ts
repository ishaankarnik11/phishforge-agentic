/**
 * Backend API base URL, baked at build time.
 *
 * Set via the ``VITE_API_URL`` build arg (see ``frontend/Dockerfile``
 * and ``deploy/docker-compose.yml``). Mirrors the TMS / token-flow
 * pattern: each deploy environment gets its own bundle with an absolute
 * backend URL, browsers handle CORS, and the frontend nginx stays
 * purely static.
 *
 * In dev (``pnpm dev``) and tests (vitest), ``VITE_API_URL`` is unset,
 * so ``API_BASE`` falls back to the empty string. Every call site uses
 * ``${API_BASE}/api/v1/...``, which becomes ``/api/v1/...`` (relative)
 * and routes through Vite's dev proxy or the test fetch mocks
 * unchanged.
 */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? "";
