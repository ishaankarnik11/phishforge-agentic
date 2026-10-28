import { test as authTest, expect } from "./fixtures/auth";

/**
 * STORY-7.11 AC-9 — AI generation retries silently on a malformed-MJML LLM
 * response, and the user sees a clean happy path.
 *
 * Backend test seam: ``MJML_LLM_FAILURE_INJECT`` env var (set on the FastAPI
 * process). Values:
 *   - ``"once"``  — first LLM call (per stage) returns the hard-fail
 *                  fixture (``<mj-text>`` placed directly under
 *                  ``<mj-section>`` — sanitize hard-rejects this; it cannot
 *                  be auto-repaired) so attempt 0 is guaranteed to fail
 *                  validation; attempt 1 runs normally → the
 *                  validator-driven retry path triggers and the second
 *                  attempt succeeds.
 *   - ``"always"`` — every LLM call returns the fixture → both attempts
 *                   fail and the API surfaces 422.
 *   - unset       — production behaviour.
 *
 * **This spec requires the backend to be running with the env var set to
 * ``"once"``.** The test runner (Playwright/Node) inherits the same shell
 * environment as the developer's `pnpm e2e` invocation, but the backend
 * dev server is a *separate* process — it must have been (re)started with
 * the env var. We probe for the env var on the runner side and skip with a
 * clear reason if it is not set, matching the simplest plumbing path
 * documented in the story spec.
 *
 * What we assert (the user-visible contract AND the proof of mechanism):
 *   1. Generation completes successfully — navigation to the emailer page
 *      surfaces a populated editor canvas.
 *   2. **No** `[role="alert"]` is shown to the user during the flow. The
 *      retry happens server-side; the user sees only "Generating..." → done.
 *   3. The backend's introspection endpoint
 *      (``GET /api/v1/_test/llm-inject-state``) reports that the generator
 *      inject fired exactly once for this Generate click — i.e. the retry
 *      path was actually traversed. Without this we'd be asserting a
 *      vacuous "no error UI" green.
 *   4. The saved version's compiled HTML is non-trivial (>20 KB). The
 *      injected fixture compiles to ~3.9 KB; a real LLM-produced email
 *      lands well above 20 KB. This proves the second-attempt content
 *      (real LLM output) is what got persisted, not the fixture.
 */

// Minimal ambient declaration so we can read process.env without pulling
// in a dev dep on @types/node. Playwright always runs the spec in Node,
// so process is guaranteed to exist at runtime.
declare const process: { env: Record<string, string | undefined> };

const FAILURE_INJECT = process.env.MJML_LLM_FAILURE_INJECT;

const SHOULD_SKIP = FAILURE_INJECT !== "once";
const SKIP_REASON =
  "Set MJML_LLM_FAILURE_INJECT=once on the BACKEND process and rerun. " +
  "Stop the backend, re-export it with the env var, re-`uv run uvicorn`, " +
  "then re-run `MJML_LLM_FAILURE_INJECT=once pnpm e2e`. " +
  "See frontend/e2e/README.md for the full recipe.";

interface LlmInjectState {
  mode: string;
  generator_fire_count: number;
  refiner_fire_count: number;
  total_fire_count: number;
}

interface VersionRead {
  mjml_source: string;
  compiled_html: string | null;
}

