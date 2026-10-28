import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminObservabilityPage from "./AdminObservabilityPage";
import * as costApi from "../api/cost";
import type {
  EmailerCostDetail,
  EmailersCostList,
} from "../api/cost";
import { AuthContext, type AuthContextValue } from "../contexts/AuthContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
}

function makeAuth(role: "admin" | "editor" | null): AuthContextValue {
  return {
    token: "fake-token",
    user: {
      id: 1,
      email: role === "admin" ? "admin@phishforge.io" : "priya@phishforge.io",
      name: role === "admin" ? "Admin" : "Priya",
      role,
    },
    isAuthenticated: true,
    isAdmin: role === "admin",
    profileLoaded: true,
    login: vi.fn(),
    logout: vi.fn(),
  };
}

function renderPage(auth: AuthContextValue) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/observability"]}>
        <AuthContext.Provider value={auth}>
          <Routes>
            <Route
              path="/admin/observability"
              element={<AdminObservabilityPage />}
            />
            <Route
              path="/"
              element={<div data-testid="home-page">Home page</div>}
            />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const MOCK_LIST: EmailersCostList = {
  emailers: [
    {
      emailer_id: 7,
      emailer_name: "Festival Blast",
      creator_email: "alpha@phishforge.io",
      total_calls: 12,
      total_input_tokens: 12_000,
      total_output_tokens: 4_000,
      total_cache_read_tokens: 8_000,
      total_cache_write_tokens: 1_000,
      estimated_cost_usd: 1.2345,
      first_call_at: "2026-04-20T08:00:00Z",
      last_call_at: "2026-04-25T08:00:00Z",
    },
    {
      emailer_id: 9,
      emailer_name: "Q4 Savings",
      creator_email: "beta@phishforge.io",
      total_calls: 5,
      total_input_tokens: 5_000,
      total_output_tokens: 1_000,
      total_cache_read_tokens: 0,
      total_cache_write_tokens: 0,
      estimated_cost_usd: 0.0789,
      first_call_at: "2026-04-22T08:00:00Z",
      last_call_at: "2026-04-24T08:00:00Z",
    },
  ],
};

function makeDetail(emailerId: number, offset: number): EmailerCostDetail {
  // Server returns the page-relative slice of calls; this fixture
  // returns one call per page so the test can assert pagination
  // navigation triggers a fresh API call with the right offset.
  return {
    summary: MOCK_LIST.emailers.find((e) => e.emailer_id === emailerId)!,
    calls: [
      {
        id: 100 + offset,
        stage_name: "generate",
        model: "claude-sonnet-4-6",
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        estimated_cost_usd: 0.005,
        latency_ms: 1234,
        success: true,
        error_message: null,
        called_at: `2026-04-25T0${offset % 10}:00:00Z`,
      },
    ],
    total: 200, // big enough to leave Next enabled across pages
    limit: 50,
    offset,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdminObservabilityPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects non-admin users to /", async () => {
    renderPage(makeAuth("editor"));
    await waitFor(() =>
      expect(screen.getByTestId("home-page")).toBeInTheDocument()
    );
  });

  it("renders the admin emailer cost table for admin users", async () => {
    vi.spyOn(costApi, "listAdminEmailerCosts").mockResolvedValue(MOCK_LIST);

    renderPage(makeAuth("admin"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-row-7")).toBeInTheDocument()
    );

    // Both rows render with creator email and formatted cost.
    expect(screen.getByText("Festival Blast")).toBeInTheDocument();
    expect(screen.getByText("alpha@phishforge.io")).toBeInTheDocument();
    expect(screen.getByText("$1.2345")).toBeInTheDocument();

    expect(screen.getByText("Q4 Savings")).toBeInTheDocument();
    expect(screen.getByText("beta@phishforge.io")).toBeInTheDocument();
    expect(screen.getByText("$0.0789")).toBeInTheDocument();
  });

  it("opens the call log when a row is clicked and paginates with Next/Prev", async () => {
    vi.spyOn(costApi, "listAdminEmailerCosts").mockResolvedValue(MOCK_LIST);
    const detailSpy = vi
      .spyOn(costApi, "getAdminEmailerCost")
      .mockImplementation(async (id, opts) =>
        makeDetail(id, opts?.offset ?? 0)
      );

    const user = userEvent.setup();
    renderPage(makeAuth("admin"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-row-7")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("admin-row-7"));

    // Detail panel renders.
    await waitFor(() =>
      expect(screen.getByTestId("admin-call-log")).toBeInTheDocument()
    );

    // First request to the detail endpoint had offset=0.
    expect(detailSpy).toHaveBeenCalledWith(7, { limit: 50, offset: 0 });

    // Hit Next — offset becomes 50.
    const callLog = screen.getByTestId("admin-call-log");
    await user.click(within(callLog).getByTestId("admin-call-log-next"));
    await waitFor(() =>
      expect(detailSpy).toHaveBeenCalledWith(7, { limit: 50, offset: 50 })
    );

    // Hit Prev — back to offset=0.
    await user.click(within(callLog).getByTestId("admin-call-log-prev"));
    await waitFor(() => {
      // The (limit=50, offset=0) call has now happened twice.
      const matches = detailSpy.mock.calls.filter(
        ([, opts]) => opts?.offset === 0
      );
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("waits for profile to load before deciding admin gating", () => {
    // profileLoaded=false should render a loading spinner instead of
    // briefly redirecting; this prevents a flash of the home page
    // during the /auth/me round-trip on first mount.
    const auth: AuthContextValue = {
      ...makeAuth(null),
      profileLoaded: false,
    };

    renderPage(auth);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("home-page")).not.toBeInTheDocument();
  });
});
