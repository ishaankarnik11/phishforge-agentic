import { test, expect } from "../fixtures/emailer";

/**
 * STORY-7.9 — Backfill of STORY-5.4 AC-3 (Playwright coverage).
 *
 * STORY-5.4's contract: clicking **Export HTML** must download bytes that
 * reflect the *current canvas state*, not the last-saved version. The
 * implementation forces a commit-pending-RTE + Save before downloading
 * (see ``EmailerPage.handleExport``). This spec proves the round-trip end
 * to end:
 *
 *   1. Open a seeded emailer.
 *   2. Inject a canvas mutation via ``window.gjsEditor.setComponents``
 *      with a unique sentinel string. Do NOT click Save.
 *   3. Click Export HTML, intercept the download.
 *   4. Read the downloaded file, assert it contains the sentinel.
 *
 * STORY-5.4 originally shipped with RTL-level coverage of the byte
 * equality contract because Playwright infra didn't exist yet — this
 * spec closes that gap.
 */

const SENTINEL = `STORY-5-4-sentinel-${Date.now()}-${Math.random()
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

test("Export HTML on a dirty canvas downloads bytes that contain the unsaved edit (STORY-5.4 AC-3)", async ({
  authedPage,
  seededEmailer,
}) => {
  const page = authedPage;

  await page.goto(`/emailers/${seededEmailer.id}`);
  await expect(page.locator(".gjs-cv-canvas")).toBeVisible({
    timeout: 30_000,
  });
  const canvasFrame = page.frameLocator(".gjs-frame");
  await expect(canvasFrame.locator("text=E2E seed content")).toBeVisible({
    timeout: 15_000,
  });

  // ----- Mutate the canvas WITHOUT clicking Save -----
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
  await expect(canvasFrame.locator(`text=${SENTINEL}`)).toBeVisible({
    timeout: 10_000,
  });

  // ----- Click Export HTML -----
  // The handler internally forces a Save before triggering the download
  // (STORY-5.4 AC-1). We intercept the download via Playwright's event.
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: /Export HTML/i }).click();
  const download = await downloadPromise;

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const fs = await import("node:fs");
  const fileText = fs.readFileSync(downloadPath, "utf-8");

  // The whole point of STORY-5.4: the downloaded bytes contain the
  // sentinel even though the user never clicked Save manually.
  expect(fileText).toContain(SENTINEL);
});
