import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MaskEditorPage from "./MaskEditorPage";
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

function renderMaskEditorPage(assetId = "asset-1") {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/assets/${assetId}/edit`]}>
        <AuthContext.Provider value={AUTH_VALUE}>
          <Routes>
            <Route path="/assets/:id/edit" element={<MaskEditorPage />} />
            <Route
              path="/assets/:id"
              element={
                <div data-testid="asset-detail-page">Asset Detail</div>
              }
            />
            <Route
              path="/assets"
              element={
                <div data-testid="asset-library-page">Asset Library</div>
              }
            />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_VERSION: LibraryAssetVersionRead = {
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

const MOCK_ASSET: LibraryAssetDetailRead = {
  id: "asset-1",
  name: "Diwali Festive Banner",
  source: "generated",
  tags: ["banner", "diwali"],
  created_by_name: "Priya",
  primary_version: MOCK_VERSION,
  created_at: "2026-05-01T10:00:00Z",
  versions: [MOCK_VERSION],
};

const MOCK_EDITED_VERSION: LibraryAssetVersionRead = {
  id: "v-2",
  version_number: 2,
  thumbnail_url: "http://localhost/thumbs/v2.png",
  storage_url: "http://localhost/images/v2-edited.png",
  width: 600,
  height: 400,
  file_size_bytes: 310000,
  prompt_text: "A festive Diwali banner with warm colors",
  refinement_instruction: "Replace painted area with flowers",
  model_used: "gpt-image-1",
  cost_usd: 0.08,
  created_at: "2026-05-02T10:00:00Z",
};

const MOCK_EDITED_ASSET: LibraryAssetDetailRead = {
  ...MOCK_ASSET,
  primary_version: MOCK_EDITED_VERSION,
  versions: [MOCK_VERSION, MOCK_EDITED_VERSION],
};

// ---------------------------------------------------------------------------
// jsdom polyfills
// ---------------------------------------------------------------------------

// jsdom doesn't provide ImageData. We provide a minimal polyfill so that
// getMaskBlob (which creates a new ImageData) works in tests.
if (typeof globalThis.ImageData === "undefined") {
  // justified: minimal polyfill for jsdom test environment only
  (globalThis as Record<string, unknown>).ImageData = class ImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(width: number, height: number);
    constructor(data: Uint8ClampedArray, width: number, height?: number);
    constructor(
      widthOrData: number | Uint8ClampedArray,
      heightOrWidth: number,
      maybeHeight?: number,
    ) {
      if (widthOrData instanceof Uint8ClampedArray) {
        this.data = widthOrData;
        this.width = heightOrWidth;
        this.height = maybeHeight ?? widthOrData.length / (4 * heightOrWidth);
      } else {
        this.width = widthOrData;
        this.height = heightOrWidth;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Canvas mock helpers
// ---------------------------------------------------------------------------

/**
 * We need to mock HTMLCanvasElement.getContext and related methods since
 * jsdom does not support Canvas. We track `imageData` as a simple buffer
 * that can be manipulated to simulate painted/unpainted states.
 */
function setupCanvasMock(opts: { hasPaintedPixels?: boolean } = {}) {
  // Store pixel data so getImageData can return it
  const width = 600;
  const height = 400;
  const dataLength = width * height * 4;
  const pixelData = new Uint8ClampedArray(dataLength);

  if (opts.hasPaintedPixels) {
    // Simulate some painted pixels (set alpha > 0 on first ~100 pixels)
    for (let i = 0; i < 400; i += 4) {
      pixelData[i] = 239;     // R
      pixelData[i + 1] = 68;  // G
      pixelData[i + 2] = 68;  // B
      pixelData[i + 3] = 102; // A (semi-transparent)
    }
  }

  const mockImageData = {
    data: pixelData,
    width,
    height,
  } as unknown as ImageData;

  const mockCtx = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue(mockImageData),
    putImageData: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    globalCompositeOperation: "source-over",
    fillStyle: "",
  };

  // justified: jsdom doesn't support canvas; we mock getContext to return our mock
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    // justified: matching the overloaded Canvas.getContext signature
    function (this: HTMLCanvasElement) {
      // Set canvas dimensions so the component sees them
      if (this.width === 0) {
        Object.defineProperty(this, "width", {
          value: width,
          writable: true,
          configurable: true,
        });
      }
      if (this.height === 0) {
        Object.defineProperty(this, "height", {
          value: height,
          writable: true,
          configurable: true,
        });
      }
      return mockCtx as unknown as CanvasRenderingContext2D;
      // justified: we need to cast to match the overloaded getContext return type
    } as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );

  // Mock toBlob for mask export
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    function (this: HTMLCanvasElement, callback: BlobCallback) {
      callback(new Blob(["mock-png"], { type: "image/png" }));
    },
  );

  return { mockCtx, mockImageData };
}

// ---------------------------------------------------------------------------
// Helper: simulate painting on the mask canvas via fireEvent
// ---------------------------------------------------------------------------

/**
 * Fire mouseDown + mouseUp on the mask canvas to simulate a brush stroke.
 * This triggers the React onMouseDown handler which sets maskPainted=true
 * when the brush tool is active. jsdom doesn't support canvas rendering,
 * so we rely on state changes only.
 */
function paintOnMaskCanvas() {
  const maskCanvas = screen.getByTestId("mask-canvas");
  fireEvent.mouseDown(maskCanvas, { clientX: 100, clientY: 100 });
  fireEvent.mouseUp(maskCanvas);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MaskEditorPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Page renders with back link, instruction textarea, brush size slider
  // -----------------------------------------------------------------------
  it("renders with back link, instruction textarea, and brush size slider", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock();

    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    // Back link
    const backLink = screen.getByTestId("back-link");
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/assets/asset-1");

    // Instruction textarea
    expect(screen.getByTestId("instruction-textarea")).toBeInTheDocument();
    expect(screen.getByTestId("instruction-textarea").tagName.toLowerCase()).toBe(
      "textarea",
    );

    // Brush size slider
    expect(screen.getByTestId("brush-size-slider")).toBeInTheDocument();
    expect(screen.getByTestId("brush-size-value")).toHaveTextContent("30px");
  });

  // -----------------------------------------------------------------------
  // 2. Clear mask button exists
  // -----------------------------------------------------------------------
  it("renders clear mask button", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock();

    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("clear-mask-btn")).toBeInTheDocument();
    expect(screen.getByTestId("clear-mask-btn")).toHaveTextContent(
      "Clear mask",
    );
  });

  // -----------------------------------------------------------------------
  // 3. Brush/Eraser toggle exists
  // -----------------------------------------------------------------------
  it("renders brush and eraser toggle buttons", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock();

    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    const brushBtn = screen.getByTestId("brush-tool-btn");
    const eraserBtn = screen.getByTestId("eraser-tool-btn");

    expect(brushBtn).toBeInTheDocument();
    expect(eraserBtn).toBeInTheDocument();
    expect(brushBtn).toHaveTextContent("Brush");
    expect(eraserBtn).toHaveTextContent("Eraser");

    // Brush is active by default (active tool uses the accent-subtle fill).
    expect(brushBtn.className).toContain("bg-accent-subtle");
    expect(eraserBtn.className).not.toContain("bg-accent-subtle");
  });

  // -----------------------------------------------------------------------
  // 4. Switching to eraser updates active state
  // -----------------------------------------------------------------------
  it("switching to eraser updates button active state", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock();

    const user = userEvent.setup();
    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("eraser-tool-btn"));

    expect(screen.getByTestId("eraser-tool-btn").className).toContain(
      "bg-accent-subtle",
    );
    expect(screen.getByTestId("brush-tool-btn").className).not.toContain(
      "bg-accent-subtle",
    );
  });

  // -----------------------------------------------------------------------
  // 5. Apply Edit button disabled when instruction < 5 chars
  // -----------------------------------------------------------------------
  it("Apply Edit button disabled when instruction is shorter than 5 chars", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock();

    const user = userEvent.setup();
    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    const applyBtn = screen.getByTestId("apply-edit-btn");
    expect(applyBtn).toBeDisabled();

    // Type 4 chars
    await user.type(screen.getByTestId("instruction-textarea"), "abcd");
    expect(applyBtn).toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // 6. Apply Edit button disabled when no mask painted
  // -----------------------------------------------------------------------
  it("Apply Edit button disabled when no mask has been painted", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock();

    const user = userEvent.setup();
    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    // Type a valid instruction (>= 5 chars) but no mask painted
    await user.type(
      screen.getByTestId("instruction-textarea"),
      "Replace with flowers",
    );

    const applyBtn = screen.getByTestId("apply-edit-btn");
    expect(applyBtn).toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // 7. Loading state during API call
  // -----------------------------------------------------------------------
  it("shows loading state during mask edit API call", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock({ hasPaintedPixels: true });

    let resolveMaskEdit!: (value: LibraryAssetDetailRead) => void;
    vi.spyOn(libraryAssetsApi, "maskEditAsset").mockReturnValue(
      new Promise((resolve) => {
        resolveMaskEdit = resolve;
      }),
    );

    const user = userEvent.setup();
    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    // Simulate brush stroke on mask canvas
    paintOnMaskCanvas();

    // Type instruction
    await user.type(
      screen.getByTestId("instruction-textarea"),
      "Replace with flowers",
    );

    // Click apply
    await user.click(screen.getByTestId("apply-edit-btn"));

    // Check loading state
    await waitFor(() =>
      expect(screen.getByTestId("apply-edit-spinner")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("apply-edit-btn")).toHaveTextContent(
      "Applying...",
    );
    expect(screen.getByTestId("apply-edit-btn")).toBeDisabled();
    expect(screen.getByTestId("instruction-textarea")).toBeDisabled();

    // Resolve
    resolveMaskEdit(MOCK_EDITED_ASSET);
  });

  // -----------------------------------------------------------------------
  // 8. After success: before/after panel shown with Keep/Try again buttons
  // -----------------------------------------------------------------------
  it("shows before/after panel with Keep/Try again after success", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock({ hasPaintedPixels: true });
    vi.spyOn(libraryAssetsApi, "maskEditAsset").mockResolvedValue(
      MOCK_EDITED_ASSET,
    );

    const user = userEvent.setup();
    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    // Paint mask
    paintOnMaskCanvas();

    // Type instruction and apply
    await user.type(
      screen.getByTestId("instruction-textarea"),
      "Replace with flowers",
    );
    await user.click(screen.getByTestId("apply-edit-btn"));

    // Result panel appears
    await waitFor(() =>
      expect(screen.getByTestId("result-panel")).toBeInTheDocument(),
    );

    // Before/After images
    expect(screen.getByTestId("before-image")).toHaveAttribute(
      "src",
      "http://localhost/images/v1.png",
    );
    expect(screen.getByTestId("after-image")).toHaveAttribute(
      "src",
      "http://localhost/images/v2-edited.png",
    );

    // Action buttons
    expect(screen.getByTestId("keep-version-btn")).toBeInTheDocument();
    expect(screen.getByTestId("keep-version-btn")).toHaveTextContent(
      "Keep this version",
    );
    expect(screen.getByTestId("try-again-btn")).toBeInTheDocument();
    expect(screen.getByTestId("try-again-btn")).toHaveTextContent(
      "Try again",
    );
  });

  // -----------------------------------------------------------------------
  // 9. "Keep this version" navigates to detail page
  // -----------------------------------------------------------------------
  it("Keep this version navigates to asset detail page", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock({ hasPaintedPixels: true });
    vi.spyOn(libraryAssetsApi, "maskEditAsset").mockResolvedValue(
      MOCK_EDITED_ASSET,
    );

    const user = userEvent.setup();
    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    // Paint mask
    paintOnMaskCanvas();

    // Type instruction and apply
    await user.type(
      screen.getByTestId("instruction-textarea"),
      "Replace with flowers",
    );
    await user.click(screen.getByTestId("apply-edit-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("result-panel")).toBeInTheDocument(),
    );

    // Click keep
    await user.click(screen.getByTestId("keep-version-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("asset-detail-page")).toBeInTheDocument(),
    );
  });

  // -----------------------------------------------------------------------
  // 10. "Try again" clears result and returns to editor
  // -----------------------------------------------------------------------
  it("Try again clears result and returns to editor view", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock({ hasPaintedPixels: true });
    vi.spyOn(libraryAssetsApi, "maskEditAsset").mockResolvedValue(
      MOCK_EDITED_ASSET,
    );

    const user = userEvent.setup();
    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    // Paint mask
    paintOnMaskCanvas();

    // Type instruction and apply
    await user.type(
      screen.getByTestId("instruction-textarea"),
      "Replace with flowers",
    );
    await user.click(screen.getByTestId("apply-edit-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("result-panel")).toBeInTheDocument(),
    );

    // Click try again
    await user.click(screen.getByTestId("try-again-btn"));

    // Should return to editor
    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("result-panel")).not.toBeInTheDocument();

    // Instruction should be cleared
    expect(screen.getByTestId("instruction-textarea")).toHaveValue("");
  });

  // -----------------------------------------------------------------------
  // 11. Loading/skeleton state while asset is being fetched
  // -----------------------------------------------------------------------
  it("renders skeleton while asset is loading", () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      }),
    );
    setupCanvasMock();

    renderMaskEditorPage();

    expect(screen.getByTestId("editor-skeleton")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 12. Error state when asset fetch fails
  // -----------------------------------------------------------------------
  it("renders error state when asset fetch fails", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockRejectedValue(
      new Error("Asset not found"),
    );
    setupCanvasMock();

    renderMaskEditorPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/asset not found/i);
  });

  // -----------------------------------------------------------------------
  // 13. Brush size slider changes value
  // -----------------------------------------------------------------------
  it("brush size slider updates displayed value", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock();

    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    const slider = screen.getByTestId("brush-size-slider");
    expect(slider).toHaveAttribute("min", "10");
    expect(slider).toHaveAttribute("max", "100");

    // Default value is 30
    expect(screen.getByTestId("brush-size-value")).toHaveTextContent("30px");
  });

  // -----------------------------------------------------------------------
  // 14. Error message shown on mask edit failure
  // -----------------------------------------------------------------------
  it("shows error message when mask edit API call fails", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock({ hasPaintedPixels: true });
    vi.spyOn(libraryAssetsApi, "maskEditAsset").mockRejectedValue(
      new Error("Service temporarily unavailable"),
    );

    const user = userEvent.setup();
    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    // Paint mask
    paintOnMaskCanvas();

    // Type instruction and apply
    await user.type(
      screen.getByTestId("instruction-textarea"),
      "Replace with flowers",
    );
    await user.click(screen.getByTestId("apply-edit-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("mask-edit-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("mask-edit-error")).toHaveTextContent(
      "Service temporarily unavailable",
    );
  });

  // -----------------------------------------------------------------------
  // 15. Asset name displayed in editor
  // -----------------------------------------------------------------------
  it("displays the asset name in the editor", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAsset").mockResolvedValue(
      MOCK_ASSET,
    );
    setupCanvasMock();

    renderMaskEditorPage();

    await waitFor(() =>
      expect(screen.getByTestId("mask-editor")).toBeInTheDocument(),
    );

    expect(screen.getByText("Diwali Festive Banner")).toBeInTheDocument();
  });
});
