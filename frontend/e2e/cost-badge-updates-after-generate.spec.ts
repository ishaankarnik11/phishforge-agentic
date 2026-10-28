import { test, expect } from "./fixtures/emailer";

/**
 * STORY-7.8 AC-8 — Cost badge updates after a generate.
 *
 * Strategy:
 *   - Use the seeded emailer fixture (already has a valid version, so
 *     the editor toolbar mounts straight away — no need to drive the
 *     brief form). Per-emailer cost starts at $0.0000 because seeding
 *     bypasses the LLM.
 *   - Stub ``GET /emailers/{id}/cost`` so the test stays deterministic
 *     without depending on a real Claude API key. We start with a zero
 *     summary; once the user clicks Generate (which we also stub), we
 *     swap the cost endpoint to return a non-zero amount and assert the
 *     badge re-fetches and re-renders.
 *
 * This pins the *contract* — frontend invalidates the cost query in
 * generate's onSuccess, the badge picks up the new value — without
 * requiring a real LLM call. A separate happy-path smoke (skipped when
 * no API key) can hit a real generate later; for the AC-8 spec the
 * contract assertion is what matters.
 */

const ZERO_COST = {
  summary: {
    emailer_id: 0,
    emailer_name: "stub",
    creator_email: "stub",
    total_calls: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_read_tokens: 0,
    total_cache_write_tokens: 0,
    estimated_cost_usd: 0,
    first_call_at: null,
    last_call_at: null,
  },
  calls: [],
  total: 0,
  limit: 50,
  offset: 0,
};

const NON_ZERO_COST = {
  summary: {
    emailer_id: 0,
    emailer_name: "stub",
    creator_email: "stub",
    total_calls: 1,
    total_input_tokens: 1000,
    total_output_tokens: 500,
    total_cache_read_tokens: 0,
    total_cache_write_tokens: 0,
    estimated_cost_usd: 0.0234,
    first_call_at: "2026-04-25T09:00:00Z",
    last_call_at: "2026-04-25T09:30:00Z",
  },
  calls: [
    {
      id: 1,
      stage_name: "generate",
      model: "claude-sonnet-4-6",
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      estimated_cost_usd: 0.0234,
      latency_ms: 1234,
      success: true,
      error_message: null,
      called_at: "2026-04-25T09:30:00Z",
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

test("cost badge transitions from $0.0000 to a positive amount after generate", async ({
  authedPage,
  seededEmailer,
}) => {
  // Mode flag flips after the user clicks Generate.
  let costMode: "zero" | "nonZero" = "zero";

  // Stub GET cost — return zero until generate runs, then return a
  // realistic non-zero summary.
  await authedPage.route(
    `**/api/v1/emailers/${seededEmailer.id}/cost*`,
    (route) => {
      if (route.request().method() !== "GET") {
        return route.fallback();
      }
      const body = costMode === "zero" ? ZERO_COST : NON_ZERO_COST;
      // Server returns the right emailer_id; mirror it for realism.
      body.summary.emailer_id = seededEmailer.id;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    }
  );

  // Stub POST generate so the test doesn't need a live LLM. We return
  // a minimal but valid GenerateResponse — the editor's success handler
  // only cares about the version_* / mjml_source / cache token fields.
  await authedPage.route(
    `**/api/v1/emailers/${seededEmailer.id}/generate`,
    (route) => {
      if (route.request().method() !== "POST") {
        return route.fallback();
      }
      // Flip the cost stub to non-zero — the page invalidates the cost
      // query in the generate onSuccess, so the next GET returns the
      // updated summary.
      costMode = "nonZero";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version_id: seededEmailer.versionId + 1,
          version_number: seededEmailer.versionNumber + 1,
          subject_line: "Generated",
          preheader: "Stubbed for e2e",
          mjml_source: "<mjml><mj-body><mj-section><mj-column><mj-text>Generated</mj-text></mj-column></mj-section></mj-body></mjml>",
          compiled_html: "<html><body><div>Generated</div></body></html>",
          model_used: "claude-sonnet-4-6",
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          latency_ms: 1234,
          warning: null,
        }),
      });
    }
  );

  await authedPage.goto(`/emailers/${seededEmailer.id}`);

  // Wait for the cost badge to render with the initial $0.0000 value.
  const badge = authedPage.getByTestId("cost-badge-value");
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveText("$0.0000", { timeout: 10_000 });

  // Click Regenerate (the seeded emailer already has a version, so the
  // toolbar shows "Regenerate" rather than "Generate").
  const regenerate = authedPage.getByRole("button", {
    name: /^Regenerate$|^Generate$/,
  });
  await regenerate.click();

  // The badge should pick up the new value once the cost query
  // invalidation fires after the generate succeeds. Parse the dollar
  // string, assert it's > 0.
  await expect(badge).not.toHaveText("$0.0000", { timeout: 15_000 });
  const text = (await badge.textContent()) ?? "";
  const numeric = Number(text.replace(/[^0-9.]/g, ""));
  expect(numeric).toBeGreaterThan(0);
});
