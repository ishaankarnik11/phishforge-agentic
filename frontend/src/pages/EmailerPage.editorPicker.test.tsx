/**
 * STORY-A5.2: Asset picker integration in GrapesJS editor.
 *
 * Focused tests for the "Swap from Library" / asset-manager-override
 * flow that opens an AssetPickerModal when the user wants to change
 * an image's `src` inside the GrapesJS editor.
 *
 * These tests live in a separate file from EmailerPage.test.tsx
 * (which is already 1300+ lines) to keep the test suite manageable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EmailerPage from "./EmailerPage";
import * as emailersApi from "../api/emailers";
import * as costApi from "../api/cost";
import type { EmailerRead, EmailerVersionRead } from "../api/emailers";
import type { EmailerCostDetail } from "../api/cost";
import { AuthContext, type AuthContextValue } from "../contexts/AuthContext";

// ---------------------------------------------------------------------------
// Mock: GrapesJS editor (cannot render in jsdom)
// ---------------------------------------------------------------------------

// justified: GrapesJS Editor type is complex; we only mock the methods we use
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedEditorInit: ((editor: any) => void) | undefined;

vi.mock("../components/Editor", async () => {
  const real = await vi.importActual<
    typeof import("../components/Editor/commitPendingEdits")
  >("../components/Editor/commitPendingEdits");
  const live = await vi.importActual<
    typeof import("../components/Editor/useLivePreviewHtml")
  >("../components/Editor/useLivePreviewHtml");
  return {
    GrapesjsEditor: ({
      onEditorInit,
    }: {
      mjmlSource: string;
      // justified: matching the real component prop which uses the grapesjs Editor type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onEditorInit?: (editor: any) => void;
    }) => {
      capturedEditorInit = onEditorInit;
      return <div data-testid="grapes-editor">Editor</div>;
    },
    PreviewPane: () => <div data-testid="preview-pane">Preview</div>,
    VersionHistory: () => <div>History</div>,
    ChatPanel: () => <div>Chat</div>,
    ShareLinkDialog: () => <div>Share</div>,
    commitPendingEdits: real.commitPendingEdits,
    LIVE_PREVIEW_EVENTS: live.LIVE_PREVIEW_EVENTS,
    LIVE_PREVIEW_DEBOUNCE_MS: live.LIVE_PREVIEW_DEBOUNCE_MS,
  };
});

// ---------------------------------------------------------------------------
// Mock: AssetPickerModal — render a simplified version that lets us
// exercise the open/close/select flow without needing library API mocks.
// ---------------------------------------------------------------------------

vi.mock("../components/AssetPickerModal", () => ({
  default: (props: {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (
      assets: import("../api/libraryAssets").LibraryAssetRead[],
    ) => void;
  }) => {
    if (!props.isOpen) return null;
    return (
      <div data-testid="editor-asset-picker-modal">
        <button
          data-testid="picker-select-btn"
          onClick={() =>
            props.onSelect([
              {
                id: "asset-1",
                name: "Test Image",
                source: "uploaded" as const,
                tags: [],
                created_by_name: null,
                primary_version: {
                  id: "ver-1",
                  version_number: 1,
                  thumbnail_url: "https://example.com/thumb.png",
                  storage_url: "https://example.com/full.png",
                  width: 600,
                  height: 400,
                  file_size_bytes: 50000,
                  prompt_text: null,
                  refinement_instruction: null,
                  model_used: null,
                  cost_usd: null,
                  created_at: "2026-01-01T00:00:00Z",
                },
                created_at: "2026-01-01T00:00:00Z",
              },
            ])
          }
        >
          Select Asset
        </button>
        <button data-testid="picker-close-btn" onClick={props.onClose}>
          Close
        </button>
      </div>
    );
  },
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_EMAILER: EmailerRead = {
  id: 42,
  name: "Q4 Campaign",
  status: "draft",
};

const MOCK_VERSION: EmailerVersionRead = {
  id: 10,
  emailer_id: 42,
  version_number: 1,
  mjml_source: "<mjml><mj-body></mj-body></mjml>",
  compiled_html: "<html><body>Hello</body></html>",
  subject_line: "Test",
  preheader: "Preheader",
  model_used: "claude-sonnet-4-20250514",
  input_tokens: 1000,
  output_tokens: 2000,
  created_at: "2026-01-01T00:00:00Z",
};

const MOCK_COST: EmailerCostDetail = {
  summary: {
    emailer_id: 42,
    emailer_name: "Q4 Campaign",
    creator_email: "priya@phishforge.io",
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
  user: { id: 1, email: "priya@phishforge.io", name: "Priya", role: "editor" },
  isAuthenticated: true,
  isAdmin: false,
  profileLoaded: true,
  login: vi.fn(),
  logout: vi.fn(),
};

function renderPage(emailerId = "42") {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/emailers/${emailerId}`]}>
        <AuthContext.Provider value={AUTH_VALUE}>
          <Routes>
            <Route path="/emailers/:id" element={<EmailerPage />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Create a minimal mock GrapesJS editor that captures command
 * registrations and event listeners so we can trigger them in tests.
 */
