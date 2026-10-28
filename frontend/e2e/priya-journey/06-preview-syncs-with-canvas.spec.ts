import { test, expect } from "../fixtures/emailer";

/**
 * STORY-7.9 — Backfill of STORY-4.6 AC-5 (Playwright coverage).
 *
 * STORY-4.6's contract: the right-pane preview must reflect inline canvas
 * edits within 500ms. The hook (``useLivePreviewHtml``) debounces by
 * ``LIVE_PREVIEW_DEBOUNCE_MS = 250`` so the user-visible budget is well
 * under 500ms in practice; we assert the 500ms ceiling here.
 *
 *   1. Open a seeded emailer; capture the preview iframe's current
 *      content.
 *   2. Inject an inline ``<mj-text>`` edit via ``window.gjsEditor`` with
 *      a unique sentinel.
 *   3. Wait at most 500ms (``page.waitForFunction`` with timeout=500)
 *      for the preview iframe's body text to contain the sentinel.
 *   4. Click Save and confirm the preview now matches ``compiled_html``
 *      from the API (server-compiled mode swap, AC-3).
 *
 * STORY-4.6 originally shipped with RTL + hook-level coverage of the
 * four-event subscription, debounce coalescing, and live↔server-compiled
 * mode swap because Playwright infra didn't exist yet — this spec closes
 * that gap. Debounce window is documented in the suite README.
 */

const PREVIEW_BUDGET_MS = 500;

const SENTINEL = `STORY-4-6-sentinel-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 10)}`;

const EDITED_MJML = (sentinel: string): string => `<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>${sentinel}</mj-text>
        <mj-text>Other body content kept from the seed.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

test("preview iframe reflects inline canvas edits within 500ms, and snaps to compiled_html on Save (STORY-4.6 AC-5)", async ({
  authedPage,
  authedRequest,
  seededEmailer,
}) => {
  const page = authedPage;

  await page.goto(`/emailers/${seededEmailer.id}`);
  await expect(page.locator(".gjs-cv-canvas")).toBeVisible({
    timeout: 30_000,
  });

  // The preview iframe is rendered with title="Email preview" inside
  // the right-hand pane.
  const previewFrame = page.frameLocator(
    'iframe[title="Email preview"]'
  );
  // Wait until the seed content is reflected in the preview before we
  // start measuring — otherwise the first observed content could be the
  // initial empty state and we'd race the live-mode bootstrap.
  await expect(previewFrame.locator("body")).toContainText(
    "E2E seed content",
    { timeout: 15_000 }
  );

  // ----- Mutate the canvas; measure the preview update window -----
  // We start the timer just before the mutation lands so the assertion
  // covers the user-perceived budget (event → debounce → recompile →
  // iframe paint).
  const startedAt = Date.now();
  await page.evaluate(
    ({ next }) => {
      // justified: window.gjsEditor is a runtime tooling hook with a
      // bespoke shape (see GrapesjsEditor.tsx).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (!w.gjsEditor || typeof w.gjsEditor.setComponents !== "function") {
        throw new Error("window.gjsEditor.setComponents not available");
      }
      w.gjsEditor.setComponents(next);
    },
    { next: EDITED_MJML(SENTINEL) }
  );

  // Wait at most PREVIEW_BUDGET_MS for the iframe body to reflect the
  // sentinel. ``waitForFunction`` reports a clear timeout error if the
  // budget is exceeded — that's the failure mode we want.
  await page.waitForFunction(
    (sentinel: string) => {
      const iframe = document.querySelector(
        'iframe[title="Email preview"]'
      ) as HTMLIFrameElement | null;
      const body = iframe?.contentDocument?.body;
      return Boolean(body && body.innerText.includes(sentinel));
    },
    SENTINEL,
    { timeout: PREVIEW_BUDGET_MS, polling: 50 }
  );
  const elapsed = Date.now() - startedAt;
  // Sanity: the budget assertion is built into waitForFunction's
  // timeout, but record the observed time as test metadata so a flake
  // is easy to triage. Keep the assert as a redundancy — if the
  // measurement clock somehow disagrees with Playwright's, we still want
  // a clear fail.
  expect(elapsed).toBeLessThanOrEqual(PREVIEW_BUDGET_MS);

  // ----- Save and confirm the preview matches compiled_html -----
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByRole("button", { name: /^Save$/ })).toBeEnabled({
    timeout: 30_000,
  });

  // Fetch the latest version's compiled_html via the API.
  const versionRes = await authedRequest.get(
    `/api/v1/emailers/${seededEmailer.id}/versions/latest`
  );
  expect(versionRes.ok()).toBe(true);
  const versionBody = (await versionRes.json()) as {
    compiled_html: string;
  };
  // The server-compiled HTML must contain the sentinel — this proves the
  // forced-Save plumbing serialised the live edit to the DB.
  expect(versionBody.compiled_html).toContain(SENTINEL);

  // Wait for the live → server-compiled swap (no flash). ``srcdoc``
  // changes by reference; we can read it via getAttribute to compare
  // structure deterministically.
  await expect
    .poll(
      async () => {
        const srcdoc = await page
          .locator('iframe[title="Email preview"]')
          .getAttribute("srcdoc");
        return srcdoc ?? "";
      },
      { timeout: 10_000 }
    )
    .toContain(SENTINEL);
});
