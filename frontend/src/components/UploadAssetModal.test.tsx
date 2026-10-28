import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UploadAssetModal from "./UploadAssetModal";
import type { UploadAssetModalProps } from "./UploadAssetModal";
import type { LibraryAssetDetailRead } from "../api/libraryAssets";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUploadLibraryAsset = vi.fn();

vi.mock("../api/libraryAssets", () => ({
  uploadLibraryAsset: (...args: unknown[]) => mockUploadLibraryAsset(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

const defaultProps: UploadAssetModalProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

function renderModal(props: Partial<UploadAssetModalProps> = {}) {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <UploadAssetModal {...defaultProps} {...props} />
    </QueryClientProvider>,
  );
}

const MOCK_ASSET: LibraryAssetDetailRead = {
  id: "asset-upload-1",
  name: "Uploaded Banner",
  source: "uploaded",
  tags: ["banner", "festive"],
  created_by_name: "Test User",
  primary_version: {
    id: "ver-1",
    version_number: 1,
    thumbnail_url: "http://example.com/thumb.png",
    storage_url: "http://example.com/full.png",
    width: 600,
    height: 400,
    file_size_bytes: 102400,
    prompt_text: null,
    refinement_instruction: null,
    model_used: null,
    cost_usd: null,
    created_at: "2026-05-06T00:00:00Z",
  },
  versions: [],
  created_at: "2026-05-06T00:00:00Z",
};

function createFile(
  name: string,
  sizeBytes: number,
  type: string,
): File {
  const content = new Uint8Array(Math.min(sizeBytes, 64)); // Only need a token payload
  const file = new File([content], name, { type });
  // Override size if needed for testing large files
  if (sizeBytes > 64) {
    Object.defineProperty(file, "size", {
      value: sizeBytes,
      writable: false,
    });
  }
  return file;
}

// Mock URL.createObjectURL / revokeObjectURL globally so they survive React
// async cleanup (useEffect teardowns that fire after the test).
// We assign once and never restore — jsdom doesn't provide real impls anyway.
URL.createObjectURL = vi.fn(() => "blob:http://localhost/fake-preview");
URL.revokeObjectURL = vi.fn();

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockUploadLibraryAsset.mockReset();
  (defaultProps.onClose as ReturnType<typeof vi.fn>).mockReset();
  (defaultProps.onSuccess as ReturnType<typeof vi.fn>).mockReset();
  (URL.createObjectURL as ReturnType<typeof vi.fn>).mockClear();
  (URL.revokeObjectURL as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UploadAssetModal", () => {
  it("renders the modal when isOpen is true", () => {
    renderModal();
    expect(screen.getByTestId("upload-modal")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Upload Asset" }),
    ).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByTestId("upload-modal")).not.toBeInTheDocument();
  });

  it("has a file drop zone", () => {
    renderModal();
    expect(screen.getByTestId("upload-drop-zone")).toBeInTheDocument();
    expect(
      screen.getByText(/Drag & drop an image here/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/PNG, JPEG, WebP, GIF, SVG/),
    ).toBeInTheDocument();
  });

  it("calls onClose when the X button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal({ onClose });

    await user.click(screen.getByTestId("upload-modal-close-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the backdrop", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal({ onClose });

    await user.click(screen.getByTestId("upload-modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // File selection and preview
  // ---------------------------------------------------------------------------

  describe("file selection", () => {
    it("shows preview and pre-fills name when a file is selected via picker", async () => {
      renderModal();

      const file = createFile("holiday-banner.png", 1024, "image/png");
      const input = screen.getByTestId("upload-file-input");
      await userEvent.upload(input, file);

      // Preview should be visible
      expect(screen.getByTestId("upload-file-preview")).toBeInTheDocument();
      expect(screen.getByTestId("upload-thumbnail")).toBeInTheDocument();
      expect(screen.getByTestId("upload-filename")).toHaveTextContent(
        "holiday-banner.png",
      );

      // Name pre-filled without extension
      expect(screen.getByTestId("upload-name-input")).toHaveValue(
        "holiday-banner",
      );
    });

    it("shows preview when a file is dropped", () => {
      renderModal();

      const file = createFile("dropped-image.jpeg", 2048, "image/jpeg");
      const dropZone = screen.getByTestId("upload-drop-zone");

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
        },
      });

      expect(screen.getByTestId("upload-file-preview")).toBeInTheDocument();
      expect(screen.getByTestId("upload-filename")).toHaveTextContent(
        "dropped-image.jpeg",
      );
    });

    it("removes the file when the remove button is clicked", async () => {
      const user = userEvent.setup();
      renderModal();

      const file = createFile("test.png", 1024, "image/png");
      const input = screen.getByTestId("upload-file-input");
      await userEvent.upload(input, file);

      expect(screen.getByTestId("upload-file-preview")).toBeInTheDocument();

      await user.click(screen.getByTestId("upload-remove-file"));

      // Drop zone should be back
      expect(screen.getByTestId("upload-drop-zone")).toBeInTheDocument();
      expect(
        screen.queryByTestId("upload-file-preview"),
      ).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Client-side validation
  // ---------------------------------------------------------------------------

  describe("client-side validation", () => {
    it("shows error when no file is selected on submit", async () => {
      const user = userEvent.setup();
      renderModal();

      // Set name but do not select a file
      await user.type(screen.getByTestId("upload-name-input"), "My Asset");
      await user.click(screen.getByTestId("upload-submit-btn"));

      expect(screen.getByTestId("file-error")).toHaveTextContent(
        "Please select a file to upload.",
      );
      expect(mockUploadLibraryAsset).not.toHaveBeenCalled();
    });

    it("shows error when name is empty on submit", async () => {
      renderModal();

      // Select a file
      const file = createFile("test.png", 1024, "image/png");
      const input = screen.getByTestId("upload-file-input");
      await userEvent.upload(input, file);

      // Clear the pre-filled name
      const nameInput = screen.getByTestId("upload-name-input");
      await userEvent.clear(nameInput);

      await userEvent.click(screen.getByTestId("upload-submit-btn"));

      expect(screen.getByTestId("upload-name-error")).toHaveTextContent(
        "Asset name is required.",
      );
      expect(mockUploadLibraryAsset).not.toHaveBeenCalled();
    });

    it("shows error when file is too large (>50 MB)", async () => {
      renderModal();

      const bigFile = createFile(
        "huge.png",
        51 * 1024 * 1024, // 51 MB
        "image/png",
      );
      const input = screen.getByTestId("upload-file-input");
      await userEvent.upload(input, bigFile);

      expect(screen.getByTestId("file-error")).toHaveTextContent(
        /too large/i,
      );
      // The drop zone should still be visible (file was rejected)
      expect(screen.getByTestId("upload-drop-zone")).toBeInTheDocument();
    });

    it("shows error when file has invalid MIME type", () => {
      renderModal();

      const badFile = createFile("doc.pdf", 1024, "application/pdf");
      // Drop the file instead of using the file picker, because
      // userEvent.upload respects the `accept` attribute and silently
      // filters out non-matching files in jsdom.
      const dropZone = screen.getByTestId("upload-drop-zone");
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [badFile] },
      });

      expect(screen.getByTestId("file-error")).toHaveTextContent(
        /Invalid file type/i,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Submit behavior
  // ---------------------------------------------------------------------------

  describe("submission", () => {
    it("disables the submit button during upload", async () => {
      // Make upload never resolve during this test
      mockUploadLibraryAsset.mockReturnValue(new Promise(() => {}));
      renderModal();

      const file = createFile("banner.png", 1024, "image/png");
      const input = screen.getByTestId("upload-file-input");
      await userEvent.upload(input, file);

      await userEvent.click(screen.getByTestId("upload-submit-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("upload-submit-btn")).toBeDisabled();
      });
      expect(screen.getByTestId("upload-loading")).toBeInTheDocument();
    });

    it("calls onSuccess on successful upload", async () => {
      mockUploadLibraryAsset.mockResolvedValue(MOCK_ASSET);
      const onSuccess = vi.fn();
      renderModal({ onSuccess });

      const file = createFile("banner.png", 1024, "image/png");
      const input = screen.getByTestId("upload-file-input");
      await userEvent.upload(input, file);

      // Fill tags
      await userEvent.type(
        screen.getByTestId("upload-tags-input"),
        "banner, festive",
      );

      await userEvent.click(screen.getByTestId("upload-submit-btn"));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(MOCK_ASSET);
      });

      // Verify the API was called with correct arguments
      expect(mockUploadLibraryAsset).toHaveBeenCalledWith(
        file,
        "banner",
        ["banner", "festive"],
      );
    });

    it("shows error message on API failure", async () => {
      mockUploadLibraryAsset.mockRejectedValue(
        new Error("File type not allowed"),
      );
      renderModal();

      const file = createFile("banner.png", 1024, "image/png");
      const input = screen.getByTestId("upload-file-input");
      await userEvent.upload(input, file);

      await userEvent.click(screen.getByTestId("upload-submit-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("upload-error")).toBeInTheDocument();
      });
      expect(screen.getByTestId("upload-error")).toHaveTextContent(
        "File type not allowed",
      );
    });

    it("sends tags as undefined when tags input is empty", async () => {
      mockUploadLibraryAsset.mockResolvedValue(MOCK_ASSET);
      const onSuccess = vi.fn();
      renderModal({ onSuccess });

      const file = createFile("icon.svg", 512, "image/svg+xml");
      const input = screen.getByTestId("upload-file-input");
      await userEvent.upload(input, file);

      await userEvent.click(screen.getByTestId("upload-submit-btn"));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
      });

      expect(mockUploadLibraryAsset).toHaveBeenCalledWith(
        file,
        "icon",
        undefined,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Drag highlight
  // ---------------------------------------------------------------------------

  describe("drag-and-drop zone highlighting", () => {
    it("highlights the drop zone on drag enter", () => {
      renderModal();

      const dropZone = screen.getByTestId("upload-drop-zone");
      fireEvent.dragEnter(dropZone, {
        dataTransfer: { files: [] },
      });

      // Should have the accent highlight classes (DESIGN.md tokens)
      expect(dropZone).toHaveClass("border-accent");
      expect(dropZone).toHaveClass("bg-accent-subtle");
    });

    it("removes highlight on drag leave", () => {
      renderModal();

      const dropZone = screen.getByTestId("upload-drop-zone");
      fireEvent.dragEnter(dropZone, {
        dataTransfer: { files: [] },
      });
      fireEvent.dragLeave(dropZone, {
        dataTransfer: { files: [] },
      });

      expect(dropZone).not.toHaveClass("border-accent");
    });
  });
});
