import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPreviewLink,
  listPreviewLinks,
  revokePreviewLink,
  getPublicPreview,
  submitPublicSuggestion,
  PreviewNotFoundError,
} from "./previewLinks";
import type {
  PreviewLinkRead,
  PublicPreviewPayload,
  SuggestionRead,
} from "./previewLinks";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_TOKEN = "test-jwt-token";

const MOCK_LINK: PreviewLinkRead = {
  token: "abc123",
  url: "http://localhost:5173/share/abc123",
  emailer_id: 1,
  version_id: null,
  expires_at: "2026-05-02T00:00:00Z",
  created_at: "2026-04-25T00:00:00Z",
};

const MOCK_PUBLIC: PublicPreviewPayload = {
  emailer_name: "Q4 Campaign",
  identity: {
    name: "Contoso IT",
    primary_color: "#004C8F",
    logo_url: "https://example.com/logo.png",
  },
  version_id: 10,
  version_number: 3,
  subject_line: "Test Subject",
  preheader: "Test Preheader",
  compiled_html: "<html><body>hi</body></html>",
  expires_at: "2026-05-02T00:00:00Z",
};

const MOCK_SUGGESTION: SuggestionRead = {
  id: 42,
  emailer_id: 1,
  version_id: 10,
  role: "suggestion",
  content: "[Suggestion from Alice]: Looks great",
  created_at: "2026-04-25T01:00:00Z",
};

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  });
}

function mockFetchStatus(
  ok: boolean,
  status: number,
  body: string | unknown = ""
) {
  const isJson = typeof body !== "string";
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: "Error",
    text: () => Promise.resolve(isJson ? "" : (body as string)),
    json: () => Promise.resolve(isJson ? body : undefined),
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn().mockReturnValue(MOCK_TOKEN),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// createPreviewLink
// ---------------------------------------------------------------------------

describe("createPreviewLink", () => {
  it("POSTs with Bearer auth and returns the link", async () => {
    const fetchMock = mockFetchOk(MOCK_LINK);
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPreviewLink(1, {
      expires_in_days: 14,
      version_id: 99,
    });

    expect(result).toEqual(MOCK_LINK);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/preview-links",
      {
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ expires_in_days: 14, version_id: 99 }),
      }
    );
  });

  it("defaults to empty body when none is provided", async () => {
    const fetchMock = mockFetchOk(MOCK_LINK);
    vi.stubGlobal("fetch", fetchMock);

    await createPreviewLink(1);

    const callArgs = fetchMock.mock.calls[0][1];
    expect(callArgs.body).toBe("{}");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(false, 400, "Bad version_id"));
    await expect(createPreviewLink(1)).rejects.toThrow("Bad version_id");
  });
});

// ---------------------------------------------------------------------------
// listPreviewLinks
// ---------------------------------------------------------------------------

describe("listPreviewLinks", () => {
  it("fetches with Bearer auth", async () => {
    const fetchMock = mockFetchOk([MOCK_LINK]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listPreviewLinks(1);

    expect(result).toEqual([MOCK_LINK]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/preview-links",
      {
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }
    );
  });
});

// ---------------------------------------------------------------------------
// revokePreviewLink
// ---------------------------------------------------------------------------

describe("revokePreviewLink", () => {
  it("sends DELETE with Bearer auth and URL-encodes the token", async () => {
    const fetchMock = mockFetchStatus(true, 204);
    vi.stubGlobal("fetch", fetchMock);

    await revokePreviewLink(7, "abc/123");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/7/preview-links/abc%2F123",
      {
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(false, 404, "Not found"));
    await expect(revokePreviewLink(1, "x")).rejects.toThrow("Not found");
  });
});

// ---------------------------------------------------------------------------
// getPublicPreview
// ---------------------------------------------------------------------------

describe("getPublicPreview", () => {
  it("fetches WITHOUT a Bearer token", async () => {
    const fetchMock = mockFetchOk(MOCK_PUBLIC);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPublicPreview("abc123");

    expect(result).toEqual(MOCK_PUBLIC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/public/preview/abc123");
    // No Authorization header.
    expect(options.headers).not.toHaveProperty("Authorization");
  });

  it("throws PreviewNotFoundError on 404", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchStatus(false, 404, "Preview link not found")
    );

    await expect(getPublicPreview("bad")).rejects.toBeInstanceOf(
      PreviewNotFoundError
    );
  });

  it("URL-encodes the token", async () => {
    const fetchMock = mockFetchOk(MOCK_PUBLIC);
    vi.stubGlobal("fetch", fetchMock);

    await getPublicPreview("a b/c");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/public/preview/a%20b%2Fc"
    );
  });
});

// ---------------------------------------------------------------------------
// submitPublicSuggestion
// ---------------------------------------------------------------------------

describe("submitPublicSuggestion", () => {
  it("POSTs without Bearer and returns the echo", async () => {
    const fetchMock = mockFetchOk(MOCK_SUGGESTION);
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitPublicSuggestion("abc123", {
      text: "Looks great",
      reviewer_name: "Alice",
    });

    expect(result).toEqual(MOCK_SUGGESTION);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/public/preview/abc123/suggest");
    expect(options.method).toBe("POST");
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.body).toBe(
      JSON.stringify({ text: "Looks great", reviewer_name: "Alice" })
    );
  });

  it("throws PreviewNotFoundError on 404", async () => {
    vi.stubGlobal("fetch", mockFetchStatus(false, 404, "not found"));

    await expect(
      submitPublicSuggestion("bad", { text: "hi" })
    ).rejects.toBeInstanceOf(PreviewNotFoundError);
  });
});
