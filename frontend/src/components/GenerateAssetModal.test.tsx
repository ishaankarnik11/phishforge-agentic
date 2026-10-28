import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GenerateAssetModal from "./GenerateAssetModal";
import type { GenerateAssetModalProps } from "./GenerateAssetModal";
import type { LibraryAssetDetailRead } from "../api/libraryAssets";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGenerateAsset = vi.fn();
const mockGenerateAssetWithRefs = vi.fn();

vi.mock("../api/libraryAssets", () => ({
  generateAsset: (...args: unknown[]) => mockGenerateAsset(...args),
  generateAssetWithRefs: (...args: unknown[]) =>
    mockGenerateAssetWithRefs(...args),
}));

// Mock URL.createObjectURL / revokeObjectURL for thumbnail rendering
const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();
globalThis.URL.createObjectURL = mockCreateObjectURL;
globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

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

const defaultProps: GenerateAssetModalProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

function renderModal(props: Partial<GenerateAssetModalProps> = {}) {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <GenerateAssetModal {...defaultProps} {...props} />
    </QueryClientProvider>
  );
}

const MOCK_ASSET: LibraryAssetDetailRead = {
  id: "asset-123",
  name: "Test Asset",
  source: "generated",
  tags: ["banner"],
  created_by_name: "Test User",
  primary_version: {
    id: "ver-1",
    version_number: 1,
    thumbnail_url: null,
    storage_url: null,
    width: 608,
    height: 208,
    file_size_bytes: null,
    prompt_text: "test prompt for generation",
    refinement_instruction: null,
    model_used: "gpt-image-2",
    cost_usd: 0.04,
    created_at: "2026-05-06T00:00:00Z",
  },
  versions: [],
  created_at: "2026-05-06T00:00:00Z",
};

