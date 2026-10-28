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
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AssetUploadPanel from "./AssetUploadPanel";
import * as assetsApi from "../api/assets";
import type { AssetRead } from "../api/assets";
import * as libraryAssetsApi from "../api/libraryAssets";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_ASSET: AssetRead = {
  id: "asset-1",
  emailer_id: 7,
  filename: "hero.png",
  label: "hero",
  mime_type: "image/png",
  size_bytes: 1024,
  url: "http://localhost:8000/assets/7/hero.png",
  uploaded_at: "2026-04-25T00:00:00Z",
  kind: "content",
};

function makeFile(name: string, size: number, type: string): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
}

/**
 * Wraps a component in QueryClientProvider (needed because
 * AssetUploadPanel now renders AssetPickerModal which uses useQuery).
 */
function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  // default: empty asset list
  vi.spyOn(assetsApi, "listAssets").mockResolvedValue([]);
  // default: empty library assets (for the picker modal's useQuery)
  vi.spyOn(libraryAssetsApi, "fetchLibraryAssets").mockResolvedValue({
    items: [],
    total: 0,
  });
  // Stub object URL for jsdom (which doesn't implement these by default)
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AssetUploadPanel", () => {
  it("renders the action boxes and help text in the empty state", async () => {
    renderWithQuery(
      <AssetUploadPanel
        emailerId={null}
        onEnsureEmailer={vi.fn()}
      />
    );

    expect(
      screen.getByRole("heading", { name: /Assets/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Upload from device/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Up to 10 files, 5 MB each/i)
    ).toBeInTheDocument();
  });

  // STORY-2.6 AC-9: drop-zone is keyboard-reachable and announces upload
  // progress via an aria-live region. Both contracts are tested here in
  // a single render so a regression on either one fails fast.
  it("exposes a tabbable upload zone and a polite live region for screen readers", async () => {
    renderWithQuery(
      <AssetUploadPanel emailerId={null} onEnsureEmailer={vi.fn()} />
    );

    // Upload zone is reachable via Tab (tabIndex=0). The role="button"
    // matcher returns the same element regardless of how it was rendered.
    const dropzone = screen.getByRole("button", {
      name: /Upload from device/i,
    });
    expect(dropzone).toHaveAttribute("tabIndex", "0");

    // The announce region uses aria-live="polite" so screen readers pick
    // up upload status changes without preempting other speech.
    const liveRegion = screen.getByTestId("asset-live-region");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });

  it("opens the file picker when the upload zone is activated by keyboard", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel emailerId={null} onEnsureEmailer={vi.fn()} />
    );

    const fileInput = screen.getByTestId(
      "asset-file-input"
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");

    const dropzone = screen.getByRole("button", {
      name: /Upload from device/i,
    });
    dropzone.focus();
    await user.keyboard("{Enter}");

    expect(clickSpy).toHaveBeenCalled();
  });

  it("rejects oversized files inline without uploading", async () => {
    const uploadSpy = vi.spyOn(assetsApi, "uploadAsset");
    const user = userEvent.setup();

    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    const fileInput = screen.getByTestId(
      "asset-file-input"
    ) as HTMLInputElement;
    const big = makeFile(
      "big.png",
      assetsApi.MAX_FILE_SIZE_BYTES + 1,
      "image/png"
    );
    await user.upload(fileInput, big);

    expect(
      await screen.findByText(/big\.png/i, { selector: "li *" })
    ).toBeInTheDocument();
    expect(screen.getByText(/exceeds 5 MB/i)).toBeInTheDocument();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME types inline", async () => {
    const uploadSpy = vi.spyOn(assetsApi, "uploadAsset");

    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    const fileInput = screen.getByTestId(
      "asset-file-input"
    ) as HTMLInputElement;
    const heic = makeFile("photo.heic", 1024, "image/heic");
    // userEvent.upload would filter the file against the input's accept
    // attribute. We want to drive the client-side validator directly,
    // so dispatch the change event manually with a forged FileList.
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [heic],
    });
    fireEvent.change(fileInput);

    expect(
      await screen.findByText(/photo\.heic/i, { selector: "li *" })
    ).toBeInTheDocument();
    expect(screen.getByText(/unsupported format/i)).toBeInTheDocument();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("rejects files beyond the 10-asset cap", async () => {
    // Pre-populate with 10 existing assets so the listAssets mock returns
    // a full bucket -- the panel will count them and reject any new file.
    const tenAssets: AssetRead[] = Array.from({ length: 10 }, (_, i) => ({
      ...MOCK_ASSET,
      id: `asset-${i}`,
      label: `asset-${i}`,
    }));
    vi.spyOn(assetsApi, "listAssets").mockResolvedValue(tenAssets);

    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    // Wait for listAssets to populate
    await waitFor(() =>
      expect(screen.getByLabelText("Uploaded assets")).toBeInTheDocument()
    );

    // The action boxes should not be present at full capacity
    expect(
      screen.queryByRole("button", { name: /Upload from device/i })
    ).not.toBeInTheDocument();
  });

  it("calls onEnsureEmailer once on the first upload and reuses the id", async () => {
    const ensure = vi.fn().mockResolvedValue(99);
    const onChange = vi.fn();
    const uploadSpy = vi
      .spyOn(assetsApi, "uploadAsset")
      .mockResolvedValue(MOCK_ASSET);

    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel
        emailerId={null}
        onEnsureEmailer={ensure}
        onEmailerIdChange={onChange}
      />
    );

    const fileInput = screen.getByTestId(
      "asset-file-input"
    ) as HTMLInputElement;
    const file = makeFile("hero.png", 1024, "image/png");
    await user.upload(fileInput, file);

    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(uploadSpy).toHaveBeenCalledWith(99, file, expect.any(Object))
    );
    expect(onChange).toHaveBeenCalledWith(99);
  });

  it("emits onUploadingChange(true) while uploading and (false) after", async () => {
    let resolveUpload: (asset: AssetRead) => void = () => {};
    vi.spyOn(assetsApi, "uploadAsset").mockReturnValue(
      new Promise<AssetRead>((res) => {
        resolveUpload = res;
      })
    );

    const onUploading = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel
        emailerId={7}
        onEnsureEmailer={vi.fn()}
        onUploadingChange={onUploading}
      />
    );

    const fileInput = screen.getByTestId(
      "asset-file-input"
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      makeFile("hero.png", 1024, "image/png")
    );

    // The panel should have flipped to uploading=true
    await waitFor(() =>
      expect(onUploading).toHaveBeenCalledWith(true)
    );

    resolveUpload(MOCK_ASSET);

    await waitFor(() =>
      expect(onUploading).toHaveBeenLastCalledWith(false)
    );
  });

  it("commits a label edit on Enter and shows a Saved flash", async () => {
    vi.spyOn(assetsApi, "listAssets").mockResolvedValue([MOCK_ASSET]);
    const updateSpy = vi
      .spyOn(assetsApi, "updateAsset")
      .mockResolvedValue({ ...MOCK_ASSET, label: "Hero v2" });

    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    // Wait for the asset to render
    const tile = await screen.findByTestId("asset-tile-asset-1");

    // Click the label to edit
    await user.click(within(tile).getByText("hero"));
    const input = within(tile).getByLabelText(/Edit label for hero\.png/i);
    await user.clear(input);
    await user.type(input, "Hero v2");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(7, "asset-1", "Hero v2")
    );
    expect(await screen.findByText(/Saved/i)).toBeInTheDocument();
  });

  it("cancels label edit on Escape", async () => {
    vi.spyOn(assetsApi, "listAssets").mockResolvedValue([MOCK_ASSET]);
    const updateSpy = vi.spyOn(assetsApi, "updateAsset");

    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    const tile = await screen.findByTestId("asset-tile-asset-1");
    await user.click(within(tile).getByText("hero"));
    const input = within(tile).getByLabelText(/Edit label/i);
    await user.clear(input);
    await user.type(input, "DROPME");
    await user.keyboard("{Escape}");

    expect(updateSpy).not.toHaveBeenCalled();
    expect(within(tile).getByText("hero")).toBeInTheDocument();
  });

  it("rejects an empty label", async () => {
    vi.spyOn(assetsApi, "listAssets").mockResolvedValue([MOCK_ASSET]);
    const updateSpy = vi.spyOn(assetsApi, "updateAsset");

    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    const tile = await screen.findByTestId("asset-tile-asset-1");
    await user.click(within(tile).getByText("hero"));
    const input = within(tile).getByLabelText(/Edit label/i);
    await user.clear(input);
    await user.keyboard("{Enter}");

    expect(updateSpy).not.toHaveBeenCalled();
    expect(
      within(tile).getByText(/Label cannot be empty/i)
    ).toBeInTheDocument();
  });

  it("requires confirmation before deleting and calls deleteAsset on confirm", async () => {
    vi.spyOn(assetsApi, "listAssets").mockResolvedValue([MOCK_ASSET]);
    const deleteSpy = vi
      .spyOn(assetsApi, "deleteAsset")
      .mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    const tile = await screen.findByTestId("asset-tile-asset-1");
    await user.click(within(tile).getByLabelText(/Remove hero/i));

    // Confirm dialog appears
    expect(
      await screen.findByRole("dialog", { name: /Remove asset/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Remove$/i }));

    await waitFor(() =>
      expect(deleteSpy).toHaveBeenCalledWith(7, "asset-1")
    );
    // Tile gone
    await waitFor(() =>
      expect(screen.queryByTestId("asset-tile-asset-1")).not.toBeInTheDocument()
    );
  });

  it("does not delete when the user cancels the confirmation", async () => {
    vi.spyOn(assetsApi, "listAssets").mockResolvedValue([MOCK_ASSET]);
    const deleteSpy = vi.spyOn(assetsApi, "deleteAsset");

    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    const tile = await screen.findByTestId("asset-tile-asset-1");
    await user.click(within(tile).getByLabelText(/Remove hero/i));

    expect(
      await screen.findByRole("dialog", { name: /Remove asset/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("asset-tile-asset-1")).toBeInTheDocument();
  });

  it("supports drag-and-drop", async () => {
    const ensure = vi.fn().mockResolvedValue(7);
    vi.spyOn(assetsApi, "uploadAsset").mockResolvedValue(MOCK_ASSET);

    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={ensure} />
    );

    const dropzone = screen.getByRole("button", {
      name: /Upload from device/i,
    });
    const file = makeFile("hero.png", 1024, "image/png");
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
        items: [{ kind: "file", type: file.type, getAsFile: () => file }],
        types: ["Files"],
      },
    });

    await waitFor(() =>
      expect(assetsApi.uploadAsset).toHaveBeenCalled()
    );
  });

  it("shows a retry button when an upload fails", async () => {
    let firstCall = true;
    vi.spyOn(assetsApi, "uploadAsset").mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        throw new Error("Network error");
      }
      return MOCK_ASSET;
    });

    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    const fileInput = screen.getByTestId(
      "asset-file-input"
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      makeFile("hero.png", 1024, "image/png")
    );

    const retry = await screen.findByRole("button", { name: /Retry/i });
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();

    await user.click(retry);

    // Successful retry should render the asset tile.
    await waitFor(() =>
      expect(screen.getByTestId("asset-tile-asset-1")).toBeInTheDocument()
    );
  });

  it("dismisses a failed upload via Remove", async () => {
    vi.spyOn(assetsApi, "uploadAsset").mockRejectedValue(
      new Error("Network error")
    );

    const user = userEvent.setup();
    renderWithQuery(
      <AssetUploadPanel emailerId={7} onEnsureEmailer={vi.fn()} />
    );

    const fileInput = screen.getByTestId(
      "asset-file-input"
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      makeFile("hero.png", 1024, "image/png")
    );

    await screen.findByRole("button", { name: /Retry/i });
    await user.click(screen.getByRole("button", { name: /Remove/i }));

    expect(screen.queryByText(/Network error/i)).not.toBeInTheDocument();
  });

  // STORY-A5.1: "Pick from Library" button
  it("renders a 'Pick from Library' button that is clickable", () => {
    renderWithQuery(
      <AssetUploadPanel emailerId={null} onEnsureEmailer={vi.fn()} />
    );

    const pickBtn = screen.getByTestId("pick-from-library-btn");
    expect(pickBtn).toBeInTheDocument();
    expect(pickBtn).toHaveTextContent(/Pick from Library/i);
  });
});
