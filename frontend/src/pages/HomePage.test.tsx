import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import HomePage from "./HomePage";
import * as emailersApi from "../api/emailers";
import * as costApi from "../api/cost";
import type { EmailerSummary } from "../api/emailers";
import type { EmailerCostDetail } from "../api/cost";
import { AuthContext, type AuthContextValue } from "../contexts/AuthContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // STORY-7.9 AC-9: leave refetchOnWindowFocus on its default (true)
      // so the focus-refetch test below can exercise it. staleTime stays
      // at 0 so the query is considered stale on focus and re-issues.
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
}

// STORY-7.8: HomePage tests now stub cost via AuthContext (instead of
// AuthProvider) so we don't have to mock /auth/me round-trips. The
// behaviour we exercise (list, sort, render) doesn't depend on the auth
// fetch wiring.
const AUTH_VALUE: AuthContextValue = {
  token: "fake-token",
  user: {
    id: 1,
    email: "priya@phishforge.io",
    name: "Priya",
    role: "editor",
  },
  isAuthenticated: true,
  isAdmin: false,
  profileLoaded: true,
  login: vi.fn(),
  logout: vi.fn(),
};

function renderHomePage() {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <AuthContext.Provider value={AUTH_VALUE}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route
              path="/brief"
              element={<div data-testid="brief-page">Brief page</div>}
            />
            <Route
              path="/emailers/:id"
              element={<div data-testid="emailer-page">Emailer page</div>}
            />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// Build a per-emailer cost detail with the supplied USD total. Used to
// stub `getEmailerCost` per row.
function makeCostDetail(emailerId: number, usd: number): EmailerCostDetail {
  return {
    summary: {
      emailer_id: emailerId,
      emailer_name: `Emailer #${emailerId}`,
      creator_email: "priya@phishforge.io",
      total_calls: usd === 0 ? 0 : 2,
      total_input_tokens: usd === 0 ? 0 : 1000,
      total_output_tokens: usd === 0 ? 0 : 500,
      total_cache_read_tokens: 0,
      total_cache_write_tokens: 0,
      estimated_cost_usd: usd,
      first_call_at: usd === 0 ? null : "2026-04-25T09:00:00Z",
      last_call_at: usd === 0 ? null : "2026-04-25T09:30:00Z",
    },
    calls: [],
    total: 0,
    limit: 50,
    offset: 0,
  };
}

const MOCK_EMAILERS: EmailerSummary[] = [
  {
    id: 1,
    name: "Q4 Savings Campaign",
    status: "draft",
    created_at: "2026-04-20T10:00:00Z",
    updated_at: "2026-04-22T14:30:00Z",
  },
  {
    id: 2,
    name: "Festival Offer Blast",
    status: "in_review",
    created_at: "2026-04-18T08:00:00Z",
    updated_at: "2026-04-23T09:15:00Z",
  },
  {
    id: 3,
    name: "Monthly Statement",
    status: "completed",
    created_at: "2026-04-10T06:00:00Z",
    updated_at: "2026-04-21T16:00:00Z",
  },
  {
    id: 4,
    name: "Year-End Export",
    status: "exported",
    created_at: "2026-04-01T12:00:00Z",
    updated_at: "2026-04-15T10:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HomePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // STORY-7.8: every row fires a cost query. Stub a generic resolver
    // for tests that don't care about cost data so they don't hit the
    // network — individual tests that DO care (sort, render) override
    // with a per-id mockResolvedValueOnce / mockImplementation.
    vi.spyOn(costApi, "getEmailerCost").mockImplementation(
      async (id: number) => makeCostDetail(id, 0)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Loading state
  // -------------------------------------------------------------------------
  it("renders loading state while fetching emailers", () => {
    vi.spyOn(emailersApi, "listEmailers").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    renderHomePage();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/loading simulations/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Emailer list with correct data
  // -------------------------------------------------------------------------
  it("renders emailer list with names and status badges", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue(MOCK_EMAILERS);

    renderHomePage();

    // Wait for data to load
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // All emailer names should be visible
    expect(screen.getByText("Q4 Savings Campaign")).toBeInTheDocument();
    expect(screen.getByText("Festival Offer Blast")).toBeInTheDocument();
    expect(screen.getByText("Monthly Statement")).toBeInTheDocument();
    expect(screen.getByText("Year-End Export")).toBeInTheDocument();

    // STORY-AP1.2: the per-row brand-kit badge has been removed.

    // Status badges. Status labels also appear in the filter chip row
    // (STORY-1.3), so we scope to the row badges by waiting for the
    // filter chip row to render and then matching only the non-chip
    // occurrence of each label.
    await waitFor(() =>
      expect(screen.getByTestId("filter-status-draft")).toBeInTheDocument()
    );
    // Each status label appears at least twice now: once in the filter
    // chip row, plus once per matching row. Confirm both surfaces:
    expect(screen.getAllByText("Draft").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("In Review").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Exported").length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // 3. Default sort: last updated descending (AC-2)
  // -------------------------------------------------------------------------
  it("sorts emailers by updated_at descending", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue(MOCK_EMAILERS);

    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // Get all emailer row links in order
    const links = screen.getAllByRole("link").filter(
      (link) => link.getAttribute("href")?.startsWith("/emailers/")
    );

    // Expected order by updated_at desc:
    // Festival Offer Blast (2026-04-23), Q4 Savings (2026-04-22), Monthly Statement (2026-04-21), Year-End Export (2026-04-15)
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute("href", "/emailers/2");
    expect(links[1]).toHaveAttribute("href", "/emailers/1");
    expect(links[2]).toHaveAttribute("href", "/emailers/3");
    expect(links[3]).toHaveAttribute("href", "/emailers/4");
  });

  // -------------------------------------------------------------------------
  // 4. Empty state with CTA
  // -------------------------------------------------------------------------
  it("renders empty state with CTA when no emailers exist", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue([]);

    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    expect(
      screen.getByText(/you haven't created any simulations yet/i)
    ).toBeInTheDocument();

    const ctaLink = screen.getByRole("link", {
      name: /create your first simulation/i,
    });
    expect(ctaLink).toBeInTheDocument();
    expect(ctaLink).toHaveAttribute("href", "/brief");
  });

  // -------------------------------------------------------------------------
  // STORY-1.2 AC-4: the Create CTA renders a "+" icon next to the label.
  // The plus glyph is encoded as an SVG <path> with the FontAwesome-style
  // "M10 3a1 1..." data string, so we assert the SVG nests inside the
  // button. Using a structural query keeps this test independent of the
  // exact icon library.
  // -------------------------------------------------------------------------
  it("renders a plus icon inside the Create new emailer button", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue(MOCK_EMAILERS);

    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    const createButton = screen.getByRole("button", {
      name: /create new simulation/i,
    });
    const svg = createButton.querySelector("svg");
    expect(svg).not.toBeNull();
    // The "M10 3a1 1 0 011 1v5h5" path is the canonical "+" outline; we
    // match the leading "M10 3" prefix so a future icon swap (different
    // arc/rounding) still passes as long as it's a centred plus.
    const plusPath = createButton.querySelector('path[d^="M10 3"]');
    expect(plusPath).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // STORY-1.1 AC-9: refetch when window regains focus.
  // React Query v5's focusManager subscribes to ``visibilitychange`` (not
  // ``focus``); driving it via the manager itself is the canonical test
  // path and avoids relying on jsdom's event-bubbling specifics. The
  // query's staleTime=0 (set in makeQueryClient) plus the default
  // refetchOnWindowFocus=true is what makes the second call fire.
  // -------------------------------------------------------------------------
  it("refetches emailers when the window regains focus", async () => {
    const listSpy = vi
      .spyOn(emailersApi, "listEmailers")
      .mockResolvedValue(MOCK_EMAILERS);

    renderHomePage();

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    // Simulate a window-focus regain by toggling the focusManager from
    // unfocused → focused. Wrapped in act() so the resulting state
    // updates flush before our assertion.
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    // Reset the focus manager to its default behaviour so subsequent
    // tests are unaffected.
    focusManager.setFocused(undefined);
  });

  // -------------------------------------------------------------------------
  // 5. "Create new emailer" button navigates to /brief
  // -------------------------------------------------------------------------
  it("has a 'Create new emailer' button that navigates to /brief", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue(MOCK_EMAILERS);

    const user = (await import("@testing-library/user-event")).default.setup();
    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    const createButton = screen.getByRole("button", {
      name: /create new simulation/i,
    });
    expect(createButton).toBeInTheDocument();

    await user.click(createButton);

    // Should navigate to brief page
    await waitFor(() =>
      expect(screen.getByTestId("brief-page")).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // 5b. Clicking an emailer row navigates to /emailers/:id (STORY-1.4)
  // -------------------------------------------------------------------------
  it("navigates to /emailers/:id when clicking an emailer row", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue(MOCK_EMAILERS);

    const user = (await import("@testing-library/user-event")).default.setup();
    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // Click the first emailer row (sorted by updated_at desc => id=2 first)
    const firstRow = screen.getByText("Festival Offer Blast").closest("a");
    expect(firstRow).toBeInTheDocument();

    await user.click(firstRow!);

    // Should navigate to emailer page
    await waitFor(() =>
      expect(screen.getByTestId("emailer-page")).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // 6. Error state
  // -------------------------------------------------------------------------
  it("renders error state when API call fails", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockRejectedValue(
      new Error("Network error")
    );

    renderHomePage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/network error/i);
  });

  // -------------------------------------------------------------------------
  // 7. Emailer count label
  // -------------------------------------------------------------------------
  it("shows correct emailer count", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue(MOCK_EMAILERS);

    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    expect(screen.getByText("4 simulations")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 8. Single emailer uses singular label
  // -------------------------------------------------------------------------
  it("shows singular 'emailer' for single item", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue([
      MOCK_EMAILERS[0],
    ]);

    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    expect(screen.getByText("1 simulation")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 9. Page header shows the section title
  //
  // STORY-AP7.1: the global "PhishForge" wordmark moved to the shared app
  // shell (TopBar). This page now carries the section title "Simulations" in
  // its own page header.
  // -------------------------------------------------------------------------
  it("renders the Simulations page title in the header", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue([]);

    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    expect(
      screen.getByRole("heading", { name: "Simulations" })
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // STORY-7.8 AC-2: cost column renders per row, formatted to AC-4 spec.
  // -------------------------------------------------------------------------
  it("renders a per-row cost cell formatted to 4 decimal places", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue([
      MOCK_EMAILERS[0],
      MOCK_EMAILERS[1],
    ]);
    vi.spyOn(costApi, "getEmailerCost").mockImplementation(async (id: number) => {
      return makeCostDetail(id, id === 1 ? 0.0234 : 1.5678);
    });

    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // Wait for the cost cells to populate (they start as "…" while
    // the per-row queries are in flight).
    await waitFor(() =>
      expect(screen.getByTestId("emailer-cost-1")).toHaveTextContent(
        "$0.0234"
      )
    );
    expect(screen.getByTestId("emailer-cost-2")).toHaveTextContent(
      "$1.5678"
    );
  });

  // -------------------------------------------------------------------------
  // STORY-7.8 AC-2: clicking the Cost header re-orders the list.
  // -------------------------------------------------------------------------
  it("re-sorts the list by cost descending when the Cost column header is clicked", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue([
      MOCK_EMAILERS[0], // id=1
      MOCK_EMAILERS[1], // id=2
      MOCK_EMAILERS[2], // id=3
    ]);
    // id=2 most expensive, id=1 least.
    vi.spyOn(costApi, "getEmailerCost").mockImplementation(async (id: number) => {
      const map: Record<number, number> = { 1: 0.01, 2: 0.5, 3: 0.1 };
      return makeCostDetail(id, map[id] ?? 0);
    });

    const user = (await import("@testing-library/user-event")).default.setup();
    renderHomePage();

    await waitFor(() =>
      expect(screen.getByTestId("emailer-cost-2")).toHaveTextContent(
        "$0.5000"
      )
    );

    await user.click(screen.getByTestId("sort-by-cost"));

    // After sorting cost desc the row order should be 2, 3, 1.
    await waitFor(() => {
      const linkOrder = screen
        .getAllByRole("link")
        .filter((l) => l.getAttribute("href")?.startsWith("/emailers/"))
        .map((l) => l.getAttribute("href"));
      expect(linkOrder).toEqual([
        "/emailers/2",
        "/emailers/3",
        "/emailers/1",
      ]);
    });

    // Clicking again flips to ascending.
    await user.click(screen.getByTestId("sort-by-cost"));

    await waitFor(() => {
      const linkOrder = screen
        .getAllByRole("link")
        .filter((l) => l.getAttribute("href")?.startsWith("/emailers/"))
        .map((l) => l.getAttribute("href"));
      expect(linkOrder).toEqual([
        "/emailers/1",
        "/emailers/3",
        "/emailers/2",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // STORY-1.3: filter chip row renders both facets
  // -------------------------------------------------------------------------
  it("renders the filter chip row with status facets", async () => {
    vi.spyOn(emailersApi, "listEmailers").mockResolvedValue(MOCK_EMAILERS);

    renderHomePage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // The chip row container is present.
    expect(screen.getByTestId("filter-chip-row")).toBeInTheDocument();

    // All four status chips render with the expected labels.
    expect(screen.getByTestId("filter-status-draft")).toHaveTextContent(
      "Draft"
    );
    expect(screen.getByTestId("filter-status-in_review")).toHaveTextContent(
      "In Review"
    );
    expect(screen.getByTestId("filter-status-completed")).toHaveTextContent(
      "Completed"
    );
    expect(screen.getByTestId("filter-status-exported")).toHaveTextContent(
      "Exported"
    );

    // STORY-AP1.2: the brand-kit filter facet has been removed entirely.
    expect(
      screen.queryByTestId("filter-brand-acme-retail")
    ).not.toBeInTheDocument();

    // All chips start unselected.
    expect(screen.getByTestId("filter-status-draft")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  // -------------------------------------------------------------------------
  // STORY-1.3: clicking a status chip toggles it and refetches with the
  // right query args. We assert on the *args* `listEmailers` was called
  // with — that's the contract the backend depends on.
  // -------------------------------------------------------------------------
  it("toggles a status chip on and refetches with the right query args", async () => {
    const listSpy = vi
      .spyOn(emailersApi, "listEmailers")
      .mockResolvedValue(MOCK_EMAILERS);

    const user = (await import("@testing-library/user-event")).default.setup();
    renderHomePage();

    // Wait for the initial fetch (no filters).
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));
    expect(listSpy).toHaveBeenLastCalledWith({
      statusFilter: [],
    });

    // Click the Draft chip.
    await user.click(screen.getByTestId("filter-status-draft"));

    // Refetch should fire with statusFilter=[draft].
    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith({
        statusFilter: ["draft"],
      })
    );

    // Chip is now visually selected.
    expect(screen.getByTestId("filter-status-draft")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  // -------------------------------------------------------------------------
  // STORY-1.3: clicking a chip a second time deselects it
  // -------------------------------------------------------------------------
  it("deselects a chip when clicked twice", async () => {
    const listSpy = vi
      .spyOn(emailersApi, "listEmailers")
      .mockResolvedValue(MOCK_EMAILERS);

    const user = (await import("@testing-library/user-event")).default.setup();
    renderHomePage();

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    const draftChip = screen.getByTestId("filter-status-draft");
    await user.click(draftChip);
    await waitFor(() =>
      expect(draftChip).toHaveAttribute("aria-pressed", "true")
    );

    await user.click(draftChip);
    await waitFor(() =>
      expect(draftChip).toHaveAttribute("aria-pressed", "false")
    );

    // Final list call has no status filter again.
    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith({
        statusFilter: [],
      })
    );
  });

  // -------------------------------------------------------------------------
  // STORY-1.3: selecting multiple status chips sends them in a single call.
  // -------------------------------------------------------------------------
  it("combines multiple status filters in a single refetch", async () => {
    const listSpy = vi
      .spyOn(emailersApi, "listEmailers")
      .mockResolvedValue(MOCK_EMAILERS);

    const user = (await import("@testing-library/user-event")).default.setup();
    renderHomePage();

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    await user.click(screen.getByTestId("filter-status-completed"));
    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith({
        statusFilter: ["completed"],
      })
    );

    await user.click(screen.getByTestId("filter-status-draft"));

    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith({
        statusFilter: ["completed", "draft"],
      })
    );
  });

  // -------------------------------------------------------------------------
  // STORY-1.3: empty state with filters offers a Clear filters button that
  // resets state.
  // -------------------------------------------------------------------------
  it("renders the filtered empty state and resets state when Clear is clicked", async () => {
    // First call returns rows; after the user toggles a filter we return
    // an empty list, which triggers the filtered empty state.
    const listSpy = vi.spyOn(emailersApi, "listEmailers");
    listSpy.mockImplementation(async (filters) => {
      if (filters?.statusFilter?.length) {
        return [];
      }
      return MOCK_EMAILERS;
    });

    const user = (await import("@testing-library/user-event")).default.setup();
    renderHomePage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Savings Campaign")).toBeInTheDocument()
    );

    // Toggle a filter that yields zero rows.
    await user.click(screen.getByTestId("filter-status-draft"));

    // The filtered empty state replaces the list.
    await waitFor(() =>
      expect(screen.getByTestId("filtered-empty-state")).toBeInTheDocument()
    );
    expect(
      screen.getByText(/No simulations match the selected filters\./i)
    ).toBeInTheDocument();

    // The pristine "you haven't created any simulations yet" copy must NOT
    // render here — that branch is reserved for the unfiltered zero
    // case so we don't tell users with a typo'd filter that they have
    // no simulations at all.
    expect(
      screen.queryByText(/you haven't created any simulations yet/i)
    ).not.toBeInTheDocument();

    // Click the Clear filters button — list returns and the chip
    // de-selects.
    await user.click(screen.getByTestId("clear-filters"));

    await waitFor(() =>
      expect(screen.getByText("Q4 Savings Campaign")).toBeInTheDocument()
    );
    expect(screen.getByTestId("filter-status-draft")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(
      screen.queryByTestId("filtered-empty-state")
    ).not.toBeInTheDocument();
  });
});