/** Create a mock File with the given name, size, and MIME type. */
function createMockFile(
  name: string,
  sizeBytes: number,
  type: string
): File {
  const content = new Uint8Array(Math.min(sizeBytes, 64)); // small buffer; size is overridden
  const file = new File([content], name, { type });
  // Override size since our small buffer won't match
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

/** Fill the required fields (name + prompt) so the form passes validation. */
async function fillRequiredFields(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.type(screen.getByTestId("asset-name-input"), "Test Banner");
  await user.type(
    screen.getByTestId("asset-prompt-input"),
    "A professional email banner for testing"
  );
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockGenerateAsset.mockReset();
  mockGenerateAssetWithRefs.mockReset();
  mockCreateObjectURL.mockClear();
  mockRevokeObjectURL.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GenerateAssetModal", () => {
  it("renders the modal when isOpen is true", () => {
    renderModal();
    expect(screen.getByTestId("generate-modal")).toBeInTheDocument();
    expect(screen.getByText("Generate New Asset")).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByTestId("generate-modal")).not.toBeInTheDocument();
  });

  it("calls onClose when the X button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderModal({ onClose });

    await user.click(screen.getByTestId("modal-close-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the backdrop", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderModal({ onClose });

    await user.click(screen.getByTestId("generate-modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Form validation
  // ---------------------------------------------------------------------------

  describe("form validation", () => {
    it("shows error when name is empty on submit", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      // Fill only prompt (long enough)
      await user.type(
        screen.getByTestId("asset-prompt-input"),
        "A beautiful banner for Acme credit card rewards"
      );
      await user.click(screen.getByTestId("generate-submit-btn"));

      expect(screen.getByTestId("name-error")).toHaveTextContent(
        "Asset name is required"
      );
      expect(mockGenerateAsset).not.toHaveBeenCalled();
    });

    it("shows error when prompt is too short", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      await user.type(screen.getByTestId("asset-name-input"), "My Banner");
      await user.type(screen.getByTestId("asset-prompt-input"), "short");
      await user.click(screen.getByTestId("generate-submit-btn"));

      expect(screen.getByTestId("prompt-error")).toHaveTextContent(
        "Prompt must be at least 10 characters"
      );
      expect(mockGenerateAsset).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Style preset selection
  // ---------------------------------------------------------------------------

  describe("style preset selection", () => {
    it("selects a style chip and shows it as active", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      const chip = screen.getByTestId("style-visual-corporate-clean");
      // Initially not selected (no blue border class)
      expect(chip).toHaveClass("border-border-default");

      await user.click(chip);
      expect(chip).toHaveClass("border-accent-border");
    });

    it("deselects a chip when clicked again", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      const chip = screen.getByTestId("style-visual-corporate-clean");
      await user.click(chip);
      expect(chip).toHaveClass("border-accent-border");

      await user.click(chip);
      expect(chip).toHaveClass("border-border-default");
    });

    it("replaces selection when clicking a different chip in the same row", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      const corporate = screen.getByTestId("style-visual-corporate-clean");
      const photorealistic = screen.getByTestId("style-visual-photorealistic");

      await user.click(corporate);
      expect(corporate).toHaveClass("border-accent-border");

      await user.click(photorealistic);
      expect(photorealistic).toHaveClass("border-accent-border");
      expect(corporate).toHaveClass("border-border-default");
    });
  });

  // ---------------------------------------------------------------------------
  // Dimension preset selection
  // ---------------------------------------------------------------------------

  describe("dimension selection", () => {
    it("shows output dimensions based on default preset", () => {
      renderModal();
      expect(screen.getByText("Output: 1024 x 1024 px")).toBeInTheDocument();
    });

    it("changes dimensions when a different preset is selected", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      await user.selectOptions(screen.getByTestId("dimension-select"), "2");
      expect(screen.getByText("Output: 1024 x 1536 px")).toBeInTheDocument();
    });

    it("shows custom width/ratio controls when Custom is selected", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      await user.selectOptions(screen.getByTestId("dimension-select"), "3");
      expect(screen.getByTestId("custom-width-input")).toBeInTheDocument();
      expect(screen.getByTestId("custom-ratio-select")).toBeInTheDocument();
      expect(screen.getByTestId("custom-height-display")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Submit + loading state
  // ---------------------------------------------------------------------------

  describe("submission", () => {
    it("disables the submit button during loading", async () => {
      // Make generateAsset never resolve during this test
      mockGenerateAsset.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      await user.type(screen.getByTestId("asset-name-input"), "Test Banner");
      await user.type(
        screen.getByTestId("asset-prompt-input"),
        "A professional email banner for testing"
      );
      await user.click(screen.getByTestId("generate-submit-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("generate-submit-btn")).toBeDisabled();
      });
      expect(screen.getByTestId("generate-loading")).toBeInTheDocument();
    });

    it("calls onSuccess and invalidates queries on successful generation", async () => {
      mockGenerateAsset.mockResolvedValue(MOCK_ASSET);
      const onSuccess = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal({ onSuccess });

      await user.type(screen.getByTestId("asset-name-input"), "Test Banner");
      await user.type(
        screen.getByTestId("asset-prompt-input"),
        "A professional email banner for testing"
      );
      await user.click(screen.getByTestId("generate-submit-btn"));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(MOCK_ASSET);
      });
    });

    it("shows error message on API failure", async () => {
      mockGenerateAsset.mockRejectedValue(
        new Error("Content policy violation")
      );
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      await user.type(screen.getByTestId("asset-name-input"), "Test Banner");
      await user.type(
        screen.getByTestId("asset-prompt-input"),
        "A professional email banner for testing"
      );
      await user.click(screen.getByTestId("generate-submit-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("generate-error")).toBeInTheDocument();
      });
      expect(screen.getByTestId("generate-error")).toHaveTextContent(
        "Content policy violation"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Reference images
  // ---------------------------------------------------------------------------

  describe("reference images", () => {
    it("renders the reference drop zone as functional (not disabled)", () => {
      renderModal();
      const dropZone = screen.getByTestId("reference-drop-zone");
      expect(dropZone).toBeInTheDocument();
      expect(dropZone).toHaveAttribute("role", "button");
      // Should not contain "(coming soon)" text
      expect(dropZone).not.toHaveTextContent("coming soon");
    });

    it("adds files via the hidden file input", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      const fileInput = screen.getByTestId("reference-file-input");
      const file1 = createMockFile("ref1.png", 1024, "image/png");
      const file2 = createMockFile("ref2.jpg", 2048, "image/jpeg");

      await user.upload(fileInput, [file1, file2]);

      // Thumbnails should appear
      expect(screen.getByTestId("reference-thumbnail-0")).toBeInTheDocument();
      expect(screen.getByTestId("reference-thumbnail-1")).toBeInTheDocument();
      // File count text
      expect(screen.getByTestId("reference-file-count")).toHaveTextContent(
        "2 of 16 reference images"
      );
    });

    it("displays thumbnails for selected files", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      const fileInput = screen.getByTestId("reference-file-input");
      const file = createMockFile("thumb-test.png", 512, "image/png");
      await user.upload(fileInput, file);

      const thumbnail = screen.getByTestId("reference-thumbnail-0");
      expect(thumbnail).toBeInTheDocument();
      // Should contain an img element
      const img = within(thumbnail).getByRole("img");
      expect(img).toHaveAttribute("alt", "thumb-test.png");
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });

    it("removes a file when the remove button is clicked", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      const fileInput = screen.getByTestId("reference-file-input");
      const file1 = createMockFile("keep.png", 512, "image/png");
      const file2 = createMockFile("remove.png", 512, "image/png");
      await user.upload(fileInput, [file1, file2]);

      expect(screen.getByTestId("reference-thumbnail-0")).toBeInTheDocument();
      expect(screen.getByTestId("reference-thumbnail-1")).toBeInTheDocument();

      // Remove the second file
      await user.click(screen.getByTestId("reference-remove-1"));

      // Only one thumbnail should remain
      expect(screen.getByTestId("reference-thumbnail-0")).toBeInTheDocument();
      expect(
        screen.queryByTestId("reference-thumbnail-1")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("reference-file-count")).toHaveTextContent(
        "1 of 16 reference images"
      );
    });

    it("enforces the max 16 file limit", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal();

      const fileInput = screen.getByTestId("reference-file-input");

      // Add 16 files (the max)
      const batch = Array.from({ length: 16 }, (_, i) =>
        createMockFile(`file-${i}.png`, 512, "image/png")
      );
      await user.upload(fileInput, batch);

      expect(screen.getByTestId("reference-file-count")).toHaveTextContent(
        "16 of 16 reference images"
      );

      // Try to add one more — should show error
      const extra = createMockFile("extra.png", 512, "image/png");
      await user.upload(fileInput, extra);

      expect(screen.getByTestId("reference-error")).toBeInTheDocument();
      expect(screen.getByTestId("reference-error")).toHaveTextContent(
        "exceed the limit"
      );
      // Still 16 thumbnails
      expect(screen.getByTestId("reference-file-count")).toHaveTextContent(
        "16 of 16 reference images"
      );
    });

    it("rejects files with unsupported MIME type via drag-and-drop", async () => {
      renderModal();

      const dropZone = screen.getByTestId("reference-drop-zone");
      const badFile = createMockFile("doc.pdf", 1024, "application/pdf");

      // Use fireEvent.drop to simulate drag-and-drop (bypasses <input accept>)
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [badFile] },
      });

      await waitFor(() => {
        expect(screen.getByTestId("reference-error")).toBeInTheDocument();
      });
      expect(screen.getByTestId("reference-error")).toHaveTextContent(
        "not a supported image type"
      );
      expect(
        screen.queryByTestId("reference-thumbnail-0")
      ).not.toBeInTheDocument();
    });

    it("rejects files larger than 20 MB", async () => {
      renderModal();

      const dropZone = screen.getByTestId("reference-drop-zone");
      const bigFile = createMockFile(
        "huge.png",
        21 * 1024 * 1024,
        "image/png"
      );

      // Use fireEvent.drop so our custom size override is respected
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [bigFile] },
      });

      await waitFor(() => {
        expect(screen.getByTestId("reference-error")).toBeInTheDocument();
      });
      expect(screen.getByTestId("reference-error")).toHaveTextContent(
        "exceeds the 20 MB size limit"
      );
      expect(
        screen.queryByTestId("reference-thumbnail-0")
      ).not.toBeInTheDocument();
    });

    it("calls generateAssetWithRefs when reference files are present", async () => {
      mockGenerateAssetWithRefs.mockResolvedValue(MOCK_ASSET);
      const onSuccess = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal({ onSuccess });

      await fillRequiredFields(user);

      // Add a reference image
      const fileInput = screen.getByTestId("reference-file-input");
      const file = createMockFile("ref.png", 1024, "image/png");
      await user.upload(fileInput, file);

      await user.click(screen.getByTestId("generate-submit-btn"));

      await waitFor(() => {
        expect(mockGenerateAssetWithRefs).toHaveBeenCalledTimes(1);
      });

      // Verify args: first arg = request, second arg = files array
      const [request, files] = mockGenerateAssetWithRefs.mock.calls[0];
      expect(request).toMatchObject({
        name: "Test Banner",
        prompt: "A professional email banner for testing",
      });
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe("ref.png");

      // generateAsset (JSON path) should NOT have been called
      expect(mockGenerateAsset).not.toHaveBeenCalled();
    });

    it("calls generateAsset (not WithRefs) when no reference files are present", async () => {
      mockGenerateAsset.mockResolvedValue(MOCK_ASSET);
      const onSuccess = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderModal({ onSuccess });

      await fillRequiredFields(user);
      await user.click(screen.getByTestId("generate-submit-btn"));

      await waitFor(() => {
        expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
      });
      expect(mockGenerateAssetWithRefs).not.toHaveBeenCalled();
    });
  });
});