function createMockEditor() {
  // justified: mocking GrapesJS Editor interface minimally; the real
  // type is huge and irrelevant for unit-testing React integration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commands = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners = new Map<string, Array<(...args: any[]) => void>>();

  const mockEditor = {
    UndoManager: {
      undo: vi.fn(),
      redo: vi.fn(),
      hasUndo: vi.fn().mockReturnValue(false),
      hasRedo: vi.fn().mockReturnValue(false),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, fn: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
    },
    Commands: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      add(name: string, def: any) {
        commands.set(name, def);
      },
    },
    getHtml: vi.fn().mockReturnValue("<mjml><mj-body></mj-body></mjml>"),
    getSelected: vi.fn().mockReturnValue(null),
  };

  return {
    mockEditor,
    commands,
    listeners,
    /** Trigger a registered event */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emit(event: string, ...args: any[]) {
      for (const fn of listeners.get(event) ?? []) {
        fn(...args);
      }
    },
    /** Run a registered command's run() method */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runCommand(name: string, opts?: any) {
      const cmd = commands.get(name);
      if (!cmd?.run) throw new Error(`Command "${name}" not registered or has no run()`);
      cmd.run(mockEditor, null, opts);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("STORY-A5.2: Asset picker in GrapesJS editor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    capturedEditorInit = undefined;

    // Default API stubs
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
    vi.spyOn(costApi, "getEmailerCost").mockResolvedValue(MOCK_COST);
  });

  // -----------------------------------------------------------------------
  // 1. AssetPickerModal is rendered (initially closed)
  // -----------------------------------------------------------------------

  it("renders AssetPickerModal in the page (initially closed)", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument(),
    );

    // The mock picker returns null when isOpen=false, so the modal
    // should NOT be in the document initially.
    expect(
      screen.queryByTestId("editor-asset-picker-modal"),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 2. open-assets command opens the picker modal
  // -----------------------------------------------------------------------

  it("opens AssetPickerModal when GrapesJS 'open-assets' command fires", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument(),
    );

    const { mockEditor, runCommand } = createMockEditor();
    // Initialize the editor (which registers our custom commands)
    act(() => {
      capturedEditorInit?.(mockEditor);
    });

    // Simulate GrapesJS running the open-assets command (e.g., user
    // double-clicks an image component)
    act(() => {
      runCommand("open-assets", { target: null });
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("editor-asset-picker-modal"),
      ).toBeInTheDocument(),
    );
  });

  // -----------------------------------------------------------------------
  // 3. swap-from-library command opens the picker modal
  // -----------------------------------------------------------------------

  it("opens AssetPickerModal when 'swap-from-library' command fires", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument(),
    );

    const { mockEditor, runCommand } = createMockEditor();
    act(() => {
      capturedEditorInit?.(mockEditor);
    });

    act(() => {
      runCommand("swap-from-library");
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("editor-asset-picker-modal"),
      ).toBeInTheDocument(),
    );
  });

  // -----------------------------------------------------------------------
  // 4. Selecting an asset updates the target component's `src`
  // -----------------------------------------------------------------------

  it("sets src attribute on the target component when an asset is selected", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument(),
    );

    const addAttributes = vi.fn();
    const mockTarget = {
      addAttributes,
      get: vi.fn().mockReturnValue("mj-image"),
    };

    const { mockEditor, runCommand } = createMockEditor();
    act(() => {
      capturedEditorInit?.(mockEditor);
    });

    // open-assets with a specific target component
    act(() => {
      runCommand("open-assets", { target: mockTarget });
    });

    // The picker modal should now be open
    await waitFor(() =>
      expect(
        screen.getByTestId("editor-asset-picker-modal"),
      ).toBeInTheDocument(),
    );

    // Click the "Select Asset" button in our mock picker
    act(() => {
      screen.getByTestId("picker-select-btn").click();
    });

    // The target component should have its src updated
    await waitFor(() => {
      expect(addAttributes).toHaveBeenCalledWith({
        src: "https://example.com/full.png",
      });
    });

    // Modal should be closed after selection
    expect(
      screen.queryByTestId("editor-asset-picker-modal"),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 5. Modal closes when the close button is clicked
  // -----------------------------------------------------------------------

  it("closes the picker modal on close without changing component", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument(),
    );

    const { mockEditor, runCommand } = createMockEditor();
    act(() => {
      capturedEditorInit?.(mockEditor);
    });

    // Open the picker
    act(() => {
      runCommand("open-assets");
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("editor-asset-picker-modal"),
      ).toBeInTheDocument(),
    );

    // Close via the close button
    act(() => {
      screen.getByTestId("picker-close-btn").click();
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId("editor-asset-picker-modal"),
      ).not.toBeInTheDocument(),
    );
  });

  // -----------------------------------------------------------------------
  // 6. component:selected event adds "Swap from Library" toolbar button
  //    for mj-image components
  // -----------------------------------------------------------------------

  it("adds 'Swap from Library' toolbar button when an mj-image is selected", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument(),
    );

    const { mockEditor, emit } = createMockEditor();
    act(() => {
      capturedEditorInit?.(mockEditor);
    });

    // Simulate selecting an mj-image component
    const existingToolbar: Array<{ command: string; label?: string }> = [
      { command: "tlb-move", label: "Move" },
    ];

    const mockComponent = {
      get: vi.fn((prop: string) => {
        if (prop === "type") return "mj-image";
        if (prop === "toolbar") return existingToolbar;
        return undefined;
      }),
      set: vi.fn(),
    };

    act(() => {
      emit("component:selected", mockComponent);
    });

    // The component's set() should have been called with an updated
    // toolbar array that includes the swap-from-library command
    expect(mockComponent.set).toHaveBeenCalledWith(
      "toolbar",
      expect.arrayContaining([
        expect.objectContaining({ command: "swap-from-library" }),
      ]),
    );
  });

  // -----------------------------------------------------------------------
  // 7. Does NOT add toolbar button for non-image components
  // -----------------------------------------------------------------------

  it("does not add toolbar button for non-image components (e.g. mj-text)", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument(),
    );

    const { mockEditor, emit } = createMockEditor();
    act(() => {
      capturedEditorInit?.(mockEditor);
    });

    const mockComponent = {
      get: vi.fn((prop: string) => {
        if (prop === "type") return "mj-text";
        if (prop === "toolbar") return [];
        return undefined;
      }),
      set: vi.fn(),
    };

    act(() => {
      emit("component:selected", mockComponent);
    });

    // set() should NOT have been called since it's not an mj-image
    expect(mockComponent.set).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 8. Prefers storage_url over thumbnail_url
  // -----------------------------------------------------------------------

  it("prefers storage_url over thumbnail_url when setting src", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument(),
    );

    const addAttributes = vi.fn();
    const mockTarget = { addAttributes };

    const { mockEditor, runCommand } = createMockEditor();
    act(() => {
      capturedEditorInit?.(mockEditor);
    });

    act(() => {
      runCommand("open-assets", { target: mockTarget });
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("editor-asset-picker-modal"),
      ).toBeInTheDocument(),
    );

    // Our mock picker's "Select Asset" button sends an asset with both
    // storage_url and thumbnail_url. The handler should prefer storage_url.
    act(() => {
      screen.getByTestId("picker-select-btn").click();
    });

    await waitFor(() => {
      expect(addAttributes).toHaveBeenCalledWith({
        src: "https://example.com/full.png",
      });
    });
  });

  // -----------------------------------------------------------------------
  // 9. open-assets uses editor.getSelected() as fallback target
  // -----------------------------------------------------------------------

  it("falls back to editor.getSelected() when open-assets has no target", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument(),
    );

    const addAttributes = vi.fn();
    const mockSelected = { addAttributes };

    const { mockEditor, runCommand } = createMockEditor();
    mockEditor.getSelected = vi.fn().mockReturnValue(mockSelected);

    act(() => {
      capturedEditorInit?.(mockEditor);
    });

    // open-assets with NO target in opts
    act(() => {
      runCommand("open-assets", {});
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("editor-asset-picker-modal"),
      ).toBeInTheDocument(),
    );

    // Select an asset -- it should call addAttributes on the
    // getSelected() fallback component
    act(() => {
      screen.getByTestId("picker-select-btn").click();
    });

    await waitFor(() => {
      expect(addAttributes).toHaveBeenCalledWith({
        src: "https://example.com/full.png",
      });
    });
  });
});
