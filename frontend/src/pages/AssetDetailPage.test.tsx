import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AssetDetailPage from "./AssetDetailPage";
import * as libraryAssetsApi from "../api/libraryAssets";
import type {
  LibraryAssetDetailRead,
  LibraryAssetVersionRead,
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

function renderAssetDetailPage(assetId = "asset-1") {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/assets/${assetId}`]}>
        <AuthContext.Provider value={AUTH_VALUE}>
          <Routes>
            <Route path="/assets/:id" element={<AssetDetailPage />} />
            <Route
              path="/assets"
              element={
                <div data-testid="asset-library-page">Asset Library</div>
              }
            />
            <Route
              path="/brief"
              element={<div data-testid="brief-page">Brief Page</div>}
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

const MOCK_VERSION_1: LibraryAssetVersionRead = {
  id: "v-1",
  version_number: 1,
  thumbnail_url: "http://localhost/thumbs/v1.png",
  storage_url: "http://localhost/images/v1.png",
  width: 600,
  height: 400,
  file_size_bytes: 290816,
  prompt_text: "A festive Diwali banner with warm colors",
  refinement_instruction: null,
  model_used: "gpt-image-1",
  cost_usd: 0.04,
  created_at: "2026-05-01T10:00:00Z",
};

const MOCK_VERSION_2: LibraryAssetVersionRead = {
  id: "v-2",
  version_number: 2,
  thumbnail_url: "http://localhost/thumbs/v2.png",
  storage_url: "http://localhost/images/v2.png",
  width: 600,
  height: 400,
  file_size_bytes: 310000,
  prompt_text: "A festive Diwali banner with warm colors",
  refinement_instruction: "Make the colors brighter",
  model_used: "gpt-image-1",
  cost_usd: 0.04,
  created_at: "2026-05-02T10:00:00Z",
};

const MOCK_VERSION_3: LibraryAssetVersionRead = {
  id: "v-3",
  version_number: 3,
  thumbnail_url: "http://localhost/thumbs/v3.png",
  storage_url: "http://localhost/images/v3.png",
  width: 600,
  height: 400,
  file_size_bytes: 325000,
  prompt_text: "A festive Diwali banner with warm colors",
  refinement_instruction: "Add more sparkle effects",
  model_used: "gpt-image-1",
  cost_usd: 0.04,
  created_at: "2026-05-03T10:00:00Z",
};

const MOCK_GENERATED_ASSET: LibraryAssetDetailRead = {
  id: "asset-1",
  name: "Diwali Festive Banner",
  source: "generated",
  tags: ["banner", "diwali", "festive"],
  created_by_name: "Priya",
  primary_version: MOCK_VERSION_3,
  created_at: "2026-05-01T10:00:00Z",
  versions: [MOCK_VERSION_1, MOCK_VERSION_2, MOCK_VERSION_3],
};

const MOCK_UPLOADED_ASSET: LibraryAssetDetailRead = {
  id: "asset-2",
  name: "Uploaded Logo",
  source: "uploaded",
  tags: ["logo"],
  created_by_name: "Priya",
  primary_version: {
    id: "v-u1",
    version_number: 1,
    thumbnail_url: "http://localhost/thumbs/logo.png",
    storage_url: "http://localhost/images/logo.png",
    width: 200,
    height: 200,
    file_size_bytes: 45000,
    prompt_text: null,
    refinement_instruction: null,
    model_used: null,
    cost_usd: null,
    created_at: "2026-04-20T10:00:00Z",
  },
  created_at: "2026-04-20T10:00:00Z",
  versions: [
    {
      id: "v-u1",
      version_number: 1,
      thumbnail_url: "http://localhost/thumbs/logo.png",
      storage_url: "http://localhost/images/logo.png",
      width: 200,
      height: 200,
      file_size_bytes: 45000,
      prompt_text: null,
      refinement_instruction: null,
      model_used: null,
      cost_usd: null,
      created_at: "2026-04-20T10:00:00Z",
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AssetDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Renders asset name, image, and metadata
  // -----------------------------------------------------------------------
  it("renders asset name, image, and metadata", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("asset-detail")).toBeInTheDocument()
    );

    // Asset name
    expect(screen.getByTestId("asset-name")).toHaveTextContent(
      "Diwali Festive Banner"
    );

    // Preview image
    const previewImg = screen.getByTestId("preview-image");
    expect(previewImg).toHaveAttribute(
      "src",
      "http://localhost/images/v3.png"
    );

    // Metadata
    expect(screen.getByTestId("metadata-card")).toBeInTheDocument();
    expect(screen.getByTestId("dimensions")).toHaveTextContent("600 x 400");
    expect(screen.getByTestId("file-size")).toHaveTextContent("317.4 KB");
  });

  // -----------------------------------------------------------------------
  // 2. Version history renders all versions
  // -----------------------------------------------------------------------
  it("renders all versions in version history", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    expect(screen.getByTestId("version-row-v-1")).toBeInTheDocument();
    expect(screen.getByTestId("version-row-v-2")).toBeInTheDocument();
    expect(screen.getByTestId("version-row-v-3")).toBeInTheDocument();

    // Version numbers displayed
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 3. Clicking a version switches the displayed image
  // -----------------------------------------------------------------------
  it("switches displayed image when a version is clicked", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("asset-detail")).toBeInTheDocument()
    );

    // Initially shows primary version (v3)
    expect(screen.getByTestId("preview-image")).toHaveAttribute(
      "src",
      "http://localhost/images/v3.png"
    );

    // Click v1
    await user.click(screen.getByTestId("version-row-v-1"));

    expect(screen.getByTestId("preview-image")).toHaveAttribute(
      "src",
      "http://localhost/images/v1.png"
    );

    // Click v2
    await user.click(screen.getByTestId("version-row-v-2"));

    expect(screen.getByTestId("preview-image")).toHaveAttribute(
      "src",
      "http://localhost/images/v2.png"
    );
  });

  // -----------------------------------------------------------------------
  // 4. Primary version shows "(current)" label
  // -----------------------------------------------------------------------
  it("shows (current) label on the primary version", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    // v-3 is the primary version
    expect(screen.getByTestId("current-label-v-3")).toHaveTextContent(
      "(current)"
    );

    // Other versions should NOT have the current label
    expect(
      screen.queryByTestId("current-label-v-1")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("current-label-v-2")
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 5. Prompt card shows for generated assets, hidden for uploaded
  // -----------------------------------------------------------------------
  it("shows prompt card for generated assets with prompt text", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("prompt-card")).toBeInTheDocument()
    );

    expect(
      screen.getByText("A festive Diwali banner with warm colors")
    ).toBeInTheDocument();
  });

  it("hides prompt card for uploaded assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_UPLOADED_ASSET
    );

    renderAssetDetailPage("asset-2");

    await waitFor(() =>
      expect(screen.getByTestId("asset-detail")).toBeInTheDocument()
    );

    expect(screen.queryByTestId("prompt-card")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 6. Tag chips render correctly
  // -----------------------------------------------------------------------
  it("renders tag chips correctly", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("asset-info-card")).toBeInTheDocument()
    );

    expect(screen.getByTestId("tag-chip-banner")).toBeInTheDocument();
    expect(screen.getByTestId("tag-chip-diwali")).toBeInTheDocument();
    expect(screen.getByTestId("tag-chip-festive")).toBeInTheDocument();

    // Add tag button present
    expect(screen.getByTestId("add-tag-btn")).toHaveTextContent("+ Add tag");
  });

  // -----------------------------------------------------------------------
  // 7. Download button triggers download
  // -----------------------------------------------------------------------
  it("download button creates a download anchor and clicks it", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("actions-card")).toBeInTheDocument()
    );

    // Spy on anchor click — createElement will produce a real anchor
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreateElement(tag, options);
      if (tag === "a") {
        el.click = clickSpy;
      }
      return el;
    });

    await user.click(screen.getByTestId("download-btn"));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 8. Delete button opens confirmation dialog
  // -----------------------------------------------------------------------
  it("delete button opens confirmation dialog", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("actions-card")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("delete-btn"));

    expect(
      screen.getByTestId("confirm-delete-dialog")
    ).toBeInTheDocument();
    expect(screen.getByTestId("confirm-delete-message")).toHaveTextContent(
      "Diwali Festive Banner"
    );
  });

  // -----------------------------------------------------------------------
  // 9. Back link navigates to /assets
  // -----------------------------------------------------------------------
  it("back link navigates to /assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("asset-detail")).toBeInTheDocument()
    );

    const backLink = screen.getByTestId("back-link");
    expect(backLink).toHaveAttribute("href", "/assets");

    await user.click(backLink);

    await waitFor(() =>
      expect(screen.getByTestId("asset-library-page")).toBeInTheDocument()
    );
  });

  // -----------------------------------------------------------------------
  // 10. Loading state (skeleton)
  // -----------------------------------------------------------------------
  it("renders skeleton while loading", () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    renderAssetDetailPage();

    expect(screen.getByTestId("detail-skeleton")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 11. Error state
  // -----------------------------------------------------------------------
  it("renders error state when API call fails", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockRejectedValue(
      new Error("Asset not found")
    );

    renderAssetDetailPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/asset not found/i);
  });

  // -----------------------------------------------------------------------
  // 12. Refine card enabled for generated assets (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("renders refine card with enabled textarea for generated assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("refine-card")).toBeInTheDocument()
    );

    const refineInput = screen.getByTestId("refine-input");
    expect(refineInput).not.toBeDisabled();
    expect(refineInput).toHaveAttribute(
      "placeholder",
      "Describe refinement..."
    );
    expect(refineInput.tagName.toLowerCase()).toBe("textarea");

    // Button is present but disabled until input is long enough
    const refineBtn = screen.getByTestId("refine-btn");
    expect(refineBtn).toBeDisabled();
    expect(refineBtn).toHaveTextContent("Refine");
  });

  // -----------------------------------------------------------------------
  // 12b. Refine card hidden for uploaded assets (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("hides refine card for uploaded assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_UPLOADED_ASSET
    );

    renderAssetDetailPage("asset-2");

    await waitFor(() =>
      expect(screen.getByTestId("asset-detail")).toBeInTheDocument()
    );

    expect(screen.queryByTestId("refine-card")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 12c. Refine input accepts text (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("refine input accepts text input", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("refine-card")).toBeInTheDocument()
    );

    const refineInput = screen.getByTestId("refine-input");
    await user.type(refineInput, "Make the background darker");

    expect(refineInput).toHaveValue("Make the background darker");
  });

  // -----------------------------------------------------------------------
  // 12d. Refine button disabled when input too short (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("refine button disabled when input is less than 5 chars", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("refine-card")).toBeInTheDocument()
    );

    const refineInput = screen.getByTestId("refine-input");
    const refineBtn = screen.getByTestId("refine-btn");

    // Empty - disabled
    expect(refineBtn).toBeDisabled();

    // 4 chars - still disabled
    await user.type(refineInput, "abcd");
    expect(refineBtn).toBeDisabled();

    // 5 chars - enabled
    await user.type(refineInput, "e");
    expect(refineBtn).not.toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // 12e. Refine button calls API with instruction (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("clicking Refine calls refineAsset API with instruction", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const refineSpy = vi
      .spyOn(libraryAssetsApi, "refineAsset")
      .mockResolvedValue(MOCK_GENERATED_ASSET);

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("refine-card")).toBeInTheDocument()
    );

    await user.type(
      screen.getByTestId("refine-input"),
      "Make the colors warmer"
    );
    await user.click(screen.getByTestId("refine-btn"));

    await waitFor(() =>
      expect(refineSpy).toHaveBeenCalledWith(
        "asset-1",
        "Make the colors warmer",
        undefined
      )
    );
  });

  // -----------------------------------------------------------------------
  // 12f. Loading state during refinement (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("shows loading state during refinement", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    let resolveRefine!: (value: LibraryAssetDetailRead) => void;
    vi.spyOn(libraryAssetsApi, "refineAsset").mockReturnValue(
      new Promise((resolve) => {
        resolveRefine = resolve;
      })
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("refine-card")).toBeInTheDocument()
    );

    await user.type(
      screen.getByTestId("refine-input"),
      "Make the image brighter"
    );
    await user.click(screen.getByTestId("refine-btn"));

    // Check loading state
    await waitFor(() =>
      expect(screen.getByTestId("refine-spinner")).toBeInTheDocument()
    );
    expect(screen.getByTestId("refine-btn")).toHaveTextContent("Refining...");
    expect(screen.getByTestId("refine-btn")).toBeDisabled();
    expect(screen.getByTestId("refine-input")).toBeDisabled();

    // Resolve to clean up
    resolveRefine(MOCK_GENERATED_ASSET);
  });

  // -----------------------------------------------------------------------
  // 12g. Success updates version history (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("success after refinement updates version history", async () => {
    const REFINED_VERSION: LibraryAssetVersionRead = {
      id: "v-refined",
      version_number: 4,
      thumbnail_url: "http://localhost/thumbs/v-refined.png",
      storage_url: "http://localhost/images/v-refined.png",
      width: 600,
      height: 400,
      file_size_bytes: 350000,
      prompt_text: "A festive Diwali banner with warm colors",
      refinement_instruction: "Make the colors warmer",
      model_used: "gpt-image-1",
      cost_usd: 0.04,
      created_at: "2026-05-05T10:00:00Z",
    };

    const UPDATED_ASSET: LibraryAssetDetailRead = {
      ...MOCK_GENERATED_ASSET,
      primary_version: REFINED_VERSION,
      versions: [...MOCK_GENERATED_ASSET.versions, REFINED_VERSION],
    };

    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );
    vi.spyOn(libraryAssetsApi, "refineAsset").mockResolvedValue(
      UPDATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("refine-card")).toBeInTheDocument()
    );

    await user.type(
      screen.getByTestId("refine-input"),
      "Make the colors warmer"
    );
    await user.click(screen.getByTestId("refine-btn"));

    // After success, the new version should appear
    await waitFor(() =>
      expect(
        screen.getByTestId("version-row-v-refined")
      ).toBeInTheDocument()
    );

    // Image should update to the new primary version
    expect(screen.getByTestId("preview-image")).toHaveAttribute(
      "src",
      "http://localhost/images/v-refined.png"
    );

    // Input should be cleared
    expect(screen.getByTestId("refine-input")).toHaveValue("");
  });

  // -----------------------------------------------------------------------
  // 12h. Error shows message (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("shows error message when refinement fails", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );
    vi.spyOn(libraryAssetsApi, "refineAsset").mockRejectedValue(
      new Error("Max versions reached")
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("refine-card")).toBeInTheDocument()
    );

    await user.type(
      screen.getByTestId("refine-input"),
      "Make the colors warmer"
    );
    await user.click(screen.getByTestId("refine-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("refine-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("refine-error")).toHaveTextContent(
      "Max versions reached"
    );
  });

  // -----------------------------------------------------------------------
  // 12i. Refine from this link in version history (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("shows Refine from this links in version history for generated assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    expect(screen.getByTestId("refine-version-v-1")).toBeInTheDocument();
    expect(screen.getByTestId("refine-version-v-2")).toBeInTheDocument();
    expect(screen.getByTestId("refine-version-v-3")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 12j. Refine from this sets fromVersionId and calls API (STORY-A3.1)
  // -----------------------------------------------------------------------
  it("Refine from this sets version and calls API with fromVersionId", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const refineSpy = vi
      .spyOn(libraryAssetsApi, "refineAsset")
      .mockResolvedValue(MOCK_GENERATED_ASSET);

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    // Click "Refine from this" on v1
    await user.click(screen.getByTestId("refine-version-v-1"));

    // Badge should appear showing we're refining from v1
    await waitFor(() =>
      expect(screen.getByTestId("refine-from-badge")).toBeInTheDocument()
    );
    expect(screen.getByTestId("refine-from-badge")).toHaveTextContent(
      "Refining from v1"
    );

    // Type instruction and refine
    await user.type(
      screen.getByTestId("refine-input"),
      "Add more sparkles"
    );
    await user.click(screen.getByTestId("refine-btn"));

    await waitFor(() =>
      expect(refineSpy).toHaveBeenCalledWith(
        "asset-1",
        "Add more sparkles",
        "v-1"
      )
    );
  });

  // -----------------------------------------------------------------------
  // 13. Version switching updates metadata (dimensions, file size)
  // -----------------------------------------------------------------------
  it("updates metadata when switching versions", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("asset-detail")).toBeInTheDocument()
    );

    // Initially shows v3 file size
    expect(screen.getByTestId("file-size")).toHaveTextContent("317.4 KB");

    // Switch to v1
    await user.click(screen.getByTestId("version-row-v-1"));

    // v1 has 290816 bytes = 284.0 KB
    expect(screen.getByTestId("file-size")).toHaveTextContent("284.0 KB");
  });

  // -----------------------------------------------------------------------
  // 14. Delete confirmation navigates to /assets on success
  // -----------------------------------------------------------------------
  it("navigates to /assets after successful delete", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );
    vi.spyOn(libraryAssetsApi, "deleteLibraryAsset").mockResolvedValue(
      undefined
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("actions-card")).toBeInTheDocument()
    );

    // Open delete dialog
    await user.click(screen.getByTestId("delete-btn"));
    expect(
      screen.getByTestId("confirm-delete-dialog")
    ).toBeInTheDocument();

    // Confirm delete
    await user.click(screen.getByTestId("confirm-delete-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("asset-library-page")).toBeInTheDocument()
    );
  });

  // -----------------------------------------------------------------------
  // 15. Use in Emailer button navigates to /brief
  // -----------------------------------------------------------------------
  it("use in emailer button navigates to /brief", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("actions-card")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("use-in-emailer-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("brief-page")).toBeInTheDocument()
    );
  });

  // -----------------------------------------------------------------------
  // 16. Refinement instructions shown in version history
  // -----------------------------------------------------------------------
  it("shows refinement instructions in version history rows", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    const v2Row = screen.getByTestId("version-row-v-2");
    expect(within(v2Row).getByText("Make the colors brighter")).toBeInTheDocument();

    const v3Row = screen.getByTestId("version-row-v-3");
    expect(within(v3Row).getByText("Add more sparkle effects")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 17. Regenerate button visible for generated assets (STORY-A2.3)
  // -----------------------------------------------------------------------
  it("shows Regenerate button for generated assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("actions-card")).toBeInTheDocument()
    );

    expect(screen.getByTestId("regenerate-btn")).toBeInTheDocument();
    expect(screen.getByTestId("regenerate-btn")).toHaveTextContent(
      "Regenerate"
    );
  });

  // -----------------------------------------------------------------------
  // 18. Regenerate button hidden for uploaded assets (STORY-A2.3)
  // -----------------------------------------------------------------------
  it("hides Regenerate button for uploaded assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_UPLOADED_ASSET
    );

    renderAssetDetailPage("asset-2");

    await waitFor(() =>
      expect(screen.getByTestId("actions-card")).toBeInTheDocument()
    );

    expect(screen.queryByTestId("regenerate-btn")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 19. Clicking Regenerate calls the API (STORY-A2.3)
  // -----------------------------------------------------------------------
  it("clicking Regenerate calls regenerateAsset API", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const regenerateSpy = vi
      .spyOn(libraryAssetsApi, "regenerateAsset")
      .mockResolvedValue({
        ...MOCK_GENERATED_ASSET,
        versions: [
          ...MOCK_GENERATED_ASSET.versions,
          {
            ...MOCK_VERSION_3,
            id: "v-4",
            version_number: 4,
            created_at: "2026-05-04T10:00:00Z",
          },
        ],
      });

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("regenerate-btn")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("regenerate-btn"));

    await waitFor(() =>
      expect(regenerateSpy).toHaveBeenCalledWith("asset-1", "v-3")
    );
  });

  // -----------------------------------------------------------------------
  // 20. Loading state shows during regeneration (STORY-A2.3)
  // -----------------------------------------------------------------------
  it("shows loading state during regeneration", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    // Create a promise that will not resolve immediately
    let resolveRegenerate!: (value: LibraryAssetDetailRead) => void;
    vi.spyOn(libraryAssetsApi, "regenerateAsset").mockReturnValue(
      new Promise((resolve) => {
        resolveRegenerate = resolve;
      })
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("regenerate-btn")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("regenerate-btn"));

    // Check loading state
    await waitFor(() =>
      expect(screen.getByTestId("regenerate-spinner")).toBeInTheDocument()
    );
    expect(screen.getByTestId("regenerate-btn")).toHaveTextContent(
      "Regenerating..."
    );
    expect(screen.getByTestId("regenerate-btn")).toBeDisabled();

    // Other action buttons should be disabled during regeneration
    expect(screen.getByTestId("use-in-emailer-btn")).toBeDisabled();
    expect(screen.getByTestId("download-btn")).toBeDisabled();
    expect(screen.getByTestId("delete-btn")).toBeDisabled();

    // Resolve to clean up
    resolveRegenerate(MOCK_GENERATED_ASSET);
  });

  // -----------------------------------------------------------------------
  // 21. Success refreshes the page data (STORY-A2.3)
  // -----------------------------------------------------------------------
  it("refreshes page data after successful regeneration", async () => {
    const NEW_VERSION: LibraryAssetVersionRead = {
      id: "v-4",
      version_number: 4,
      thumbnail_url: "http://localhost/thumbs/v4.png",
      storage_url: "http://localhost/images/v4.png",
      width: 600,
      height: 400,
      file_size_bytes: 340000,
      prompt_text: "A festive Diwali banner with warm colors",
      refinement_instruction: null,
      model_used: "gpt-image-1",
      cost_usd: 0.04,
      created_at: "2026-05-04T10:00:00Z",
    };

    const UPDATED_ASSET: LibraryAssetDetailRead = {
      ...MOCK_GENERATED_ASSET,
      primary_version: NEW_VERSION,
      versions: [...MOCK_GENERATED_ASSET.versions, NEW_VERSION],
    };

    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );
    vi.spyOn(libraryAssetsApi, "regenerateAsset").mockResolvedValue(
      UPDATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("regenerate-btn")).toBeInTheDocument()
    );

    // Initially shows v3 image
    expect(screen.getByTestId("preview-image")).toHaveAttribute(
      "src",
      "http://localhost/images/v3.png"
    );

    await user.click(screen.getByTestId("regenerate-btn"));

    // After success, shows v4 image (the new primary version)
    await waitFor(() =>
      expect(screen.getByTestId("preview-image")).toHaveAttribute(
        "src",
        "http://localhost/images/v4.png"
      )
    );

    // v4 row should exist in version history
    expect(screen.getByTestId("version-row-v-4")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 22. Regenerate error shows error message (STORY-A2.3)
  // -----------------------------------------------------------------------
  it("shows error message when regeneration fails", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );
    vi.spyOn(libraryAssetsApi, "regenerateAsset").mockRejectedValue(
      new Error("No prompt on source version")
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("regenerate-btn")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("regenerate-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("regenerate-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("regenerate-error")).toHaveTextContent(
      "No prompt on source version"
    );
  });

  // -----------------------------------------------------------------------
  // 23. Version history "Regenerate from this" links (STORY-A2.3)
  // -----------------------------------------------------------------------
  it("shows Regenerate from this links in version history for generated assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    // Each version should have a "Regenerate from this" link
    expect(
      screen.getByTestId("regenerate-version-v-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("regenerate-version-v-2")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("regenerate-version-v-3")
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 24. Version history hides regenerate links for uploaded assets (STORY-A2.3)
  // -----------------------------------------------------------------------
  it("hides Regenerate from this links for uploaded assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_UPLOADED_ASSET
    );

    renderAssetDetailPage("asset-2");

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    expect(
      screen.queryByTestId("regenerate-version-v-u1")
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 25. Clicking "Regenerate from this" on a version calls API (STORY-A2.3)
  // -----------------------------------------------------------------------
  it("Regenerate from this calls regenerateAsset with the version id", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const regenerateSpy = vi
      .spyOn(libraryAssetsApi, "regenerateAsset")
      .mockResolvedValue(MOCK_GENERATED_ASSET);

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    // Click "Regenerate from this" on v1
    await user.click(screen.getByTestId("regenerate-version-v-1"));

    await waitFor(() =>
      expect(regenerateSpy).toHaveBeenCalledWith("asset-1", "v-1")
    );
  });

  // -----------------------------------------------------------------------
  // 26. Edit & Regenerate button visible for generated assets (STORY-A3.3)
  // -----------------------------------------------------------------------
  it("shows Edit & Regenerate button for generated assets with prompt", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("prompt-card")).toBeInTheDocument()
    );

    expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument();
    expect(screen.getByTestId("edit-regenerate-btn")).toHaveTextContent(
      "Edit & Regenerate"
    );
  });

  // -----------------------------------------------------------------------
  // 27. Edit & Regenerate hidden for uploaded assets (STORY-A3.3)
  // -----------------------------------------------------------------------
  it("hides Edit & Regenerate button for uploaded assets", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_UPLOADED_ASSET
    );

    renderAssetDetailPage("asset-2");

    await waitFor(() =>
      expect(screen.getByTestId("asset-detail")).toBeInTheDocument()
    );

    expect(
      screen.queryByTestId("edit-regenerate-btn")
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 28. Clicking Edit & Regenerate opens editable textarea (STORY-A3.3)
  // -----------------------------------------------------------------------
  it("clicking Edit & Regenerate opens textarea pre-filled with prompt", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("edit-regenerate-btn"));

    // Textarea should appear pre-filled
    const textarea = screen.getByTestId("edit-prompt-textarea");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue(
      "A festive Diwali banner with warm colors"
    );

    // Submit button and cancel link should be visible
    expect(screen.getByTestId("edit-prompt-submit-btn")).toBeInTheDocument();
    expect(screen.getByTestId("edit-prompt-cancel-btn")).toBeInTheDocument();

    // Original blockquote should be gone
    expect(screen.getByTestId("edit-prompt-form")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 29. Cancel returns to read-only prompt view (STORY-A3.3)
  // -----------------------------------------------------------------------
  it("Cancel returns to read-only prompt view", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument()
    );

    // Open edit mode
    await user.click(screen.getByTestId("edit-regenerate-btn"));
    expect(screen.getByTestId("edit-prompt-textarea")).toBeInTheDocument();

    // Click cancel
    await user.click(screen.getByTestId("edit-prompt-cancel-btn"));

    // Should return to read-only
    expect(
      screen.queryByTestId("edit-prompt-textarea")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument();
    expect(
      screen.getByText("A festive Diwali banner with warm colors")
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 30. Generate button disabled when prompt < 10 chars (STORY-A3.3)
  // -----------------------------------------------------------------------
  it("Generate button disabled when edited prompt is less than 10 chars", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("edit-regenerate-btn"));

    const textarea = screen.getByTestId("edit-prompt-textarea");
    const submitBtn = screen.getByTestId("edit-prompt-submit-btn");

    // Clear and type short text
    await user.clear(textarea);
    await user.type(textarea, "short");
    expect(submitBtn).toBeDisabled();

    // Type enough to reach 10 chars
    await user.clear(textarea);
    await user.type(textarea, "a long enough prompt");
    expect(submitBtn).not.toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // 31. Generate with new prompt calls API (STORY-A3.3)
  // -----------------------------------------------------------------------
  it("clicking Generate with new prompt calls editPromptAndRegenerate API", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const editPromptSpy = vi
      .spyOn(libraryAssetsApi, "editPromptAndRegenerate")
      .mockResolvedValue(MOCK_GENERATED_ASSET);

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("edit-regenerate-btn"));

    const textarea = screen.getByTestId("edit-prompt-textarea");
    await user.clear(textarea);
    await user.type(textarea, "A modern banking banner with blue gradients");

    await user.click(screen.getByTestId("edit-prompt-submit-btn"));

    await waitFor(() =>
      expect(editPromptSpy).toHaveBeenCalledWith(
        "asset-1",
        "A modern banking banner with blue gradients",
        "v-3"
      )
    );
  });

  // -----------------------------------------------------------------------
  // 32. Loading state during edit prompt generation (STORY-A3.3)
  // -----------------------------------------------------------------------
  it("shows loading state during edit prompt generation", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    let resolveEditPrompt!: (value: LibraryAssetDetailRead) => void;
    vi.spyOn(libraryAssetsApi, "editPromptAndRegenerate").mockReturnValue(
      new Promise((resolve) => {
        resolveEditPrompt = resolve;
      })
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("edit-regenerate-btn"));

    const textarea = screen.getByTestId("edit-prompt-textarea");
    await user.clear(textarea);
    await user.type(textarea, "A brand new prompt for the banner");

    await user.click(screen.getByTestId("edit-prompt-submit-btn"));

    // Check loading state
    await waitFor(() =>
      expect(screen.getByTestId("edit-prompt-spinner")).toBeInTheDocument()
    );
    expect(screen.getByTestId("edit-prompt-submit-btn")).toHaveTextContent(
      "Generating..."
    );
    expect(screen.getByTestId("edit-prompt-submit-btn")).toBeDisabled();
    expect(screen.getByTestId("edit-prompt-textarea")).toBeDisabled();
    expect(screen.getByTestId("edit-prompt-cancel-btn")).toBeDisabled();

    // Resolve to clean up
    resolveEditPrompt(MOCK_GENERATED_ASSET);
  });

  // -----------------------------------------------------------------------
  // 33. Success after edit prompt refreshes data (STORY-A3.3)
  // -----------------------------------------------------------------------
  it("success after edit prompt regeneration updates version history", async () => {
    const NEW_VERSION: LibraryAssetVersionRead = {
      id: "v-edited",
      version_number: 4,
      thumbnail_url: "http://localhost/thumbs/v-edited.png",
      storage_url: "http://localhost/images/v-edited.png",
      width: 600,
      height: 400,
      file_size_bytes: 360000,
      prompt_text: "A modern banking banner with blue gradients",
      refinement_instruction: null,
      model_used: "gpt-image-1",
      cost_usd: 0.04,
      created_at: "2026-05-06T10:00:00Z",
    };

    const UPDATED_ASSET: LibraryAssetDetailRead = {
      ...MOCK_GENERATED_ASSET,
      primary_version: NEW_VERSION,
      versions: [...MOCK_GENERATED_ASSET.versions, NEW_VERSION],
    };

    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );
    vi.spyOn(libraryAssetsApi, "editPromptAndRegenerate").mockResolvedValue(
      UPDATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("edit-regenerate-btn"));

    const textarea = screen.getByTestId("edit-prompt-textarea");
    await user.clear(textarea);
    await user.type(textarea, "A modern banking banner with blue gradients");

    await user.click(screen.getByTestId("edit-prompt-submit-btn"));

    // After success, the new version should appear
    await waitFor(() =>
      expect(
        screen.getByTestId("version-row-v-edited")
      ).toBeInTheDocument()
    );

    // Image should update
    expect(screen.getByTestId("preview-image")).toHaveAttribute(
      "src",
      "http://localhost/images/v-edited.png"
    );

    // Should return to read-only mode
    expect(
      screen.queryByTestId("edit-prompt-textarea")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 34. Error shows inline message (STORY-A3.3)
  // -----------------------------------------------------------------------
  it("shows error message when edit prompt regeneration fails", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );
    vi.spyOn(libraryAssetsApi, "editPromptAndRegenerate").mockRejectedValue(
      new Error("Prompt too short")
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("edit-regenerate-btn")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("edit-regenerate-btn"));

    const textarea = screen.getByTestId("edit-prompt-textarea");
    await user.clear(textarea);
    await user.type(textarea, "A new prompt that will fail");

    await user.click(screen.getByTestId("edit-prompt-submit-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("edit-prompt-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("edit-prompt-error")).toHaveTextContent(
      "Prompt too short"
    );
  });

  // -----------------------------------------------------------------------
  // 35. "Set as primary" visible on non-primary versions (STORY-A3.2)
  // -----------------------------------------------------------------------
  it("shows Set as primary button on non-primary versions", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    // v-1 and v-2 are non-primary — should have "Set as primary"
    expect(screen.getByTestId("set-primary-v-1")).toBeInTheDocument();
    expect(screen.getByTestId("set-primary-v-1")).toHaveTextContent(
      "Set as primary"
    );
    expect(screen.getByTestId("set-primary-v-2")).toBeInTheDocument();
    expect(screen.getByTestId("set-primary-v-2")).toHaveTextContent(
      "Set as primary"
    );
  });

  // -----------------------------------------------------------------------
  // 36. "Set as primary" hidden on current primary version (STORY-A3.2)
  // -----------------------------------------------------------------------
  it("hides Set as primary button on the current primary version", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    // v-3 is the primary version — should NOT have "Set as primary"
    expect(
      screen.queryByTestId("set-primary-v-3")
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 37. Clicking "Set as primary" calls setPrimaryVersion API (STORY-A3.2)
  // -----------------------------------------------------------------------
  it("clicking Set as primary calls setPrimaryVersion API", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    const UPDATED_ASSET: LibraryAssetDetailRead = {
      ...MOCK_GENERATED_ASSET,
      primary_version: MOCK_VERSION_1,
    };

    const setPrimarySpy = vi
      .spyOn(libraryAssetsApi, "setPrimaryVersion")
      .mockResolvedValue(UPDATED_ASSET);

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("set-primary-v-1"));

    await waitFor(() =>
      expect(setPrimarySpy).toHaveBeenCalledWith("asset-1", "v-1")
    );
  });

  // -----------------------------------------------------------------------
  // 38. Success after set primary refreshes data (STORY-A3.2)
  // -----------------------------------------------------------------------
  it("refreshes data after successful set primary version", async () => {
    const UPDATED_ASSET: LibraryAssetDetailRead = {
      ...MOCK_GENERATED_ASSET,
      primary_version: MOCK_VERSION_1,
    };

    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );
    vi.spyOn(libraryAssetsApi, "setPrimaryVersion").mockResolvedValue(
      UPDATED_ASSET
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    // Initially v-3 is primary
    expect(screen.getByTestId("current-label-v-3")).toBeInTheDocument();

    await user.click(screen.getByTestId("set-primary-v-1"));

    // After success, v-1 should now be marked as current
    await waitFor(() =>
      expect(screen.getByTestId("current-label-v-1")).toBeInTheDocument()
    );

    // v-3 should no longer have current label
    expect(
      screen.queryByTestId("current-label-v-3")
    ).not.toBeInTheDocument();

    // Image should update to v-1
    expect(screen.getByTestId("preview-image")).toHaveAttribute(
      "src",
      "http://localhost/images/v1.png"
    );
  });

  // -----------------------------------------------------------------------
  // 39. Loading state during set primary (STORY-A3.2)
  // -----------------------------------------------------------------------
  it("shows loading state on Set as primary button while pending", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_GENERATED_ASSET
    );

    let resolveSetPrimary!: (value: LibraryAssetDetailRead) => void;
    vi.spyOn(libraryAssetsApi, "setPrimaryVersion").mockReturnValue(
      new Promise((resolve) => {
        resolveSetPrimary = resolve;
      })
    );

    const user = userEvent.setup();
    renderAssetDetailPage();

    await waitFor(() =>
      expect(screen.getByTestId("version-history-card")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("set-primary-v-1"));

    // Check loading state on the clicked button
    await waitFor(() =>
      expect(
        screen.getByTestId("set-primary-spinner-v-1")
      ).toBeInTheDocument()
    );
    expect(screen.getByTestId("set-primary-v-1")).toHaveTextContent(
      "Setting..."
    );
    expect(screen.getByTestId("set-primary-v-1")).toBeDisabled();

    // Other set-primary buttons should also be disabled
    expect(screen.getByTestId("set-primary-v-2")).toBeDisabled();

    // Resolve to clean up
    resolveSetPrimary(MOCK_GENERATED_ASSET);
  });
});
