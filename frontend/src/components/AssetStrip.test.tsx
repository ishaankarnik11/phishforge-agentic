import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AssetStrip from "./AssetStrip";
import * as assetsApi from "../api/assets";
import type { AssetRead } from "../api/assets";

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

function renderStrip(emailerId = 7) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AssetStrip emailerId={emailerId} />
    </QueryClientProvider>
  );
}

const ASSET_A: AssetRead = {
  id: "asset-a",
  emailer_id: 7,
  filename: "hero.png",
  label: "Hero",
  mime_type: "image/png",
  size_bytes: 1024,
  url: "http://localhost:8000/assets/7/hero.png",
  uploaded_at: "2026-04-25T00:00:00Z",
  kind: "content",
};

const ASSET_B: AssetRead = {
  id: "asset-b",
  emailer_id: 7,
  filename: "logo.svg",
  label: "Logo",
  mime_type: "image/svg+xml",
  size_bytes: 512,
  url: "http://localhost:8000/assets/7/logo.svg",
  uploaded_at: "2026-04-25T00:01:00Z",
  kind: "content",
};

// ---------------------------------------------------------------------------
// Tests — STORY-2.6 AC-8 (read-only asset strip in editor left pane)
// ---------------------------------------------------------------------------

describe("AssetStrip", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders thumbnails with their src + label for each asset", async () => {
    vi.spyOn(assetsApi, "listAssets").mockResolvedValue([ASSET_A, ASSET_B]);

    renderStrip();

    // Wait for the list to render.
    const list = await screen.findByRole("list", { name: /emailer assets/i });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    // Each tile renders an <img> with the canonical src (the AssetStrip
    // wires the api URL straight onto the thumbnail) and an aria-label
    // that describes the click-to-copy action with the asset label.
    const heroImg = within(items[0]).getByAltText("Hero");
    expect(heroImg).toHaveAttribute("src", ASSET_A.url);
    const logoImg = within(items[1]).getByAltText("Logo");
    expect(logoImg).toHaveAttribute("src", ASSET_B.url);

    // The labels are rendered as visible text on each tile.
    expect(within(items[0]).getByText("Hero")).toBeInTheDocument();
    expect(within(items[1]).getByText("Logo")).toBeInTheDocument();
  });

  it("copies the asset URL to the clipboard when a thumbnail is clicked", async () => {
    vi.spyOn(assetsApi, "listAssets").mockResolvedValue([ASSET_A]);

    // userEvent.setup() installs its own clipboard stub on navigator;
    // we set it up first, then override `writeText` on the resulting
    // clipboard object so our spy is the one that fires.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      writable: true,
      value: writeText,
    });

    renderStrip();

    const tileButton = await screen.findByRole("button", {
      name: /copy url for hero/i,
    });
    await user.click(tileButton);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(ASSET_A.url)
    );

    // After the copy, the tile text flips to "Copied!" for ~1.5s.
    expect(await screen.findByText(/copied!/i)).toBeInTheDocument();
  });
});
