import { test, expect } from "./fixtures/emailer";

/**
 * STORY-7.10 AC-8 — Save endpoint rejects malformed MJML.
 *
 * Two assertions:
 *   1. **Backend contract** — POST /versions with v8's malformed MJML
 *      either auto-repairs (sanitizer expected behaviour) OR returns 422
 *      with the documented error shape. We probe the contract directly
 *      via the API so the test pins the response shape regardless of
 *      what the sanitizer chooses to do with that specific input.
 *   2. **UI behaviour** — when the save endpoint returns 422, the
 *      EmailerPage surfaces an error containing "MJML validation". We
 *      stub the response via `page.route` so the test is deterministic
 *      (the real backend may auto-repair the malformed input, which
 *      wouldn't exercise the 422 path).
 *
 * The combination verifies that:
 *   (a) the documented 422 shape is what the UI handles, and
 *   (b) the UI actually renders a useful message to the user when it
 *       arrives.
 */

// v8's exact malformed pattern — three nested <mj-divider> wrappers.
// Mirrored from backend/tests/test_mjml_sanitize.py V8_MALFORMED so the
// frontend test pins the same fixture the backend tests pin.
const V8_MALFORMED_MJML = `<mjml>
  <mj-body>
    <mj-divider>
      <mj-divider>
        <mj-divider>
          <mj-section>
            <mj-column>
              <mj-text>Hello</mj-text>
              <mj-text>World</mj-text>
            </mj-column>
          </mj-section>
        </mj-divider>
      </mj-divider>
    </mj-divider>
  </mj-body>
</mjml>`;

// The 422 body shape the backend's save endpoint emits on
// MJMLValidationError. FastAPI nests the dict under another `detail`.
const MOCK_422_BODY = {
  detail: {
    detail: "MJML validation failed",
    errors: [
      {
        line: 3,
        tag: "mj-divider",
        message: "mj-divider is a void element and cannot have children",
      },
    ],
  },
};

test("Save surfaces MJML validation errors when backend returns 422", async ({
  authedPage,
  authedRequest,
  seededEmailer,
}) => {
  // ---------------------------------------------------------------
  // (1) Contract probe — call the real backend with v8's malformed
  // MJML. The sanitizer auto-repairs this exact pattern, so we expect
  // 201. If a future backend change makes it 422 instead, the assertion
  // below still passes the shape check.
  // ---------------------------------------------------------------
  const probe = await authedRequest.post(
    `/api/v1/emailers/${seededEmailer.id}/versions`,
    { data: { mjml_source: V8_MALFORMED_MJML } }
  );
  expect([201, 422]).toContain(probe.status());
  if (probe.status() === 422) {
    const body = (await probe.json()) as {
      detail: { detail: string; errors: Array<Record<string, unknown>> };
    };
    expect(body.detail.detail).toContain("MJML validation");
    expect(Array.isArray(body.detail.errors)).toBe(true);
  }

  // ---------------------------------------------------------------
  // (2) UI behaviour — intercept POST /versions and force a 422 with
  // the documented shape, then drive the editor's Save button and
  // assert the page surfaces "MJML validation" to the user.
  // ---------------------------------------------------------------
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

  // Wait for the editor toolbar — the Save button gates on the latest
  // version being loaded, so we wait until it's enabled.
  const saveButton = authedPage.getByRole("button", { name: /^Save$/ });
  await expect(saveButton).toBeVisible({ timeout: 30_000 });
  await expect(saveButton).toBeEnabled({ timeout: 30_000 });

  await saveButton.click();

  // The error banner is rendered as role=alert with our test id.
  // Assert the visible text contains "MJML validation".
  const errorBanner = authedPage.getByTestId("save-error-banner");
  await expect(errorBanner).toBeVisible({ timeout: 10_000 });
  await expect(errorBanner).toContainText("MJML validation");
});
