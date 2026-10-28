import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AssetPickerModal from "./AssetPickerModal";
import * as libraryAssetsApi from "../api/libraryAssets";
import type {
  LibraryAssetRead,
  LibraryAssetDetailRead,
  LibraryAssetListResponse,
} from "../api/libraryAssets";

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

interface RenderOptions {
  isOpen?: boolean;
  onClose?: () => void;
  onSelect?: (assets: LibraryAssetRead[]) => void;
  alreadyAttachedIds?: Set<string>;
}

function renderModal(opts: RenderOptions = {}) {
  const client = makeQueryClient();
  const defaultOnClose = vi.fn();
  const defaultOnSelect = vi.fn();

  const props = {
    isOpen: opts.isOpen ?? true,
    onClose: opts.onClose ?? defaultOnClose,
    onSelect: opts.onSelect ?? defaultOnSelect,
    alreadyAttachedIds: opts.alreadyAttachedIds,
  };

  const result = render(
    <QueryClientProvider client={client}>
      <AssetPickerModal {...props} />
    </QueryClientProvider>
  );

  return { ...result, onClose: props.onClose, onSelect: props.onSelect };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_ASSETS: LibraryAssetRead[] = [
  {
    id: "lib-1",
    name: "Diwali Festive Banner",
    source: "generated",
    tags: ["banner"],
    created_by_name: "Priya",
    primary_version: {
      id: "v-1",
      version_number: 1,
      thumbnail_url: "http://localhost:8000/thumbs/diwali.png",
      storage_url: "http://localhost:8000/assets/diwali.png",
      width: 600,
      height: 400,
      file_size_bytes: 50000,
      prompt_text: null,
      refinement_instruction: null,
      model_used: null,
      cost_usd: null,
      created_at: "2026-05-01T00:00:00Z",
    },
    created_at: "2026-05-01T00:00:00Z",
  },
  {
    id: "lib-2",
    name: "Credit Card Hero Image",
    source: "uploaded",
    tags: ["hero"],
    created_by_name: "Ishaan",
    primary_version: {
      id: "v-2",
      version_number: 1,
      thumbnail_url: null,
      storage_url: "http://localhost:8000/assets/cc-hero.png",
      width: 800,
      height: 600,
      file_size_bytes: 75000,
      prompt_text: null,
      refinement_instruction: null,
      model_used: null,
      cost_usd: null,
      created_at: "2026-05-02T00:00:00Z",
    },
    created_at: "2026-05-02T00:00:00Z",
  },
  {
    id: "lib-3",
    name: "Savings Account Promo",
    source: "generated",
    tags: ["promo"],
    created_by_name: "Priya",
    primary_version: {
      id: "v-3",
      version_number: 1,
      thumbnail_url: "http://localhost:8000/thumbs/savings.png",
      storage_url: null,
      width: 400,
      height: 400,
      file_size_bytes: 30000,
      prompt_text: null,
      refinement_instruction: null,
      model_used: null,
      cost_usd: null,
      created_at: "2026-05-03T00:00:00Z",
    },
    created_at: "2026-05-03T00:00:00Z",
  },
];

const MOCK_RESPONSE: LibraryAssetListResponse = {
  items: MOCK_ASSETS,
  total: 3,
};

const EMPTY_RESPONSE: LibraryAssetListResponse = {
  items: [],
  total: 0,
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockResolvedValue(
    MOCK_RESPONSE
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AssetPickerModal", () => {
  it("renders the modal when isOpen is true", async () => {
    renderModal({ isOpen: true });

    expect(screen.getByTestId("asset-picker-modal")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: /Pick from Library/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Pick from Library")).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    renderModal({ isOpen: false });

    expect(screen.queryByTestId("asset-picker-modal")).not.toBeInTheDocument();
  });

  it("renders search input", async () => {
    renderModal();

    expect(screen.getByTestId("asset-picker-search")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search library assets...")
    ).toBeInTheDocument();
  });

  it("renders asset cards from the library", async () => {
    renderModal();

    await waitFor(() => {
      expect(
        screen.getByTestId("asset-picker-card-lib-1")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Diwali Festive Banner")).toBeInTheDocument();
    expect(screen.getByText("Credit Card Hero Image")).toBeInTheDocument();
    expect(screen.getByText("Savings Account Promo")).toBeInTheDocument();
  });

  it("filters results via search input with debounce", async () => {
    const fetchSpy = vi
      .spyOn(libraryAssetsApi, "fetchLibraryAssets")
      .mockResolvedValue(MOCK_RESPONSE);

    const user = userEvent.setup();
    renderModal();

    const searchInput = screen.getByTestId("asset-picker-search");
    await user.type(searchInput, "Diwali");

    // Wait for the debounced search to fire (300ms)
    await waitFor(
      () => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({ search: "Diwali" })
        );
      },
      { timeout: 1000 }
    );
  });

  it("selects a card on click and shows checkmark", async () => {
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => {
      expect(
        screen.getByTestId("asset-picker-card-lib-1")
      ).toBeInTheDocument();
    });

    const card = screen.getByTestId("asset-picker-card-lib-1");
    await user.click(card);

    expect(
      screen.getByTestId("asset-picker-check-lib-1")
    ).toBeInTheDocument();
    expect(screen.getByTestId("asset-picker-count")).toHaveTextContent(
      "1 selected"
    );
  });

  it("deselects a card when clicked again", async () => {
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => {
      expect(
        screen.getByTestId("asset-picker-card-lib-1")
      ).toBeInTheDocument();
    });

    const card = screen.getByTestId("asset-picker-card-lib-1");

    // Select
    await user.click(card);
    expect(
      screen.getByTestId("asset-picker-check-lib-1")
    ).toBeInTheDocument();

    // Deselect
    await user.click(card);
    expect(
      screen.queryByTestId("asset-picker-check-lib-1")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("asset-picker-count")).toHaveTextContent(
      "0 selected"
    );
  });

  it("calls onSelect with selected assets when 'Add Selected' is clicked", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderModal({ onSelect, onClose });

    await waitFor(() => {
      expect(
        screen.getByTestId("asset-picker-card-lib-1")
      ).toBeInTheDocument();
    });

    // Select two assets
    await user.click(screen.getByTestId("asset-picker-card-lib-1"));
    await user.click(screen.getByTestId("asset-picker-card-lib-3"));

    expect(screen.getByTestId("asset-picker-count")).toHaveTextContent(
      "2 selected"
    );

    await user.click(screen.getByTestId("asset-picker-add-btn"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const selectedAssets = onSelect.mock.calls[0][0] as LibraryAssetRead[];
    expect(selectedAssets).toHaveLength(2);
    const selectedIds = selectedAssets.map((a) => a.id);
    expect(selectedIds).toContain("lib-1");
    expect(selectedIds).toContain("lib-3");
    expect(onClose).toHaveBeenCalled();
  });

  it("disables 'Add Selected' when nothing is selected", async () => {
    renderModal();

    await waitFor(() => {
      expect(
        screen.getByTestId("asset-picker-card-lib-1")
      ).toBeInTheDocument();
    });

    const addButton = screen.getByTestId("asset-picker-add-btn");
    expect(addButton).toBeDisabled();
  });

  it("enables 'Add Selected' when at least one asset is selected", async () => {
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => {
      expect(
        screen.getByTestId("asset-picker-card-lib-1")
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("asset-picker-card-lib-1"));

    const addButton = screen.getByTestId("asset-picker-add-btn");
    expect(addButton).not.toBeDisabled();
  });

  it("shows already-attached assets as disabled", async () => {
    renderModal({ alreadyAttachedIds: new Set(["lib-2"]) });

    await waitFor(() => {
      expect(
        screen.getByTestId("asset-picker-card-lib-2")
      ).toBeInTheDocument();
    });

    const card = screen.getByTestId("asset-picker-card-lib-2");
    expect(card).toBeDisabled();
    expect(screen.getByText("Already added")).toBeInTheDocument();
  });

  it("does not allow selecting already-attached assets", async () => {
    const user = userEvent.setup();
    renderModal({ alreadyAttachedIds: new Set(["lib-2"]) });

    await waitFor(() => {
      expect(
        screen.getByTestId("asset-picker-card-lib-2")
      ).toBeInTheDocument();
    });

    const card = screen.getByTestId("asset-picker-card-lib-2");
    await user.click(card);

    // Should still show 0 selected
    expect(screen.getByTestId("asset-picker-count")).toHaveTextContent(
      "0 selected"
    );
  });

  it("updates selected count correctly when toggling multiple", async () => {
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => {
      expect(
        screen.getByTestId("asset-picker-card-lib-1")
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("asset-picker-count")).toHaveTextContent(
      "0 selected"
    );

    await user.click(screen.getByTestId("asset-picker-card-lib-1"));
    expect(screen.getByTestId("asset-picker-count")).toHaveTextContent(
      "1 selected"
    );

    await user.click(screen.getByTestId("asset-picker-card-lib-2"));
    expect(screen.getByTestId("asset-picker-count")).toHaveTextContent(
      "2 selected"
    );

    await user.click(screen.getByTestId("asset-picker-card-lib-3"));
    expect(screen.getByTestId("asset-picker-count")).toHaveTextContent(
      "3 selected"
    );

    // Deselect one
    await user.click(screen.getByTestId("asset-picker-card-lib-2"));
    expect(screen.getByTestId("asset-picker-count")).toHaveTextContent(
      "2 selected"
    );
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderModal({ onClose });

    await user.click(screen.getByRole("button", { name: /Close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderModal({ onClose });

    const backdrop = screen.getByTestId("asset-picker-modal");
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows empty state when no assets match search", async () => {
    vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockResolvedValue(
      EMPTY_RESPONSE
    );

    renderModal();

    await waitFor(() => {
      expect(
        screen.getByText("No assets in the library yet.")
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // STORY-A5.5 — Inline generation from asset picker
  // -------------------------------------------------------------------------

  describe("inline generation (STORY-A5.5)", () => {
    it("renders 'Browse Library' and 'Generate New' tab buttons", async () => {
      renderModal();

      expect(screen.getByTestId("tab-browse")).toBeInTheDocument();
      expect(screen.getByTestId("tab-generate")).toBeInTheDocument();
      expect(screen.getByText("Browse Library")).toBeInTheDocument();
      expect(screen.getByText("Generate New")).toBeInTheDocument();
    });

    it("defaults to Browse Library tab with search visible", async () => {
      renderModal();

      expect(screen.getByTestId("tab-browse")).toHaveAttribute(
        "aria-selected",
        "true"
      );
      expect(screen.getByTestId("asset-picker-search")).toBeInTheDocument();
      expect(
        screen.queryByTestId("inline-generate-form")
      ).not.toBeInTheDocument();
    });

    it("switches to generate form when 'Generate New' tab is clicked", async () => {
      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByTestId("tab-generate"));

      expect(screen.getByTestId("tab-generate")).toHaveAttribute(
        "aria-selected",
        "true"
      );
      expect(screen.getByTestId("inline-generate-form")).toBeInTheDocument();
      expect(screen.getByTestId("inline-gen-name")).toBeInTheDocument();
      expect(screen.getByTestId("inline-gen-prompt")).toBeInTheDocument();
      expect(screen.getByTestId("inline-gen-dimensions")).toBeInTheDocument();
      // Search and grid should be hidden
      expect(
        screen.queryByTestId("asset-picker-search")
      ).not.toBeInTheDocument();
    });

    it("generate form has name, prompt, and dimensions inputs", async () => {
      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByTestId("tab-generate"));

      expect(screen.getByTestId("inline-gen-name")).toBeInTheDocument();
      expect(screen.getByTestId("inline-gen-prompt")).toBeInTheDocument();
      expect(screen.getByTestId("inline-gen-dimensions")).toBeInTheDocument();
      expect(screen.getByTestId("inline-gen-submit")).toBeInTheDocument();
      expect(screen.getByText("Generate & Add")).toBeInTheDocument();
    });

    it("shows validation errors when submitting empty form", async () => {
      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByTestId("tab-generate"));
      await user.click(screen.getByTestId("inline-gen-submit"));

      expect(
        screen.getByTestId("inline-gen-name-error")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("inline-gen-prompt-error")
      ).toBeInTheDocument();
    });

    it("calls generateAsset API on valid submit", async () => {
      const mockGeneratedAsset: LibraryAssetDetailRead = {
        id: "gen-new-1",
        name: "Test Generated Asset",
        source: "generated",
        tags: [],
        created_by_name: "Ishaan",
        primary_version: {
          id: "v-gen-1",
          version_number: 1,
          thumbnail_url: "http://localhost:8000/thumbs/gen.png",
          storage_url: "http://localhost:8000/assets/gen.png",
          width: 608,
          height: 400,
          file_size_bytes: 40000,
          prompt_text: "A professional banner for testing",
          refinement_instruction: null,
          model_used: "gpt-image-2",
          cost_usd: 0.05,
          created_at: "2026-05-06T00:00:00Z",
        },
        created_at: "2026-05-06T00:00:00Z",
        versions: [
          {
            id: "v-gen-1",
            version_number: 1,
            thumbnail_url: "http://localhost:8000/thumbs/gen.png",
            storage_url: "http://localhost:8000/assets/gen.png",
            width: 608,
            height: 400,
            file_size_bytes: 40000,
            prompt_text: "A professional banner for testing",
            refinement_instruction: null,
            model_used: "gpt-image-2",
            cost_usd: 0.05,
            created_at: "2026-05-06T00:00:00Z",
          },
        ],
      };

      const generateSpy = vi
        .spyOn(libraryAssetsApi, "generateAsset")
        .mockResolvedValue(mockGeneratedAsset);

      const onSelect = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup();

      renderModal({ onSelect, onClose });

      await user.click(screen.getByTestId("tab-generate"));

      // Fill the form
      await user.type(
        screen.getByTestId("inline-gen-name"),
        "Test Generated Asset"
      );
      await user.type(
        screen.getByTestId("inline-gen-prompt"),
        "A professional banner for testing"
      );

      // Submit
      await user.click(screen.getByTestId("inline-gen-submit"));

      expect(generateSpy).toHaveBeenCalledTimes(1);
      // useMutation passes (variables, context) — check first arg only
      const calledWith = generateSpy.mock.calls[0][0] as libraryAssetsApi.GenerateAssetRequest;
      expect(calledWith.name).toBe("Test Generated Asset");
      expect(calledWith.prompt).toBe("A professional banner for testing");
    });

    it("shows loading state during generation", async () => {
      // Mock generateAsset to hang indefinitely
      vi.spyOn(libraryAssetsApi, "generateAsset").mockReturnValue(
        new Promise(() => {
          /* never resolves */
        })
      );

      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByTestId("tab-generate"));

      await user.type(screen.getByTestId("inline-gen-name"), "Loading Test");
      await user.type(
        screen.getByTestId("inline-gen-prompt"),
        "A professional banner that takes forever"
      );
      await user.click(screen.getByTestId("inline-gen-submit"));

      await waitFor(() => {
        expect(screen.getByTestId("inline-gen-loading")).toBeInTheDocument();
      });

      expect(screen.getByText("Generating...")).toBeInTheDocument();
    });

    it("calls onSelect and onClose on successful generation", async () => {
      const mockGeneratedAsset: LibraryAssetDetailRead = {
        id: "gen-new-2",
        name: "Success Asset",
        source: "generated",
        tags: [],
        created_by_name: "Ishaan",
        primary_version: {
          id: "v-gen-2",
          version_number: 1,
          thumbnail_url: "http://localhost:8000/thumbs/success.png",
          storage_url: "http://localhost:8000/assets/success.png",
          width: 608,
          height: 208,
          file_size_bytes: 35000,
          prompt_text: "A successful generation test prompt",
          refinement_instruction: null,
          model_used: "gpt-image-2",
          cost_usd: 0.04,
          created_at: "2026-05-06T00:00:00Z",
        },
        created_at: "2026-05-06T00:00:00Z",
        versions: [
          {
            id: "v-gen-2",
            version_number: 1,
            thumbnail_url: "http://localhost:8000/thumbs/success.png",
            storage_url: "http://localhost:8000/assets/success.png",
            width: 608,
            height: 208,
            file_size_bytes: 35000,
            prompt_text: "A successful generation test prompt",
            refinement_instruction: null,
            model_used: "gpt-image-2",
            cost_usd: 0.04,
            created_at: "2026-05-06T00:00:00Z",
          },
        ],
      };

      vi.spyOn(libraryAssetsApi, "generateAsset").mockResolvedValue(
        mockGeneratedAsset
      );

      const onSelect = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup();

      renderModal({ onSelect, onClose });

      await user.click(screen.getByTestId("tab-generate"));

      await user.type(screen.getByTestId("inline-gen-name"), "Success Asset");
      await user.type(
        screen.getByTestId("inline-gen-prompt"),
        "A successful generation test prompt"
      );
      await user.click(screen.getByTestId("inline-gen-submit"));

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledTimes(1);
      });

      // Should have passed a LibraryAssetRead (not detail) with the right id
      const selected = onSelect.mock.calls[0][0] as LibraryAssetRead[];
      expect(selected).toHaveLength(1);
      expect(selected[0].id).toBe("gen-new-2");
      expect(selected[0].name).toBe("Success Asset");

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("can switch back to Browse Library tab from Generate New", async () => {
      const user = userEvent.setup();
      renderModal();

      // Go to generate tab
      await user.click(screen.getByTestId("tab-generate"));
      expect(screen.getByTestId("inline-generate-form")).toBeInTheDocument();

      // Switch back to browse
      await user.click(screen.getByTestId("tab-browse"));
      expect(
        screen.queryByTestId("inline-generate-form")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("asset-picker-search")).toBeInTheDocument();
    });

    it("shows inline error on generation failure", async () => {
      vi.spyOn(libraryAssetsApi, "generateAsset").mockRejectedValue(
        new Error("Service unavailable")
      );

      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByTestId("tab-generate"));

      await user.type(screen.getByTestId("inline-gen-name"), "Error Test");
      await user.type(
        screen.getByTestId("inline-gen-prompt"),
        "A prompt that will fail on the server"
      );
      await user.click(screen.getByTestId("inline-gen-submit"));

      await waitFor(() => {
        expect(screen.getByTestId("inline-gen-error")).toBeInTheDocument();
      });

      expect(screen.getByText(/Service unavailable/)).toBeInTheDocument();
    });
  });
});
