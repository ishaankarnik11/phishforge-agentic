import { test, expect } from "./fixtures/auth";

/**
 * STORY-1.3 — Filter emailers (status + brand kit).
 *
 * Strategy:
 *   - Stub `GET /api/v1/emailers` with `page.route`. The handler reads
 *     the query string and returns a different subset of a fixed corpus
 *     depending on the active filters, mirroring the backend's AND-
 *     across-facets / OR-within-facet semantics.
 *   - Stub `GET /api/v1/brand-kits` so the filter chip row populates
 *     without depending on the static brand kit registry being served.
 *   - Stub the per-emailer `/cost` endpoint with a zero summary so the
 *     per-row cost queries from STORY-7.8 don't produce console noise
 *     and don't confuse the filter assertions.
 *   - Drive the chip toggles via Playwright's getByTestId + click, then
 *     assert the visible row set updates.
 *
 * Why mocked: we don't need a real backend write surface to exercise
 * the chip-row / refetch contract — the contract is "toggling a chip
 * sends a request with these params, and the rendered list reflects
 * the response". Using `page.route` makes the test fully deterministic
 * and runnable without DB seeding.
 */

interface MockEmailer {
  id: number;
  name: string;
  brand_kit_id: string;
  status: "draft" | "in_review" | "completed" | "exported";
  created_at: string;
  updated_at: string;
}

const CORPUS: readonly MockEmailer[] = [
  {
    id: 101,
    name: "Retail Draft Alpha",
    brand_kit_id: "acme-retail",
    status: "draft",
    created_at: "2026-04-20T10:00:00Z",
    updated_at: "2026-04-22T14:30:00Z",
  },
  {
    id: 102,
    name: "Cards Completed Bravo",
    brand_kit_id: "acme-cards",
    status: "completed",
    created_at: "2026-04-18T08:00:00Z",
    updated_at: "2026-04-23T09:15:00Z",
  },
  {
    id: 103,
    name: "Retail Completed Charlie",
    brand_kit_id: "acme-retail",
    status: "completed",
    created_at: "2026-04-19T12:00:00Z",
    updated_at: "2026-04-21T11:00:00Z",
  },
];

const BRAND_KITS = [
  {
    id: "acme-retail",
    name: "Acme Retail",
    business_unit: "Retail",
    primary_color: "#004C8F",
    secondary_color: "#FFFFFF",
  },
  {
    id: "acme-cards",
    name: "Acme Cards",
    business_unit: "Cards",
    primary_color: "#9B1B30",
    secondary_color: "#FFFFFF",
  },
];

function filterCorpus(searchParams: URLSearchParams): MockEmailer[] {
  const statuses = searchParams.getAll("status");
  const kits = searchParams.getAll("brand_kit_id");
  return CORPUS.filter((e) => {
    if (statuses.length > 0 && !statuses.includes(e.status)) return false;
    if (kits.length > 0 && !kits.includes(e.brand_kit_id)) return false;
    return true;
  });
}

