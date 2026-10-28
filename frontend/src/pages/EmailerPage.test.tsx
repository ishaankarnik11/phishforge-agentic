import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EmailerPage, { AUTO_SAVE_INTERVAL_MS } from "./EmailerPage";
import * as emailersApi from "../api/emailers";
import * as costApi from "../api/cost";
import type {
  EmailerRead,
  EmailerVersionRead,
  GenerateResponse,
} from "../api/emailers";
import type { EmailerCostDetail } from "../api/cost";
import { AuthContext, type AuthContextValue } from "../contexts/AuthContext";
import { LIVE_PREVIEW_EVENTS } from "../components/Editor/useLivePreviewHtml";

// ---------------------------------------------------------------------------
// Mock the GrapesJS editor -- it cannot render in JSDOM
// ---------------------------------------------------------------------------

// justified: GrapesJS Editor type is complex; we only mock the methods we use
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedEditorInit: ((editor: any) => void) | undefined;

vi.mock("../components/Editor", async () => {
  // Re-export the real commitPendingEdits — it's pure and only touches
  // the Editor object we hand it from each test, so it works fine in JSDOM.
  const real = await vi.importActual<
    typeof import("../components/Editor/commitPendingEdits")
  >("../components/Editor/commitPendingEdits");
  // STORY-8.1: re-export the real LIVE_PREVIEW_EVENTS constant so
  // EmailerPage's mark-dirty subscription (which iterates the array)
  // doesn't blow up under the mocked Editor module.
  const live = await vi.importActual<
    typeof import("../components/Editor/useLivePreviewHtml")
  >("../components/Editor/useLivePreviewHtml");
  return {
    GrapesjsEditor: ({
      mjmlSource,
      onEditorInit,
    }: {
      mjmlSource: string;
      // justified: matching the real component prop which uses the grapesjs Editor type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onEditorInit?: (editor: any) => void;
    }) => {
      capturedEditorInit = onEditorInit;
      return (
        <div data-testid="grapes-editor">{mjmlSource.substring(0, 50)}</div>
      );
    },
    PreviewPane: ({ compiledHtml }: { compiledHtml: string | null }) => (
      <div data-testid="preview-pane">
        {compiledHtml ? "Preview loaded" : "No preview"}
      </div>
    ),
    VersionHistory: () => (
      <div data-testid="version-history">Version History Panel</div>
    ),
    ChatPanel: () => <div data-testid="chat-panel">Chat Panel</div>,
    ShareLinkDialog: () => <div data-testid="share-link-dialog">Share</div>,
    commitPendingEdits: real.commitPendingEdits,
    LIVE_PREVIEW_EVENTS: live.LIVE_PREVIEW_EVENTS,
    LIVE_PREVIEW_DEBOUNCE_MS: live.LIVE_PREVIEW_DEBOUNCE_MS,
  };
});

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
  preheader: "Test Preheader",
  model_used: "claude-sonnet-4-20250514",
  input_tokens: 1000,
  output_tokens: 2000,
  created_at: "2026-01-01T00:00:00Z",
};

