import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AssetLibraryPage from "./AssetLibraryPage";
import * as libraryAssetsApi from "../api/libraryAssets";
import type {
  LibraryAssetRead,
  LibraryAssetListResponse,
} from "../api/libraryAssets";
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

function renderAssetLibraryPage() {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/assets"]}>
        <AuthContext.Provider value={AUTH_VALUE}>
          <Routes>
            <Route path="/assets" element={<AssetLibraryPage />} />
            <Route
              path="/assets/:id"
              element={<div data-testid="asset-detail-page">Asset detail</div>}
            />
            <Route
              path="/"
              element={<div data-testid="home-page">Home</div>}
            />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_ASSETS: LibraryAssetRead[] = [
  {
    id: "asset-1",
    name: "Diwali Festive Banner",
    source: "generated",
    tags: ["banner", "diwali", "festive"],
    created_by_name: "Priya",
    primary_version: {
      id: "v-1",
      version_number: 3,
      thumbnail_url: null,
      storage_url: null,
      width: 600,
      height: 200,
      file_size_bytes: 290816,
      prompt_text: "A festive Diwali banner",
      refinement_instruction: null,
      model_used: "gpt-image-1",
      cost_usd: 0.04,
      created_at: "2026-05-02T10:00:00Z",
    },
    created_at: "2026-05-02T10:00:00Z",
  },
  {
    id: "asset-2",
    name: "Credit Card Hero Image",
    source: "generated",
    tags: ["hero", "credit-card"],
    created_by_name: "Priya",
    primary_version: {
      id: "v-2",
      version_number: 2,
      thumbnail_url: "http://localhost/thumbs/asset-2.png",
      storage_url: null,
      width: 600,
      height: 400,
      file_size_bytes: 512000,
      prompt_text: null,
      refinement_instruction: null,
      model_used: "gpt-image-1",
      cost_usd: 0.04,
      created_at: "2026-04-28T10:00:00Z",
    },
    created_at: "2026-04-28T10:00:00Z",
  },
  {
    id: "asset-3",
    name: "SmartBuy Promo Background",
    source: "uploaded",
    tags: ["background", "smartbuy"],
    created_by_name: "Priya",
    primary_version: {
      id: "v-3",
      version_number: 1,
      thumbnail_url: null,
      storage_url: null,
      width: 600,
      height: 200,
      file_size_bytes: 180000,
      prompt_text: null,
      refinement_instruction: null,
      model_used: null,
      cost_usd: null,
      created_at: "2026-04-25T10:00:00Z",
    },
    created_at: "2026-04-25T10:00:00Z",
  },
];

function makeMockResponse(
  items: LibraryAssetRead[] = MOCK_ASSETS,
  total?: number
): LibraryAssetListResponse {
  return { items, total: total ?? items.length };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AssetLibraryPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default mock for fetchTags so the tags query never fails
    vi.spyOn(libraryAssetsApi, "fetchTags").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Renders with mock data
  // -----------------------------------------------------------------------
  it("renders asset cards with names, badges, and count", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockResolvedValue(
      makeMockResponse()
    );

    renderAssetLibraryPage();

    // Wait for the grid to appear
    await waitFor(() =>
      expect(screen.getByTestId("asset-grid")).toBeInTheDocument()
    );

    // Asset names
    expect(screen.getByText("Diwali Festive Banner")).toBeInTheDocument();
    expect(screen.getByText("Credit Card Hero Image")).toBeInTheDocument();
    expect(screen.getByText("SmartBuy Promo Background")).toBeInTheDocument();

    // Count badge
    expect(screen.getByTestId("count-badge")).toHaveTextContent("3 assets");

    // Source badges — "AI Generated" appears in filter chips + card badges;
    // "Uploaded" appears in filter chips + card badge for asset-3.
    const aiGeneratedBadges = screen.getAllByText("AI Generated");
    expect(aiGeneratedBadges.length).toBeGreaterThanOrEqual(2);
    const uploadedBadges = screen.getAllByText("Uploaded");
    expect(uploadedBadges.length).toBeGreaterThanOrEqual(2);

    // Version badges
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 2. Loading state shows skeleton cards
  // -----------------------------------------------------------------------
  it("renders skeleton cards while loading", () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    renderAssetLibraryPage();

    expect(screen.getByTestId("loading-grid")).toBeInTheDocument();
    const skeletons = screen.getAllByTestId("skeleton-card");
    expect(skeletons.length).toBe(8);
  });

  // -----------------------------------------------------------------------
  // 3. Search filter triggers API with debounce
  // -----------------------------------------------------------------------
  it("debounces search input and calls API with search param", async () => {
    const fetchSpy = vi
      .spyOn(libraryAssetsApi, "fetchLibraryAssets")
      .mockResolvedValue(makeMockResponse());

    const user = userEvent.setup();
    renderAssetLibraryPage();

    // Wait for initial load
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Type in the search input
    const searchInput = screen.getByTestId("search-input");
    await user.type(searchInput, "diwali");

    // After debounce (300ms), API should be called with search param
    await waitFor(
      () => {
        const lastCall =
          fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0];
        expect(lastCall).toMatchObject({
          search: "diwali",
        });
      },
      { timeout: 2000 }
    );
  });

  // -----------------------------------------------------------------------
  // 4. Filter chips toggle: source filter
  // -----------------------------------------------------------------------
  it("toggles source filter chips and calls API with source param", async () => {
    const fetchSpy = vi
      .spyOn(libraryAssetsApi, "fetchLibraryAssets")
      .mockResolvedValue(makeMockResponse());

    const user = userEvent.setup();
    renderAssetLibraryPage();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Click "AI Generated" chip
    await user.click(screen.getByTestId("filter-source-generated"));

    await waitFor(() => {
      const lastCall =
        fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0];
      expect(lastCall).toMatchObject({ source: "generated" });
    });

    // Click "All" to reset
    await user.click(screen.getByTestId("filter-source-all"));

    await waitFor(() => {
      const lastCall =
        fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]?.[0];
      expect(lastCall?.source).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Filter chips toggle: dynamic tag filter (STORY-A1.3)
  // -----------------------------------------------------------------------
  it("toggles dynamic tag filter chips and calls API with tag param", async () => {
    const fetchSpy = vi
      .spyOn(libraryAssetsApi, "fetchLibraryAssets")
      .mockResolvedValue(makeMockResponse());
    vi.spyOn(libraryAssetsApi, "fetchTags").mockResolvedValue([
      "banner",
      "hero",
      "icon",
    ]);

    const user = userEvent.setup();
    renderAssetLibraryPage();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Wait for tag chips to render
    await waitFor(() =>
      expect(screen.getByTestId("filter-tag-banner")).toBeInTheDocument()
    );

    // Click "banner" chip
    await user.click(screen.getByTestId("filter-tag-banner"));

    await waitFor(() => {
      const lastCall =
        fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0];
      expect(lastCall).toMatchObject({ tag: "banner" });
    });

    // Click "All" tag chip to reset
    await user.click(screen.getByTestId("filter-tag-all"));

    await waitFor(() => {
      const lastCall =
        fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]?.[0];
      expect(lastCall?.tag).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Empty state renders when no assets
  // -----------------------------------------------------------------------
  it("renders empty state when no assets exist", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockResolvedValue(
      makeMockResponse([], 0)
    );

    renderAssetLibraryPage();

    await waitFor(() =>
      expect(screen.getByTestId("empty-state")).toBeInTheDocument()
    );

    expect(screen.getByText("No assets yet")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 7. Filtered empty state with clear button and generate button
  // -----------------------------------------------------------------------
  it("shows filtered empty state with clear filters and generate buttons", async () => {
    const fetchSpy = vi
      .spyOn(libraryAssetsApi, "fetchLibraryAssets")
      .mockResolvedValue(makeMockResponse([], 0));

    const user = userEvent.setup();
    renderAssetLibraryPage();

    // Wait for initial load (unfiltered empty state)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Activate a filter so hasFilters is true
    await user.click(screen.getByTestId("filter-source-generated"));

    await waitFor(() =>
      expect(screen.getByTestId("filtered-empty-state")).toBeInTheDocument()
    );

    // Verify updated copy
    expect(
      screen.getByText("No assets match your search.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Try different keywords or generate a new asset.")
    ).toBeInTheDocument();

    // Both CTAs should be present
    expect(screen.getByTestId("clear-filters")).toBeInTheDocument();
    expect(screen.getByTestId("filtered-generate-btn")).toBeInTheDocument();
    expect(screen.getByTestId("filtered-generate-btn")).toHaveTextContent(
      "+ Generate new"
    );

    // Click clear filters — resets to "all"
    await user.click(screen.getByTestId("clear-filters"));

    await waitFor(() => {
      const lastCall =
        fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]?.[0];
      expect(lastCall?.source).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 7b. Filtered empty state search — typing triggers filtered state
  // -----------------------------------------------------------------------
  it("shows filtered empty state when search returns no results", async () => {
    const fetchSpy = vi
      .spyOn(libraryAssetsApi, "fetchLibraryAssets")
      .mockResolvedValue(makeMockResponse([], 0));

    const user = userEvent.setup();
    renderAssetLibraryPage();

    // Wait for initial load
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Type a search term that yields no results
    const searchInput = screen.getByTestId("search-input");
    await user.type(searchInput, "nonexistent");

    // After debounce, filtered empty state appears
    await waitFor(
      () =>
        expect(
          screen.getByTestId("filtered-empty-state")
        ).toBeInTheDocument(),
      { timeout: 2000 }
    );

    expect(
      screen.getByText("No assets match your search.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("clear-filters")).toBeInTheDocument();
    expect(screen.getByTestId("filtered-generate-btn")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 7c. Search input renders with placeholder
  // -----------------------------------------------------------------------
  it("renders the search input with correct placeholder", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockResolvedValue(
      makeMockResponse()
    );

    renderAssetLibraryPage();

    await waitFor(() =>
      expect(screen.getByTestId("asset-grid")).toBeInTheDocument()
    );

    const searchInput = screen.getByTestId("search-input");
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute("placeholder", "Search assets...");
    expect(searchInput).toHaveAttribute("type", "text");
  });

  // -----------------------------------------------------------------------
  // 8. Card click navigates to /assets/:id
  // -----------------------------------------------------------------------
  it("navigates to /assets/:id when clicking an asset card", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockResolvedValue(
      makeMockResponse()
    );

    const user = userEvent.setup();
    renderAssetLibraryPage();

    await waitFor(() =>
      expect(screen.getByTestId("asset-grid")).toBeInTheDocument()
    );

    // Click the first asset card
    await user.click(screen.getByTestId("asset-card-asset-1"));

    await waitFor(() =>
      expect(screen.getByTestId("asset-detail-page")).toBeInTheDocument()
    );
  });

  // -----------------------------------------------------------------------
  // 9. Error state
  // -----------------------------------------------------------------------
  it("renders error state when API call fails", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockRejectedValue(
      new Error("Network error")
    );

    renderAssetLibraryPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/network error/i);
  });

  // -----------------------------------------------------------------------
  // 10. Back link navigates to home
  // -----------------------------------------------------------------------
  it("renders a back link that points to home", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockResolvedValue(
      makeMockResponse()
    );

    renderAssetLibraryPage();

    await waitFor(() =>
      expect(screen.getByTestId("asset-grid")).toBeInTheDocument()
    );

    const backLink = screen.getByTestId("back-link");
    expect(backLink).toHaveAttribute("href", "/");
  });

  // -----------------------------------------------------------------------
  // 11. Page header and title
  //
  // STORY-AP7.1: the global "PhishForge" wordmark and primary nav ("Emailers"
  // / "Asset Library" links) moved to the shared app shell (TopBar + SideNav).
  // This page keeps its own page title and its Upload / Generate page actions.
  // -----------------------------------------------------------------------
  it("renders the page title and page actions", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockResolvedValue(
      makeMockResponse()
    );

    renderAssetLibraryPage();

    await waitFor(() =>
      expect(screen.getByTestId("asset-grid")).toBeInTheDocument()
    );

    expect(
      screen.getByRole("heading", { name: "Asset Library" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("header-upload-btn")).toBeInTheDocument();
    expect(screen.getByTestId("header-generate-btn")).toBeInTheDocument();
  });
});