// Increase the timeout — the retry path makes two LLM calls back-to-back.
authTest.describe("AC-9 — generation retries silently on malformed MJML", () => {
  // We use the auth-only fixture and manually create an emailer via the
  // API, because we want to drive the FIRST Generate from the UI (no
  // pre-seeded version). The shared `seededEmailer` fixture already pushes
  // a valid version, which would change the button label to "Regenerate"
  // — still functional, but less faithful to the user's first-time flow.
  authTest(
    "Generate succeeds end-to-end despite a malformed first LLM response",
    async ({ authedPage, authedRequest }, testInfo) => {
      testInfo.skip(SHOULD_SKIP, SKIP_REASON);

      // 5 minutes — gives both LLM attempts (gen+refine, sometimes ~60s
      // each) plenty of headroom in the worst case.
      testInfo.setTimeout(5 * 60_000);

      // ----------------------------------------------------------------
      // (0) Verify the backend has the test seam mounted. The endpoint
      //     is mounted ONLY when MJML_LLM_FAILURE_INJECT is non-empty on
      //     the BACKEND process. If we get here with the runner-side env
      //     var set to "once" but the endpoint 404s, the backend wasn't
      //     restarted with the env var — fail loudly rather than running
      //     a vacuous test against a normal backend.
      // ----------------------------------------------------------------
      const baselineRes = await authedRequest.get(
        `/api/v1/_test/llm-inject-state`
      );
      expect(
        baselineRes.status(),
        "Runner has MJML_LLM_FAILURE_INJECT=once but the backend " +
          "introspection endpoint is not mounted — this means the BACKEND " +
          "process was not restarted with the env var. Stop the backend, " +
          "re-export MJML_LLM_FAILURE_INJECT=once, re-`uv run uvicorn`, " +
          "and rerun. See frontend/e2e/README.md."
      ).toBe(200);
      const baseline = (await baselineRes.json()) as LlmInjectState;
      expect(
        baseline.mode,
        `Backend reports inject mode "${baseline.mode}", expected "once". ` +
          "The backend process was started with a different value of " +
          "MJML_LLM_FAILURE_INJECT than the runner. Restart it with =once."
      ).toBe("once");

      // ----------------------------------------------------------------
      // (1) Create an emailer with a complete brief (no version yet) so
      //     POST /generate has everything it needs and can run end-to-end.
      // ----------------------------------------------------------------
      const createRes = await authedRequest.post(`/api/v1/emailers`, {
        data: {
          name: `E2E AC-9 ${Date.now()}`,
          brand_kit_id: "acme-retail",
          category: "offer",
          target_audience:
            "Existing Acme savings account holders aged 25–45 in urban India",
          content_summary:
            "Promote a limited-time 7.5% interest rate on a new fixed deposit product. Highlight safety, the boosted rate vs market, and a one-tap link to apply.",
          cta_text: "Open an FD",
          cta_url: "https://acmebank.example/personal/save/deposits",
          tone: "professional",
          length: "medium",
        },
      });
      expect(
        createRes.ok(),
        `POST /emailers failed: ${createRes.status()} ${await createRes.text()}`
      ).toBe(true);
      const emailer = (await createRes.json()) as { id: number };

      // ----------------------------------------------------------------
      // (2) Track every alert that appears so we can assert NONE was
      //     shown to the user during the retry. React Query mutations
      //     surface generation errors via [role="alert"] with the text
      //     "Generation failed:". We poll the DOM during the generate
      //     window (below) which is more robust to React's async render
      //     cycles than chasing each mutation event.
      // ----------------------------------------------------------------
      const alertTexts: string[] = [];

      // ----------------------------------------------------------------
      // (3) Navigate to the editor, click Generate, wait for it to
      //     complete, and assert the canvas is populated and no alert
      //     ever surfaced.
      // ----------------------------------------------------------------
      await authedPage.goto(`/emailers/${emailer.id}`);

      const generateButton = authedPage.getByRole("button", {
        name: /^Generate$/,
      });
      await expect(generateButton).toBeVisible({ timeout: 30_000 });
      await expect(generateButton).toBeEnabled({ timeout: 30_000 });

      // Snapshot alerts before click — sanity-check we start clean.
      expect(await authedPage.locator('[role="alert"]').count()).toBe(0);

      // Snapshot the inject fire counter immediately before driving the
      // Generate click. The introspection endpoint counters are
      // process-local and monotonic; we'll diff after.
      const generatorFireBefore = baseline.generator_fire_count;

      // Watch for any alert appearance while generation is in flight.
      // We use a periodic count check: if anything matching role=alert
      // ever materialises before the spinner clears, we record it.
      const alertWatcher = (async () => {
        const start = Date.now();
        while (Date.now() - start < 5 * 60_000) {
          const alerts = authedPage.locator('[role="alert"]');
          const n = await alerts.count();
          if (n > 0) {
            for (let i = 0; i < n; i++) {
              const text = (await alerts.nth(i).textContent()) ?? "";
              alertTexts.push(text);
            }
            return; // first sighting is enough — we'll fail in the assertion
          }
          // Stop watching once the regenerate button is back (generation done).
          const regenerateVisible = await authedPage
            .getByRole("button", { name: /^Regenerate$/ })
            .isVisible()
            .catch(() => false);
          if (regenerateVisible) return;
          await authedPage.waitForTimeout(200);
        }
      })();

      await generateButton.click();

      // The button becomes a busy "Generating..." while the request is in
      // flight. After success the button label flips to "Regenerate"
      // (because there is now an active version).
      const regenerateButton = authedPage.getByRole("button", {
        name: /^Regenerate$/,
      });
      await expect(regenerateButton).toBeVisible({ timeout: 5 * 60_000 });

      // Stop the alert watcher (no-op if it already returned).
      await alertWatcher;

      // ----------------------------------------------------------------
      // (4) Editor canvas is populated. The GrapesJS editor renders into
      //     `.gjs-cv-canvas` once it has MJML to display. We don't peek
      //     into the iframe's contents — we just assert that the canvas
      //     element mounted, which only happens once `activeVersion`
      //     exists with non-empty `mjml_source`.
      // ----------------------------------------------------------------
      await expect(authedPage.locator(".gjs-cv-canvas")).toBeVisible({
        timeout: 30_000,
      });

      // ----------------------------------------------------------------
      // (5) Final user-visible assertion: at no point did the user see
      //     an alert. The server-side retry was invisible from the UI's
      //     perspective.
      // ----------------------------------------------------------------
      expect(
        alertTexts,
        `Expected no [role="alert"] during the silent-retry generate flow, ` +
          `but saw: ${JSON.stringify(alertTexts)}`
      ).toEqual([]);
      expect(await authedPage.locator('[role="alert"]').count()).toBe(0);

      // ----------------------------------------------------------------
      // (6) Mechanism proof — the inject actually fired exactly once for
      //     this Generate click. Without this delta the "no alert" assert
      //     above is vacuous: a normal backend (env var unset on the
      //     server) would produce the same green.
      // ----------------------------------------------------------------
      const afterRes = await authedRequest.get(
        `/api/v1/_test/llm-inject-state`
      );
      expect(afterRes.status()).toBe(200);
      const afterState = (await afterRes.json()) as LlmInjectState;
      const generatorFireDelta =
        afterState.generator_fire_count - generatorFireBefore;
      expect(
        generatorFireDelta,
        `Expected exactly 1 generator inject fire for a single Generate ` +
          `click in once-mode, got delta=${generatorFireDelta} ` +
          `(before=${generatorFireBefore}, after=${afterState.generator_fire_count}). ` +
          `This means either the inject didn't fire (retry path not exercised) ` +
          `or it fired more than once (per-request once semantics broken).`
      ).toBe(1);

      // ----------------------------------------------------------------
      // (7) Content proof — the saved version contains a real LLM email,
      //     not the fixture. The injected fixture compiles to ~3.9 KB;
      //     a real generated email lands well above 20 KB. The 20 KB
      //     threshold is comfortably between the two.
      // ----------------------------------------------------------------
      const versionRes = await authedRequest.get(
        `/api/v1/emailers/${emailer.id}/versions/latest`
      );
      expect(
        versionRes.ok(),
        `GET /versions/latest failed: ${versionRes.status()} ${await versionRes.text()}`
      ).toBe(true);
      const version = (await versionRes.json()) as VersionRead;
      const compiledHtml = version.compiled_html ?? "";
      expect(
        compiledHtml.length,
        `Saved compiled_html is suspiciously small (${compiledHtml.length} bytes). ` +
          `The injected fixture compiles to ~3.9 KB; a real LLM-produced ` +
          `email is comfortably >20 KB. If we landed below the threshold, ` +
          `the fixture content was persisted instead of the retry result.`
      ).toBeGreaterThan(20_000);
    }
  );
});
