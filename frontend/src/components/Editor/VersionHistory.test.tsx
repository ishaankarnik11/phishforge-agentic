import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import VersionHistory from "./VersionHistory";
import * as emailersApi from "../../api/emailers";
import type {
  EmailerVersionSummary,
  EmailerVersionRead,
} from "../../api/emailers";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_VERSIONS: EmailerVersionSummary[] = [
  {
    id: 3,
    version_number: 3,
    subject_line: "Final Campaign v3",
    created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 min ago
  },
  {
    id: 2,
    version_number: 2,
    subject_line: "Updated Subject",
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
  },
  {
    id: 1,
    version_number: 1,
    subject_line: null,
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3d ago
  },
];

const MOCK_FULL_VERSION: EmailerVersionRead = {
  id: 2,
  emailer_id: 42,
  version_number: 2,
  mjml_source: "<mjml><mj-body>v2 content</mj-body></mjml>",
  compiled_html: "<html><body>v2</body></html>",
  subject_line: "Updated Subject",
  preheader: "Preheader",
  model_used: "claude-sonnet-4-20250514",
  input_tokens: 500,
  output_tokens: 1000,
  created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
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

function renderVersionHistory(
  overrides: Partial<React.ComponentProps<typeof VersionHistory>> = {}
) {
  const client = makeQueryClient();
  const defaultProps = {
    emailerId: 42,
    activeVersionNumber: 3,
    onPreview: vi.fn(),
    onRestore: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };

  const result = render(
    <QueryClientProvider client={client}>
      <VersionHistory {...defaultProps} />
    </QueryClientProvider>
  );

  return { ...result, ...defaultProps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn().mockReturnValue("test-token"),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VersionHistory", () => {
  // -------------------------------------------------------------------------
  // 1. Loading state
  // -------------------------------------------------------------------------
  it("shows loading state while fetching versions", () => {
    vi.spyOn(emailersApi, "listVersions").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    renderVersionHistory();

    expect(screen.getByText(/loading versions/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Error state
  // -------------------------------------------------------------------------
  it("shows error state when fetch fails", async () => {
    vi.spyOn(emailersApi, "listVersions").mockRejectedValue(
      new Error("Network error")
    );

    renderVersionHistory();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/failed to load versions/i);
  });

  // -------------------------------------------------------------------------
  // 3. Empty state
  // -------------------------------------------------------------------------
  it("shows empty state when no versions exist", async () => {
    vi.spyOn(emailersApi, "listVersions").mockResolvedValue([]);

    renderVersionHistory();

    await waitFor(() =>
      expect(screen.getByText(/no versions yet/i)).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // 4. Renders version list
  // -------------------------------------------------------------------------
  it("renders version list with badges, timestamps, and subject lines", async () => {
    vi.spyOn(emailersApi, "listVersions").mockResolvedValue(MOCK_VERSIONS);

    renderVersionHistory();

    // Wait for the version items to render
    await waitFor(() =>
      expect(screen.getByText("v3")).toBeInTheDocument()
    );

    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();

    // Subject lines
    expect(screen.getByText("Final Campaign v3")).toBeInTheDocument();
    expect(screen.getByText("Updated Subject")).toBeInTheDocument();

    // Relative timestamps
    expect(screen.getByText("2 min ago")).toBeInTheDocument();
    expect(screen.getByText("1h ago")).toBeInTheDocument();
    expect(screen.getByText("3d ago")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 5. Highlights active version
  // -------------------------------------------------------------------------
  it("highlights the currently active version with 'Current' label", async () => {
    vi.spyOn(emailersApi, "listVersions").mockResolvedValue(MOCK_VERSIONS);

    renderVersionHistory({ activeVersionNumber: 3 });

    await waitFor(() =>
      expect(screen.getByText("Current")).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // 6. No Restore button on active version
  // -------------------------------------------------------------------------
  it("does not show Restore button on the active version", async () => {
    vi.spyOn(emailersApi, "listVersions").mockResolvedValue(MOCK_VERSIONS);

    renderVersionHistory({ activeVersionNumber: 3 });

    await waitFor(() =>
      expect(screen.getByText("v3")).toBeInTheDocument()
    );

    // There should be 2 Restore buttons (for v2 and v1), not 3
    const restoreButtons = screen.getAllByRole("button", { name: /restore/i });
    expect(restoreButtons).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 7. Preview click fetches full version and calls onPreview
  // -------------------------------------------------------------------------
  it("fetches full version and calls onPreview when Preview is clicked", async () => {
    vi.spyOn(emailersApi, "listVersions").mockResolvedValue(MOCK_VERSIONS);
    vi.spyOn(emailersApi, "getVersion").mockResolvedValue(MOCK_FULL_VERSION);

    const user = userEvent.setup();
    const { onPreview } = renderVersionHistory();

    await waitFor(() =>
      expect(screen.getByText("v2")).toBeInTheDocument()
    );

    // Click the preview button for v2 (second preview button)
    const previewButtons = screen.getAllByRole("button", { name: /^preview$/i });
    // v3's Preview is first, v2's Preview is second
    await user.click(previewButtons[1]);

    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith(MOCK_FULL_VERSION)
    );

    expect(emailersApi.getVersion).toHaveBeenCalledWith(42, 2);
  });

  // -------------------------------------------------------------------------
  // 8. Restore click fetches full version and calls onRestore
  // -------------------------------------------------------------------------
  it("fetches full version and calls onRestore when Restore is clicked", async () => {
    vi.spyOn(emailersApi, "listVersions").mockResolvedValue(MOCK_VERSIONS);
    vi.spyOn(emailersApi, "getVersion").mockResolvedValue(MOCK_FULL_VERSION);

    const user = userEvent.setup();
    const { onRestore } = renderVersionHistory();

    await waitFor(() =>
      expect(screen.getByText("v2")).toBeInTheDocument()
    );

    // Click restore on v2 (first restore button since v3 is active and has no restore)
    const restoreButtons = screen.getAllByRole("button", { name: /restore/i });
    await user.click(restoreButtons[0]);

    await waitFor(() =>
      expect(onRestore).toHaveBeenCalledWith(MOCK_FULL_VERSION)
    );
  });

  // -------------------------------------------------------------------------
  // 9. Close button calls onClose
  // -------------------------------------------------------------------------
  it("calls onClose when close button is clicked", async () => {
    vi.spyOn(emailersApi, "listVersions").mockResolvedValue(MOCK_VERSIONS);

    const user = userEvent.setup();
    const { onClose } = renderVersionHistory();

    const closeBtn = screen.getByLabelText(/close version history/i);
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 10. Header is present
  // -------------------------------------------------------------------------
  it("displays the 'Version History' heading", async () => {
    vi.spyOn(emailersApi, "listVersions").mockResolvedValue(MOCK_VERSIONS);

    renderVersionHistory();

    expect(screen.getByText("Version History")).toBeInTheDocument();
  });
});