const MOCK_GENERATE: GenerateResponse = {
  version_id: 11,
  version_number: 2,
  subject_line: "Generated",
  preheader: "Preheader",
  mjml_source: "<mjml><mj-body><mj-section></mj-section></mj-body></mjml>",
  compiled_html: "<html><body><div>Generated</div></body></html>",
  model_used: "claude-sonnet-4-20250514",
  input_tokens: 500,
  output_tokens: 1500,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  latency_ms: 10000,
  warning: null,
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

function renderPage(emailerId = "42") {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/emailers/${emailerId}`]}>
        <AuthContext.Provider value={AUTH_VALUE}>
          <Routes>
            <Route path="/emailers/:id" element={<EmailerPage />} />
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
// Tests
// ---------------------------------------------------------------------------

describe("EmailerPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // STORY-7.6: Back-to-emailers regression test
  // -------------------------------------------------------------------------
  it("exposes a 'Back to emailers' link pointing at /", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    const backLink = screen.getByRole("link", { name: /back to emailers/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/");
  });

  // -------------------------------------------------------------------------
  // 1. Loading state
  // -------------------------------------------------------------------------
  it("shows loading state while fetching emailer", () => {
    vi.spyOn(emailersApi, "getEmailer").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );
    vi.spyOn(emailersApi, "getLatestVersion").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    renderPage();

    expect(screen.getByText(/loading emailer/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Error state
  // -------------------------------------------------------------------------
  it("shows error state when emailer fetch fails", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockRejectedValue(
      new Error("Not found")
    );
    vi.spyOn(emailersApi, "getLatestVersion").mockRejectedValue(
      new Error("Not found")
    );

    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/failed to load emailer/i);
  });

  // -------------------------------------------------------------------------
  // 3. Renders emailer details and editor when version exists
  // -------------------------------------------------------------------------
  it("renders emailer name and editor when version exists", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    renderPage();

    // Wait for emailer name to appear in the header
    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    // STORY-AP1.2: the per-emailer brand-kit chip has been removed.

    // Status badge
    expect(screen.getByText("draft")).toBeInTheDocument();

    // GrapesJS editor (mocked) should be loaded with MJML
    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    // Preview pane should show preview
    expect(screen.getByTestId("preview-pane")).toHaveTextContent(
      "Preview loaded"
    );
  });

  // -------------------------------------------------------------------------
  // 4. Shows "Generate" when no version exists, and "Regenerate" when one does
  // -------------------------------------------------------------------------
  it('shows "Generate" button when no version exists', async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockRejectedValue(
      new Error("Not found")
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    expect(
      screen.getByRole("button", { name: /generate/i })
    ).toBeInTheDocument();
  });

  it('shows "Regenerate" button when a version already exists', async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /regenerate/i })
      ).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // 5. Generate button calls API and shows spinner
  // -------------------------------------------------------------------------
  it("calls generateEmailer and shows spinner when Generate is clicked", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockRejectedValue(
      new Error("Not found")
    );
    const generateSpy = vi
      .spyOn(emailersApi, "generateEmailer")
      .mockReturnValue(
        new Promise(() => {
          // intentionally pending to test spinner
        })
      );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /generate/i }));

    expect(generateSpy).toHaveBeenCalledWith(42);

    // Button should show "Generating..." while pending
    await waitFor(() =>
      expect(screen.getByText(/generating/i)).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // 6. After generation, editor and preview load
  // -------------------------------------------------------------------------
  it("loads editor and preview after successful generation", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockRejectedValue(
      new Error("Not found")
    );
    vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(MOCK_GENERATE);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /generate/i }));

    // After generation completes, editor should appear
    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    // Preview should now show content
    expect(screen.getByTestId("preview-pane")).toHaveTextContent(
      "Preview loaded"
    );
  });

  // -------------------------------------------------------------------------
  // 7. Generation error banner
  // -------------------------------------------------------------------------
  it("shows error banner when generation fails", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockRejectedValue(
      new Error("Not found")
    );
    vi.spyOn(emailersApi, "generateEmailer").mockRejectedValue(
      new Error("Server timeout")
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /generate/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/server timeout/i);
  });

  // -------------------------------------------------------------------------
  // 8. History button shows version history panel
  // -------------------------------------------------------------------------
  it("shows History button and toggles version history panel", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    // History button should be visible
    const historyBtn = screen.getByRole("button", { name: /history/i });
    expect(historyBtn).toBeInTheDocument();

    // Initially, version history panel should not be visible
    expect(screen.queryByTestId("version-history")).not.toBeInTheDocument();

    // Click to open
    await user.click(historyBtn);
    expect(screen.getByTestId("version-history")).toBeInTheDocument();

    // Click again to close
    await user.click(historyBtn);
    expect(screen.queryByTestId("version-history")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 9. Undo/Redo buttons render (STORY-4.2 AC-3)
  // -------------------------------------------------------------------------
  it("renders Undo and Redo buttons", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    const undoBtn = screen.getByRole("button", { name: /undo/i });
    const redoBtn = screen.getByRole("button", { name: /redo/i });

    expect(undoBtn).toBeInTheDocument();
    expect(redoBtn).toBeInTheDocument();

    // Both should be disabled initially (no undo/redo history)
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 10. Save button renders (STORY-4.2)
  // -------------------------------------------------------------------------
  it("renders Save button when a version exists", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect(saveBtn).toBeInTheDocument();
    // Should be enabled when a version exists
    expect(saveBtn).not.toBeDisabled();
  });

  it("disables Save button when no version exists", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockRejectedValue(
      new Error("Not found")
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect(saveBtn).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 11. Undo button calls UndoManager.undo() (STORY-4.2 AC-3)
  // -------------------------------------------------------------------------
  it("calls UndoManager.undo() when Undo button is clicked", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    // Simulate the editor being initialized
    const mockUndo = vi.fn();
    const mockRedo = vi.fn();
    // justified: mocking the GrapesJS Editor interface minimally
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockEditor: any = {
      UndoManager: {
        undo: mockUndo,
        redo: mockRedo,
        hasUndo: vi.fn().mockReturnValue(true),
        hasRedo: vi.fn().mockReturnValue(false),
      },
      on: vi.fn(),
      Commands: { add: vi.fn() },
      getSelected: vi.fn().mockReturnValue(null),
      getHtml: vi.fn().mockReturnValue("<mjml><mj-body></mj-body></mjml>"),
    };

    // Call the captured onEditorInit callback
    capturedEditorInit?.(mockEditor);

    // Wait for state update from the editor init
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /undo/i })).not.toBeDisabled()
    );

    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(mockUndo).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 12. Save button calls saveVersion API (STORY-4.2)
  // -------------------------------------------------------------------------
  it("calls saveVersion when Save is clicked", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    const savedVersion: EmailerVersionRead = {
      ...MOCK_VERSION,
      id: 20,
      version_number: 2,
    };
    const saveSpy = vi
      .spyOn(emailersApi, "saveVersion")
      .mockResolvedValue(savedVersion);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    // Set up mock editor
    const mockMjml = "<mjml><mj-body><mj-text>edited</mj-text></mj-body></mjml>";
    // justified: mocking the GrapesJS Editor interface minimally
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockEditor: any = {
      UndoManager: {
        undo: vi.fn(),
        redo: vi.fn(),
        hasUndo: vi.fn().mockReturnValue(false),
        hasRedo: vi.fn().mockReturnValue(false),
      },
      on: vi.fn(),
      Commands: { add: vi.fn() },
      getSelected: vi.fn().mockReturnValue(null),
      getHtml: vi.fn().mockReturnValue(mockMjml),
    };

    capturedEditorInit?.(mockEditor);

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(42, mockMjml)
    );
  });

  // -------------------------------------------------------------------------
  // 13. Export HTML button renders (STORY-5.1)
  // -------------------------------------------------------------------------
  it("renders Export HTML button when a version with compiled_html exists", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    const exportBtn = screen.getByRole("button", { name: /export html/i });
    expect(exportBtn).toBeInTheDocument();
    expect(exportBtn).not.toBeDisabled();
  });

  it("disables Export HTML button when no version exists", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockRejectedValue(
      new Error("Not found")
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    const exportBtn = screen.getByRole("button", { name: /export html/i });
    expect(exportBtn).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 14. Export HTML button calls exportHtml (STORY-5.1)
  // -------------------------------------------------------------------------
  it("calls exportHtml when Export HTML is clicked", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
    // STORY-5.4: Export now forces a Save first; mock that path too.
    vi.spyOn(emailersApi, "saveVersion").mockResolvedValue({
      ...MOCK_VERSION,
      id: 50,
      version_number: 2,
    });
    const exportSpy = vi
      .spyOn(emailersApi, "exportHtml")
      .mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    // Editor must be ready for the forced-save path to fire.
    // justified: minimal Editor mock for the commit-pending-edits + getHtml hooks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockEditor: any = {
      UndoManager: {
        undo: vi.fn(),
        redo: vi.fn(),
        hasUndo: vi.fn().mockReturnValue(false),
        hasRedo: vi.fn().mockReturnValue(false),
      },
      on: vi.fn(),
      Commands: { add: vi.fn() },
      getSelected: vi.fn().mockReturnValue(null),
      Canvas: { getDocument: () => ({ activeElement: null }) },
      select: vi.fn(),
      getHtml: vi.fn().mockReturnValue(MOCK_VERSION.mjml_source),
    };
    capturedEditorInit?.(mockEditor);

    await user.click(screen.getByRole("button", { name: /export html/i }));

    await waitFor(() =>
      expect(exportSpy).toHaveBeenCalledWith(42)
    );
  });

  it("shows error when export fails", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
    // STORY-5.4: an editor-less click goes straight to exportHtml; we
    // do not need to mock saveVersion here because no editor is wired.
    vi.spyOn(emailersApi, "exportHtml").mockRejectedValue(
      new Error("No compiled HTML available")
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /export html/i }));

    await waitFor(() =>
      expect(
        screen.getByText("No compiled HTML available")
      ).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // 15. STORY-5.4: Export forces a Save first so the canvas state
  //     reaches the server before the download is requested.
  // -------------------------------------------------------------------------
  it("commits pending edits and awaits Save before issuing the export request", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    // Track the call order across saveVersion -> exportHtml.
    const callOrder: string[] = [];
    const editedMjml = "<mjml><mj-body><mj-text>EDITED</mj-text></mj-body></mjml>";

    const saveSpy = vi
      .spyOn(emailersApi, "saveVersion")
      .mockImplementation(async (id, mjml) => {
        callOrder.push(`save:${id}:${mjml}`);
        return {
          ...MOCK_VERSION,
          id: 99,
          version_number: 2,
          mjml_source: mjml,
          compiled_html: "<html><body>EDITED</body></html>",
        };
      });

    const exportSpy = vi
      .spyOn(emailersApi, "exportHtml")
      .mockImplementation(async (id) => {
        callOrder.push(`export:${id}`);
      });

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    // Wire up a mock editor that simulates the user typing into an
    // <mj-text>: getHtml() returns the edited MJML, and Canvas exposes
    // an active element whose blur() the helper must call.
    // jsdom's HTMLElement.prototype.blur is a non-writable getter, so
    // we use a real DOM element and spy on its blur method.
    const fakeActive: HTMLElement = document.createElement("p");
    const blurSpy = vi.spyOn(fakeActive, "blur");
    const selectSpy = vi.fn();
    // justified: minimal Editor mock — full Editor type is huge
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockEditor: any = {
      UndoManager: {
        undo: vi.fn(),
        redo: vi.fn(),
        hasUndo: vi.fn().mockReturnValue(false),
        hasRedo: vi.fn().mockReturnValue(false),
      },
      on: vi.fn(),
      Commands: { add: vi.fn() },
      getSelected: vi.fn().mockReturnValue(null),
      Canvas: { getDocument: () => ({ activeElement: fakeActive }) },
      select: selectSpy,
      getHtml: vi.fn().mockReturnValue(editedMjml),
    };
    capturedEditorInit?.(mockEditor);

    await user.click(screen.getByRole("button", { name: /export html/i }));

    // (a) commit-pending-edits ran (blur + select(undefined))
    await waitFor(() => expect(blurSpy).toHaveBeenCalled());
    expect(selectSpy).toHaveBeenCalledWith(undefined);

    // (b) save was awaited with the post-commit MJML
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(42, editedMjml));

    // (c) export was called only after save resolved
    await waitFor(() => expect(exportSpy).toHaveBeenCalledWith(42));
    expect(callOrder).toEqual([`save:42:${editedMjml}`, "export:42"]);
  });

  // -------------------------------------------------------------------------
  // STORY-7.12 AC-3 / AC-5: save 422 renders toast with Revert button
  // -------------------------------------------------------------------------
  it("renders the save-error toast with Editor produced invalid markup. + Revert when save returns MJMLValidationError", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
    vi.spyOn(emailersApi, "saveVersion").mockRejectedValue(
      new emailersApi.MJMLValidationError("MJML validation failed", [
        { line: 3, tag: "mj-divider", message: "void element with children" },
      ])
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    // justified: minimal Editor mock — full grapesjs Editor type is huge
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockEditor: any = {
      UndoManager: {
        undo: vi.fn(),
        redo: vi.fn(),
        hasUndo: vi.fn().mockReturnValue(false),
        hasRedo: vi.fn().mockReturnValue(false),
      },
      on: vi.fn(),
      Commands: { add: vi.fn() },
      getSelected: vi.fn().mockReturnValue(null),
      Canvas: { getDocument: () => ({ activeElement: null }) },
      select: vi.fn(),
      getHtml: vi.fn().mockReturnValue("<mjml><mj-body><mj-text>x</mj-text></mj-body></mjml>"),
      setComponents: vi.fn(),
    };
    capturedEditorInit?.(mockEditor);

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // The toast appears with the spec'd title.
    const toast = await screen.findByTestId("save-error-banner");
    expect(toast).toHaveTextContent(/editor produced invalid markup\./i);
    // STORY-7.10 AC-8 contract preserved — the rendered toast text still
    // contains "MJML validation" via the description.
    expect(toast).toHaveTextContent(/mjml validation/i);
    // Revert button is present.
    const revertBtn = within(toast).getByRole("button", {
      name: /revert to last saved version/i,
    });
    expect(revertBtn).toBeInTheDocument();
  });

  it("clicking Revert calls editor.setComponents with the active version's MJML and dismisses the toast", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
    vi.spyOn(emailersApi, "saveVersion").mockRejectedValue(
      new emailersApi.MJMLValidationError("MJML validation failed", [])
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    const setComponentsSpy = vi.fn();
    // justified: minimal Editor mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockEditor: any = {
      UndoManager: {
        undo: vi.fn(),
        redo: vi.fn(),
        hasUndo: vi.fn().mockReturnValue(false),
        hasRedo: vi.fn().mockReturnValue(false),
      },
      on: vi.fn(),
      Commands: { add: vi.fn() },
      getSelected: vi.fn().mockReturnValue(null),
      Canvas: { getDocument: () => ({ activeElement: null }) },
      select: vi.fn(),
      getHtml: vi
        .fn()
        .mockReturnValue("<mjml><mj-body><mj-text>edited</mj-text></mj-body></mjml>"),
      setComponents: setComponentsSpy,
    };
    capturedEditorInit?.(mockEditor);

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const toast = await screen.findByTestId("save-error-banner");
    const revertBtn = within(toast).getByRole("button", {
      name: /revert to last saved version/i,
    });
    await user.click(revertBtn);

    // setComponents is called with the active version's MJML — this is
    // the canvas rollback that the spec mandates.
    expect(setComponentsSpy).toHaveBeenCalledWith(MOCK_VERSION.mjml_source);

    // The toast is gone after revert.
    await waitFor(() =>
      expect(screen.queryByTestId("save-error-banner")).not.toBeInTheDocument()
    );
  });

  it("dismisses the save-error toast when the X button is clicked", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
    vi.spyOn(emailersApi, "saveVersion").mockRejectedValue(
      new emailersApi.MJMLValidationError("MJML validation failed", [])
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    // justified: minimal Editor mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockEditor: any = {
      UndoManager: {
        undo: vi.fn(),
        redo: vi.fn(),
        hasUndo: vi.fn().mockReturnValue(false),
        hasRedo: vi.fn().mockReturnValue(false),
      },
      on: vi.fn(),
      Commands: { add: vi.fn() },
      getSelected: vi.fn().mockReturnValue(null),
      Canvas: { getDocument: () => ({ activeElement: null }) },
      select: vi.fn(),
      getHtml: vi.fn().mockReturnValue("<mjml></mjml>"),
      setComponents: vi.fn(),
    };
    capturedEditorInit?.(mockEditor);

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const toast = await screen.findByTestId("save-error-banner");
    await user.click(within(toast).getByLabelText(/dismiss/i));

    await waitFor(() =>
      expect(screen.queryByTestId("save-error-banner")).not.toBeInTheDocument()
    );
  });

  it("aborts the export when the forced Save fails and surfaces the error", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);

    vi.spyOn(emailersApi, "saveVersion").mockRejectedValue(
      new Error("Save blew up — vendor API down")
    );
    const exportSpy = vi.spyOn(emailersApi, "exportHtml");

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
    );

    // justified: minimal Editor mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockEditor: any = {
      UndoManager: {
        undo: vi.fn(),
        redo: vi.fn(),
        hasUndo: vi.fn().mockReturnValue(false),
        hasRedo: vi.fn().mockReturnValue(false),
      },
      on: vi.fn(),
      Commands: { add: vi.fn() },
      getSelected: vi.fn().mockReturnValue(null),
      Canvas: { getDocument: () => ({ activeElement: null }) },
      select: vi.fn(),
      getHtml: vi
        .fn()
        .mockReturnValue("<mjml><mj-body><mj-text>x</mj-text></mj-body></mjml>"),
    };
    capturedEditorInit?.(mockEditor);

    await user.click(screen.getByRole("button", { name: /export html/i }));

    // exportHtml must NOT be called when save fails (AC-2 — no fallback to stale HTML)
    // STORY-7.10 AC-8: the inline save-error banner also surfaces error.message
    // now (used to render a static "Save failed"), so the same text appears in
    // both the toolbar banner and the export-error region. getAllByText handles
    // the multiplicity — what we care about is that the error is visible.
    await waitFor(() =>
      expect(
        screen.getAllByText(/save blew up — vendor api down/i).length
      ).toBeGreaterThan(0)
    );
    expect(exportSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // STORY-7.8 AC-1: cost badge renders + refreshes after generate.
  // -------------------------------------------------------------------------
  function makeCostDetail(usd: number): EmailerCostDetail {
    return {
      summary: {
        emailer_id: 42,
        emailer_name: "Q4 Campaign",
        creator_email: "priya@phishforge.io",
        total_calls: usd === 0 ? 0 : 3,
        total_input_tokens: usd === 0 ? 0 : 5000,
        total_output_tokens: usd === 0 ? 0 : 2000,
        total_cache_read_tokens: usd === 0 ? 0 : 4000,
        total_cache_write_tokens: usd === 0 ? 0 : 1000,
        estimated_cost_usd: usd,
        first_call_at: usd === 0 ? null : "2026-04-25T09:00:00Z",
        last_call_at: usd === 0 ? null : "2026-04-25T09:30:00Z",
      },
      calls:
        usd === 0
          ? []
          : [
              {
                id: 1,
                stage_name: "generate",
                model: "claude-sonnet-4-6",
                input_tokens: 5000,
                output_tokens: 2000,
                cache_read_tokens: 4000,
                cache_write_tokens: 1000,
                estimated_cost_usd: usd,
                latency_ms: 1234,
                success: true,
                error_message: null,
                called_at: "2026-04-25T09:30:00Z",
              },
            ],
      total: usd === 0 ? 0 : 1,
      limit: 50,
      offset: 0,
    };
  }

  it("renders the cost badge with the formatted USD total", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
    vi.spyOn(costApi, "getEmailerCost").mockResolvedValue(makeCostDetail(0));

    renderPage();

    const badge = await screen.findByTestId("cost-badge");
    expect(badge).toBeInTheDocument();
    // Initial cost on a fresh emailer with no calls is $0.0000.
    await waitFor(() =>
      expect(screen.getByTestId("cost-badge-value")).toHaveTextContent(
        "$0.0000"
      )
    );
  });

  // -------------------------------------------------------------------------
  // STORY-8.1: auto-version every 5 minutes of active editing
  // -------------------------------------------------------------------------
  //
  // These tests use Vitest fake timers. Because userEvent v14 uses real
  // timers internally, we use the documented `advanceTimers` opt-in and
  // wrap each `vi.advanceTimersByTime` call in `act` so React Query
  // micro-tasks settle before assertions.
  //
  // Each test wires up a mock GrapesJS editor whose `on` collector lets
  // us synthesise a `component:update` event from outside the editor.
  describe("auto-save timer (STORY-8.1)", () => {
    /**
     * Build a minimal mock Editor that captures `on(eventName, fn)`
     * subscriptions in a Map, exposing a helper to fire them. The shape
     * is the same as the per-test ad-hoc mocks elsewhere in this file —
     * just hoisted here because all five auto-save tests need the same
     * listener-capture behaviour.
     */
    function makeMockEditor(getHtmlReturn = "<mjml><mj-body><mj-text>e</mj-text></mj-body></mjml>") {
      const listeners = new Map<string, Array<() => void>>();
      // justified: minimal Editor stub — full Editor type is huge
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor: any = {
        UndoManager: {
          undo: vi.fn(),
          redo: vi.fn(),
          hasUndo: vi.fn().mockReturnValue(false),
          hasRedo: vi.fn().mockReturnValue(false),
        },
        on: vi.fn((eventName: string, fn: () => void) => {
          const arr = listeners.get(eventName) ?? [];
          arr.push(fn);
          listeners.set(eventName, arr);
        }),
        off: vi.fn(),
        Commands: { add: vi.fn() },
        getSelected: vi.fn().mockReturnValue(null),
        Canvas: { getDocument: () => ({ activeElement: null }) },
        select: vi.fn(),
        getHtml: vi.fn().mockReturnValue(getHtmlReturn),
        setComponents: vi.fn(),
      };
      const fireEvent = (eventName: string) => {
        for (const fn of listeners.get(eventName) ?? []) fn();
      };
      return { editor, fireEvent };
    }

    /** Helper: drive a single GrapesJS mutation event so the dirty flag flips. */
    function markDirty(fireEvent: (eventName: string) => void) {
      // Pick the canonical event from the same set the live-preview hook
      // listens to. STORY-8.1 spec note 4: any of LIVE_PREVIEW_EVENTS sets
      // dirty.
      act(() => {
        fireEvent(LIVE_PREVIEW_EVENTS[0]); // "component:update"
      });
    }

    beforeEach(() => {
      // Ensure each test starts with the document marked visible. The
      // Page9 tests below flip this to "hidden" mid-test, so we restore
      // here for isolation.
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
    });

    /**
     * Fake-timer scope used by all auto-save tests: we ONLY fake
     * `setInterval` / `clearInterval` so React Query and userEvent —
     * both of which lean on `setTimeout` and `Date.now` — keep working.
     * The auto-save effect uses `setInterval` exclusively, so this is
     * the minimal fake-timer footprint that still lets us advance ticks.
     */
    const FAKE_TIMER_OPTS = {
      toFake: ["setInterval", "clearInterval"] as ("setInterval" | "clearInterval")[],
    };

    it("fires saveVersion after AUTO_SAVE_INTERVAL_MS of active editing", async () => {
      vi.useFakeTimers(FAKE_TIMER_OPTS);
      try {
        vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
        vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
        const saveSpy = vi
          .spyOn(emailersApi, "saveVersion")
          .mockResolvedValue({ ...MOCK_VERSION, id: 99, version_number: 2 });

        renderPage();

        await waitFor(() =>
          expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
        );

        const { editor, fireEvent } = makeMockEditor();
        act(() => {
          capturedEditorInit?.(editor);
        });

        // Simulate the user editing the canvas — this flips dirty=true.
        markDirty(fireEvent);

        // Advance fake timers by exactly one auto-save interval.
        await act(async () => {
          vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        // saveVersion was invoked exactly once with the editor's MJML.
        await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
        expect(saveSpy).toHaveBeenCalledWith(
          42,
          "<mjml><mj-body><mj-text>e</mj-text></mj-body></mjml>"
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("does NOT fire saveVersion if no edits occurred during the interval", async () => {
      vi.useFakeTimers(FAKE_TIMER_OPTS);
      try {
        vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
        vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
        const saveSpy = vi.spyOn(emailersApi, "saveVersion");

        renderPage();

        await waitFor(() =>
          expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
        );

        const { editor } = makeMockEditor();
        act(() => {
          capturedEditorInit?.(editor);
        });

        // Don't fire any mutation event — dirty stays false.
        await act(async () => {
          vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        // No save should have been issued.
        expect(saveSpy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does NOT double-fire while a save is already in-flight", async () => {
      vi.useFakeTimers(FAKE_TIMER_OPTS);
      try {
        vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
        vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
        // Never-resolving save — keeps the mutation in `isPending=true`.
        const saveSpy = vi.spyOn(emailersApi, "saveVersion").mockReturnValue(
          new Promise(() => {
            // intentionally pending forever
          })
        );

        renderPage();

        await waitFor(() =>
          expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
        );

        const { editor, fireEvent } = makeMockEditor();
        act(() => {
          capturedEditorInit?.(editor);
        });

        markDirty(fireEvent);

        // First tick — fires the (never-resolving) save.
        await act(async () => {
          vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });
        await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));

        // Re-arm the dirty flag for the second tick. (Even if dirty
        // stayed sticky, the in-flight guard alone should hold.)
        markDirty(fireEvent);

        // Second tick — must be a no-op because save is still pending.
        await act(async () => {
          vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        expect(saveSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("suspends on document.visibilitychange to hidden and resumes on show", async () => {
      vi.useFakeTimers(FAKE_TIMER_OPTS);
      try {
        vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
        vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
        const saveSpy = vi
          .spyOn(emailersApi, "saveVersion")
          .mockResolvedValue({ ...MOCK_VERSION, id: 99, version_number: 2 });

        renderPage();

        await waitFor(() =>
          expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
        );

        const { editor, fireEvent } = makeMockEditor();
        act(() => {
          capturedEditorInit?.(editor);
        });

        // Edit, then hide the tab BEFORE the interval elapses.
        markDirty(fireEvent);
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });

        // Advance a full interval while hidden — no save should fire.
        await act(async () => {
          vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });
        expect(saveSpy).not.toHaveBeenCalled();

        // Bring the tab back. Per spec note 3, the timer re-arms and
        // waits another full interval (it does not fire immediately).
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => false,
        });
        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });

        // Tiny advance: still no save (cools-down period).
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
        expect(saveSpy).not.toHaveBeenCalled();

        // Full interval after show — save fires once.
        await act(async () => {
          vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });
        await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
      } finally {
        vi.useRealTimers();
      }
    });

    it("cleans up the interval on unmount (no leaked saves)", async () => {
      vi.useFakeTimers(FAKE_TIMER_OPTS);
      try {
        vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
        vi.spyOn(emailersApi, "getLatestVersion").mockResolvedValue(MOCK_VERSION);
        const saveSpy = vi.spyOn(emailersApi, "saveVersion");

        const { unmount } = renderPage();

        await waitFor(() =>
          expect(screen.getByTestId("grapes-editor")).toBeInTheDocument()
        );

        const { editor, fireEvent } = makeMockEditor();
        act(() => {
          capturedEditorInit?.(editor);
        });

        markDirty(fireEvent);

        // Unmount before the first tick.
        unmount();

        // Advance well past two intervals — no saves should fire because
        // the interval was cleared on unmount.
        await act(async () => {
          vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS * 2);
        });

        expect(saveSpy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("refreshes the cost badge after a successful generate", async () => {
    vi.spyOn(emailersApi, "getEmailer").mockResolvedValue(MOCK_EMAILER);
    vi.spyOn(emailersApi, "getLatestVersion").mockRejectedValue(
      new Error("Not found")
    );
    vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(MOCK_GENERATE);

    // First fetch: $0.0000. Second (after generate invalidation): $0.0234.
    const costSpy = vi
      .spyOn(costApi, "getEmailerCost")
      .mockResolvedValueOnce(makeCostDetail(0))
      .mockResolvedValue(makeCostDetail(0.0234));

    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("cost-badge-value")).toHaveTextContent(
        "$0.0000"
      )
    );

    await user.click(screen.getByRole("button", { name: /generate/i }));

    // The query is invalidated in onSuccess; await the badge picking up
    // the new value.
    await waitFor(() =>
      expect(screen.getByTestId("cost-badge-value")).toHaveTextContent(
        "$0.0234"
      )
    );
    // Sanity: the cost endpoint was hit at least twice.
    expect(costSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
