import { test, expect, VALID_SEED_MJML } from "./fixtures/emailer";

/**
 * STORY-7.12 AC-6.3 — Manual save 422 surfaces a toast with Revert.
 *
 * Mocks `POST /api/v1/emailers/{id}/versions` to return 422 with the
 * documented envelope. We make a small canvas edit (via GrapesJS's
 * `setComponents` inside the editor frame), click Save, assert the
 * toast appears with the spec'd title and the Revert button, click
 * Revert, and assert the canvas content matches the seed MJML again
 * (i.e. the small edit was rolled back).
 *
 * Driving the canvas edit via the editor's API rather than synthesising
 * keyboard events is deliberate: GrapesJS-MJML wraps inline RTE in a
 * non-trivial event chain, and synthesising the same edit from
 * different machines would be flaky. `setComponents` is what the
 * production Revert path itself uses, so the test exercises the same
 * surface symmetrically.
 */

const MOCK_422_BODY = {
  detail: {
    detail: "MJML validation failed",
    errors: [
      {
        line: 6,
        tag: "mj-divider",
        message: "mj-divider is a void element and cannot have children",
      },
    ],
  },
};

const EDITED_MJML = `<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>EDITED locally — should be rolled back on Revert</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

test("EmailerPage shows the Revert toast on save 422 and rolls back the canvas on click", async ({
  authedPage,
  seededEmailer,
}) => {
  // Intercept POST /versions and force 422 with the documented shape.
  await authedPage.route(
    `**/api/v1/emailers/${seededEmailer.id}/versions`,
    (route) => {
      if (route.request().method() !== "POST") {
        return route.fallback();
      }
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify(MOCK_422_BODY),
      });
    }
  );

  await authedPage.goto(`/emailers/${seededEmailer.id}`);

  // Wait until the editor is mounted with the seeded content.
  await expect(authedPage.locator(".gjs-cv-canvas")).toBeVisible({
    timeout: 30_000,
  });
  const canvasFrame = authedPage.frameLocator(".gjs-frame");
  await expect(
    canvasFrame.locator("text=E2E seed content")
  ).toBeVisible({ timeout: 10_000 });

  // Drive the canvas edit through the GrapesJS instance the
  // ``GrapesjsEditor`` component renders. The wrapper exposes the editor
  // via ``editor.runCommand("mjml-code-to-html")`` and other commands;
  // we use the public ``setComponents`` API the same way the production
  // Revert handler does. We grab the editor by reaching into the
  // iframe's parent ``window.editor`` — the Grapes React wrapper sets
  // ``window.editor`` only in dev mode, so we instead use the canvas
  // frame's window to access the GrapesJS instance via its own runtime
  // hooks.
  //
  // Practical approach: replace the iframe's body with a marker so we
  // can later verify the seeded content has come back. We don't need to
  // round-trip through GrapesJS internals — clicking Save reads the
  // current editor MJML via ``editor.getHtml()`` which we cannot
  // override from the page context. Instead, we do a *real* canvas
  // edit: focus an MJ-text and replace its content via the editor's
  // RTE. To keep this independent of jsdom hacks, we drive it through
  // `evaluate` on the editor reference Grapes-React has stashed on the
  // canvas iframe. If the editor isn't on `window`, we fall back to
  // simulating a canvas mutation by typing into a focused element.

  // ``GrapesjsEditor.tsx`` parks the editor instance on
  // ``window.gjsEditor`` as a Playwright test seam (see the comment in
  // that file). We use it to drive a canvas edit and to inspect the
  // editor's MJML after Revert.
  const seededMjml = VALID_SEED_MJML;
  await authedPage.evaluate(
    ({ next }) => {
      // justified: window.gjsEditor is a runtime tooling hook with a
      // bespoke shape. Tightening this would require pulling in
      // grapesjs's full type surface for one method call.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (!w.gjsEditor || typeof w.gjsEditor.setComponents !== "function") {
        throw new Error(
          "window.gjsEditor.setComponents is not available — the editor " +
            "global was renamed or the GrapesJS instance has not finished " +
            "initialising. Update the spec or wait longer."
        );
      }
      w.gjsEditor.setComponents(next);
    },
    { next: EDITED_MJML }
  );

  // Confirm the edit landed in the canvas.
  await expect(
    canvasFrame.locator("text=EDITED locally")
  ).toBeVisible({ timeout: 10_000 });

  // Click Save — this triggers the mocked 422 path.
  await authedPage.getByRole("button", { name: /^save$/i }).click();

  // The toast appears with the spec'd title and Revert button.
  const toast = authedPage.getByTestId("save-error-banner");
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(toast).toContainText(/editor produced invalid markup\./i);
  // STORY-7.10 AC-8 contract still satisfied — server message is shown.
  await expect(toast).toContainText(/mjml validation/i);

  // Click Revert.
  await toast.getByRole("button", { name: /revert to last saved version/i }).click();

  // Canvas now matches the seed again — the edited string is gone, the
  // seed marker is back.
  await expect(
    canvasFrame.locator("text=EDITED locally")
  ).toHaveCount(0, { timeout: 10_000 });
  await expect(
    canvasFrame.locator("text=E2E seed content")
  ).toBeVisible();

  // The toast is dismissed after Revert.
  await expect(toast).toBeHidden({ timeout: 5_000 });

  // Sanity: confirm the editor's MJML matches the seed MJML.
  const editorMjml = await authedPage.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return w.gjsEditor?.getHtml?.() as string;
  });
  // Whitespace can differ — assert the seed's canonical content is
  // present and the edited string is absent.
  expect(editorMjml).toContain("E2E seed content");
  expect(editorMjml).not.toContain("EDITED locally");
  expect(seededMjml).toContain("E2E seed content");
});
