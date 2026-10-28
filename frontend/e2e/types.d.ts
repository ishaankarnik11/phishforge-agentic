/**
 * Minimal Node ambient declarations for the Playwright e2e suite.
 *
 * Playwright always runs specs in Node, but the frontend package
 * intentionally avoids a dev dep on @types/node so the production
 * bundle's type surface stays browser-only. This shim exposes just the
 * APIs the e2e specs need:
 *
 *   - ``process.env`` for runtime env-flag gating (SKIP_REAL_LLM,
 *     MJML_LLM_FAILURE_INJECT, etc.)
 *   - ``node:fs`` ``readFileSync`` for reading downloaded files in
 *     download-intercept specs
 *   - ``node:path`` ``join`` and ``dirname`` for resolving fixture
 *     paths
 *   - ``node:url`` ``fileURLToPath`` for ESM ``import.meta.url`` →
 *     filesystem path conversion
 *
 * If a future spec needs more, add the missing surface here rather than
 * adding @types/node — keeps the dependency tree small.
 */

declare const process: { env: Record<string, string | undefined> };

declare module "node:fs" {
  export function readFileSync(
    path: string,
    encoding: "utf-8" | "utf8"
  ): string;
}

declare module "node:path" {
  export function join(...segments: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
