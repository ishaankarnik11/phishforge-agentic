import { test, expect } from "./fixtures/auth";

/**
 * STORY-7.12 AC-6.1 — Generation 422 surfaces a Retry button.
 *
 * Mocks the `POST /api/v1/emailers/{id}/generate` response via
 * `page.route` so the test is fully self-contained — no backend env-var
 * coordination required (unlike STORY-7.11's AC-9 which needs the LLM
 * inject seam). First call returns the 422 envelope STORY-7.10 defined;
 * the user sees the AC-1 retry surface. Second call (after the user
 * clicks Retry) returns a normal 201, so the BriefPage flow completes
 * and navigates to /emailers/{id}.
 *
 * Why we still let the *create* call hit the real backend: the brief
 * form needs an emailer id to call /generate against, and the route's
 * pattern matches by URL anyway. The intercept is scoped to the generate
 * endpoint; create / brand-kits / etc. flow through normally.
 */

const MOCK_422_BODY = {
  detail: {
    detail: "MJML validation failed",
    errors: [
      {
        line: 7,
        tag: "mj-divider",
        message: "mj-divider is a void element and cannot have children",
      },
    ],
  },
};

// Minimal valid MJML the second-call mock returns. Shape matches
// `GenerateResponse` in `frontend/src/api/emailers.ts`.
const MOCK_GENERATE_OK = {
  version_id: 999,
  version_number: 1,
  subject_line: "Mocked subject",
  preheader: "Mocked preheader",
  mjml_source:
    "<mjml><mj-body><mj-section><mj-column><mj-text>Hello</mj-text></mj-column></mj-section></mj-body></mjml>",
  compiled_html:
    "<!doctype html><html><body><table><tr><td>Hello</td></tr></table></body></html>",
  model_used: "claude-sonnet-4-20250514",
  input_tokens: 100,
  output_tokens: 200,
  latency_ms: 1234,
  warning: null,
};

test("BriefPage shows the Retry surface on generation 422 and recovers on Retry", async ({
  authedPage,
}) => {
  // Track how many times /generate has been hit so we can swap the
  // response between the first and second call without `route.continue`
  // gymnastics.
  let generateCallCount = 0;
  await authedPage.route(
    "**/api/v1/emailers/*/generate",
    async (route) => {
      if (route.request().method() !== "POST") {
        return route.fallback();
      }
      generateCallCount += 1;
      if (generateCallCount === 1) {
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify(MOCK_422_BODY),
        });
      }
      // Second call (after Retry click) — succeed.
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(MOCK_GENERATE_OK),
      });
    }
  );

  // After navigation to /emailers/{id}, EmailerPage fetches
  // ``/versions/latest`` to populate the canvas. Because we mocked the
  // generate response (no version row was actually created server-side),
  // the real backend returns 404. We mirror the mocked generate output
  // back into a 200 so the editor can mount and prove navigation +
  // editor-mount happened end-to-end.
  await authedPage.route(
    "**/api/v1/emailers/*/versions/latest",
    async (route) => {
      if (route.request().method() !== "GET") {
        return route.fallback();
      }
      const versionRead = {
        id: MOCK_GENERATE_OK.version_id,
        emailer_id: 0,
        version_number: MOCK_GENERATE_OK.version_number,
        mjml_source: MOCK_GENERATE_OK.mjml_source,
        compiled_html: MOCK_GENERATE_OK.compiled_html,
        subject_line: MOCK_GENERATE_OK.subject_line,
        preheader: MOCK_GENERATE_OK.preheader,
        model_used: MOCK_GENERATE_OK.model_used,
        input_tokens: MOCK_GENERATE_OK.input_tokens,
        output_tokens: MOCK_GENERATE_OK.output_tokens,
        created_at: new Date().toISOString(),
      };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(versionRead),
      });
    }
  );

  // ----------------------------------------------------------------
  // (1) Drive the brief form to submit. We type into the visible
  //     fields the same way a user would — no API short-circuiting —
  //     so the test exercises the full create+generate path.
  // ----------------------------------------------------------------
  await authedPage.goto("/brief");

  // Wait for the brand kit selector to load (it fetches /brand-kits).
  // The trigger combobox is keyboard-accessible.
  const brandKitCombo = authedPage.getByRole("combobox", {
    name: /brand kit/i,
  });
  await expect(brandKitCombo).toBeVisible({ timeout: 30_000 });

  await authedPage
    .getByLabel(/template name/i)
    .fill(`E2E AC-6.1 ${Date.now()}`);

  await brandKitCombo.click();
  // Brand kit options come from the real backend's seed; pick the first
  // visible option. The dropdown renders option text directly.
  const firstOption = authedPage.getByRole("option").first();
  await expect(firstOption).toBeVisible({ timeout: 10_000 });
  await firstOption.click();

  await authedPage.getByLabel(/category/i).selectOption("offer");
  await authedPage
    .getByLabel(/target audience/i)
    .fill("E2E target audience for AC-6.1");
  await authedPage
    .getByLabel(/email content summary/i)
    .fill("E2E content summary for AC-6.1");
  await authedPage.getByLabel(/tone/i).selectOption("professional");
  await authedPage.getByLabel(/length/i).selectOption("short");

  // Submit — this fires create then generate.
  await authedPage.getByRole("button", { name: /^generate$/i }).click();

  // ----------------------------------------------------------------
  // (2) The retry surface appears: title text + Retry button.
  // ----------------------------------------------------------------
  const errorBlock = authedPage.getByTestId("generation-error");
  await expect(errorBlock).toBeVisible({ timeout: 30_000 });
  await expect(errorBlock).toContainText(
    /generation produced invalid output\. please retry\./i
  );
  const retryBtn = errorBlock.getByRole("button", { name: /^retry$/i });
  await expect(retryBtn).toBeVisible();

  // We are still on the brief page — no navigation happened.
  expect(authedPage.url()).toContain("/brief");

  // ----------------------------------------------------------------
  // (3) Click Retry — the second mock fires (201) and the BriefPage
  //     navigates to /emailers/{id}. We assert both the URL pattern
  //     and that the editor canvas has mounted.
  // ----------------------------------------------------------------
  await retryBtn.click();

  await authedPage.waitForURL(/\/emailers\/\d+$/, { timeout: 30_000 });

  // The GrapesJS editor renders into `.gjs-cv-canvas` once the
  // active version is loaded. We use the same locator as the AC-9
  // spec so the assertion is consistent across the suite.
  await expect(authedPage.locator(".gjs-cv-canvas")).toBeVisible({
    timeout: 30_000,
  });

  // Sanity: both mock paths were exercised.
  expect(generateCallCount).toBe(2);
});
