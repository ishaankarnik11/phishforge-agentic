import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ShareLinkDialog from "./ShareLinkDialog";
import * as previewApi from "../../api/previewLinks";
import type { PreviewLinkRead } from "../../api/previewLinks";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_LINK_A: PreviewLinkRead = {
  token: "aaa",
  url: "http://localhost:5173/share/aaa",
  emailer_id: 1,
  version_id: null,
  expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-04-25T00:00:00Z",
};

const MOCK_LINK_B: PreviewLinkRead = {
  token: "bbb",
  url: "http://localhost:5173/share/bbb",
  emailer_id: 1,
  version_id: 42,
  expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-04-25T00:00:00Z",
};

const MOCK_NEW_LINK: PreviewLinkRead = {
  token: "newtok",
  url: "http://localhost:5173/share/newtok",
  emailer_id: 1,
  version_id: null,
  expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-04-25T00:00:00Z",
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof ShareLinkDialog>> = {}
) {
  const client = makeQueryClient();
  const props = {
    emailerId: 1,
    currentVersionId: 42 as number | null,
    onClose: vi.fn(),
    ...overrides,
  };

  const result = render(
    <QueryClientProvider client={client}>
      <ShareLinkDialog {...props} />
    </QueryClientProvider>
  );

  return { ...result, ...props };
}

// ---------------------------------------------------------------------------
// Setup
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ShareLinkDialog", () => {
  it("renders existing active links", async () => {
    vi.spyOn(previewApi, "listPreviewLinks").mockResolvedValue([
      MOCK_LINK_A,
      MOCK_LINK_B,
    ]);

    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("preview-links-list")).toBeInTheDocument()
    );
    expect(screen.getByTestId(`preview-link-${MOCK_LINK_A.token}`)).toBeInTheDocument();
    expect(screen.getByTestId(`preview-link-${MOCK_LINK_B.token}`)).toBeInTheDocument();
    // B is pinned -> shows the pinned hint
    expect(screen.getByText(/pinned to a specific version/i)).toBeInTheDocument();
  });

  it("creates a new link with the selected expiry and version pinning", async () => {
    vi.spyOn(previewApi, "listPreviewLinks").mockResolvedValue([]);
    const createSpy = vi
      .spyOn(previewApi, "createPreviewLink")
      .mockResolvedValue(MOCK_NEW_LINK);

    const user = userEvent.setup();
    renderDialog({ currentVersionId: 42 });

    // Default expiry is 7, switch to 14
    const expirySelect = screen.getByLabelText(/expires after/i);
    await user.selectOptions(expirySelect, "14");

    // Tick "Pin to current version"
    const pinCheckbox = screen.getByLabelText(/pin to current version/i, {
      selector: "input",
    });
    await user.click(pinCheckbox);

    await user.click(screen.getByRole("button", { name: /create link/i }));

    await waitFor(() =>
      expect(screen.getByTestId("share-link-created")).toBeInTheDocument()
    );

    expect(createSpy).toHaveBeenCalledWith(1, {
      expires_in_days: 14,
      version_id: 42,
    });

    // The new URL is displayed
    const input = screen.getByLabelText(
      /created preview url/i
    ) as HTMLInputElement;
    expect(input.value).toBe(MOCK_NEW_LINK.url);
  });

  it("sends null version_id when the pin checkbox is unchecked", async () => {
    vi.spyOn(previewApi, "listPreviewLinks").mockResolvedValue([]);
    const createSpy = vi
      .spyOn(previewApi, "createPreviewLink")
      .mockResolvedValue(MOCK_NEW_LINK);

    const user = userEvent.setup();
    renderDialog({ currentVersionId: 42 });

    await user.click(screen.getByRole("button", { name: /create link/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(createSpy).toHaveBeenCalledWith(1, {
      expires_in_days: 7,
      version_id: null,
    });
  });

  it("disables the pin checkbox when no version is loaded yet", async () => {
    vi.spyOn(previewApi, "listPreviewLinks").mockResolvedValue([]);

    renderDialog({ currentVersionId: null });

    const pinCheckbox = screen.getByLabelText(/pin to current version/i, {
      selector: "input",
    });
    expect(pinCheckbox).toBeDisabled();
  });

  it("copies the created URL to the clipboard", async () => {
    // Freshly install the clipboard spy for this test -- the afterEach
    // hook below restores mocks which can detach older spies.
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeSpy },
      configurable: true,
      writable: true,
    });

    vi.spyOn(previewApi, "listPreviewLinks").mockResolvedValue([]);
    vi.spyOn(previewApi, "createPreviewLink").mockResolvedValue(
      MOCK_NEW_LINK
    );

    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /create link/i }));
    await waitFor(() =>
      expect(screen.getByTestId("share-link-created")).toBeInTheDocument()
    );

    // Inside the "Link created" block there's a Copy button.
    // Use fireEvent.click -- userEvent.click sometimes has timing issues
    // with micro-tasks that fire async clipboard writes.
    const createdBlock = screen.getByTestId("share-link-created");
    const copyBtn = await screen.findByRole("button", { name: /^copy$/i });
    expect(createdBlock).toContainElement(copyBtn);
    fireEvent.click(copyBtn);

    await waitFor(() =>
      expect(writeSpy).toHaveBeenCalledWith(MOCK_NEW_LINK.url)
    );
    // Badge flips to "Copied!"
    await waitFor(() =>
      expect(createdBlock).toHaveTextContent(/Copied!/)
    );
  });

  it("revokes a link from the list and refreshes", async () => {
    const listSpy = vi
      .spyOn(previewApi, "listPreviewLinks")
      .mockResolvedValueOnce([MOCK_LINK_A, MOCK_LINK_B])
      .mockResolvedValue([MOCK_LINK_B]);

    const revokeSpy = vi
      .spyOn(previewApi, "revokePreviewLink")
      .mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderDialog();

    await waitFor(() =>
      expect(
        screen.getByTestId(`preview-link-${MOCK_LINK_A.token}`)
      ).toBeInTheDocument()
    );

    await user.click(
      screen.getByRole("button", {
        name: `Revoke preview link ${MOCK_LINK_A.token}`,
      })
    );

    await waitFor(() =>
      expect(revokeSpy).toHaveBeenCalledWith(1, MOCK_LINK_A.token)
    );

    // After revoke, the list refetches (the mock returns only LINK_B).
    await waitFor(() =>
      expect(
        screen.queryByTestId(`preview-link-${MOCK_LINK_A.token}`)
      ).toBeNull()
    );
    expect(
      screen.getByTestId(`preview-link-${MOCK_LINK_B.token}`)
    ).toBeInTheDocument();

    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it("calls onClose when the Done button is clicked", async () => {
    vi.spyOn(previewApi, "listPreviewLinks").mockResolvedValue([]);

    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByRole("button", { name: /^done$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the X button is clicked", async () => {
    vi.spyOn(previewApi, "listPreviewLinks").mockResolvedValue([]);

    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByLabelText(/close share dialog/i));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