function zeroCostBody(emailerId: number): unknown {
  return {
    summary: {
      emailer_id: emailerId,
      emailer_name: `Emailer #${emailerId}`,
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
}

test("filter chip row narrows the emailer list and Clear filters restores it", async ({
  authedPage,
}) => {
  // Stub brand kits.
  await authedPage.route("**/api/v1/brand-kits", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(BRAND_KITS),
    });
  });

  // Stub list emailers — query-aware so toggling a chip changes the
  // returned subset.
  await authedPage.route("**/api/v1/emailers**", (route) => {
    const req = route.request();
    if (req.method() !== "GET") return route.fallback();
    const url = new URL(req.url());
    // Only the /emailers list endpoint takes filters. POST routes don't
    // hit this matcher; per-id GETs (e.g. /emailers/101/cost) are
    // handled by the more specific stub below — leave them via fallback.
    if (!/\/api\/v1\/emailers\/?$/.test(url.pathname)) {
      return route.fallback();
    }
    const subset = filterCorpus(url.searchParams);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(subset),
    });
  });

  // Stub per-emailer cost so per-row queries resolve cleanly.
  await authedPage.route("**/api/v1/emailers/*/cost*", (route) => {
    const req = route.request();
    if (req.method() !== "GET") return route.fallback();
    const match = req.url().match(/\/emailers\/(\d+)\/cost/);
    const id = match ? Number(match[1]) : 0;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(zeroCostBody(id)),
    });
  });

  await authedPage.goto("/");

  // All three rows visible to start.
  await expect(authedPage.getByText("Retail Draft Alpha")).toBeVisible();
  await expect(authedPage.getByText("Cards Completed Bravo")).toBeVisible();
  await expect(authedPage.getByText("Retail Completed Charlie")).toBeVisible();

  // Toggle the Completed status chip — only the two "completed" rows
  // should remain.
  await authedPage.getByTestId("filter-status-completed").click();

  await expect(authedPage.getByText("Cards Completed Bravo")).toBeVisible();
  await expect(authedPage.getByText("Retail Completed Charlie")).toBeVisible();
  await expect(authedPage.getByText("Retail Draft Alpha")).toBeHidden();

  // Visual feedback: the chip is now in its pressed state.
  await expect(
    authedPage.getByTestId("filter-status-completed")
  ).toHaveAttribute("aria-pressed", "true");

  // Add a brand kit chip — AND across facets narrows further.
  await authedPage.getByTestId("filter-brand-acme-retail").click();

  await expect(authedPage.getByText("Retail Completed Charlie")).toBeVisible();
  await expect(authedPage.getByText("Cards Completed Bravo")).toBeHidden();
  await expect(authedPage.getByText("Retail Draft Alpha")).toBeHidden();

  // Clear filters via the chip-row affordance — every row returns and
  // chips are unpressed.
  await authedPage.getByTestId("clear-filters-chip-row").click();

  await expect(authedPage.getByText("Retail Draft Alpha")).toBeVisible();
  await expect(authedPage.getByText("Cards Completed Bravo")).toBeVisible();
  await expect(authedPage.getByText("Retail Completed Charlie")).toBeVisible();
  await expect(
    authedPage.getByTestId("filter-status-completed")
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    authedPage.getByTestId("filter-brand-acme-retail")
  ).toHaveAttribute("aria-pressed", "false");
});

test("filtered empty state offers Clear filters when nothing matches", async ({
  authedPage,
}) => {
  await authedPage.route("**/api/v1/brand-kits", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(BRAND_KITS),
    });
  });

  await authedPage.route("**/api/v1/emailers**", (route) => {
    const req = route.request();
    if (req.method() !== "GET") return route.fallback();
    const url = new URL(req.url());
    if (!/\/api\/v1\/emailers\/?$/.test(url.pathname)) {
      return route.fallback();
    }
    // Use a corpus where no row matches "exported" — toggling that chip
    // produces a guaranteed empty list.
    const subset = filterCorpus(url.searchParams);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(subset),
    });
  });

  await authedPage.route("**/api/v1/emailers/*/cost*", (route) => {
    const req = route.request();
    if (req.method() !== "GET") return route.fallback();
    const match = req.url().match(/\/emailers\/(\d+)\/cost/);
    const id = match ? Number(match[1]) : 0;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(zeroCostBody(id)),
    });
  });

  await authedPage.goto("/");
  await expect(authedPage.getByText("Retail Draft Alpha")).toBeVisible();

  // Toggle Exported — corpus has no exported rows -> empty result.
  await authedPage.getByTestId("filter-status-exported").click();

  await expect(authedPage.getByTestId("filtered-empty-state")).toBeVisible();
  await expect(
    authedPage.getByText("No emailers match the selected filters.")
  ).toBeVisible();

  await authedPage.getByTestId("clear-filters").click();

  // After clearing, the rows return.
  await expect(authedPage.getByText("Retail Draft Alpha")).toBeVisible();
  await expect(
    authedPage.getByTestId("filtered-empty-state")
  ).toBeHidden();
});
