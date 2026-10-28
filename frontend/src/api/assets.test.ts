import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  MAX_ASSETS_PER_EMAILER,
  MAX_FILE_SIZE_BYTES,
  deleteAsset,
  listAssets,
  updateAsset,
  uploadAsset,
  validateFiles,
  type AssetRead,
} from "./assets";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const MOCK_TOKEN = "test-jwt-token";

const MOCK_ASSET: AssetRead = {
  id: "asset-uuid-1",
  emailer_id: 1,
  filename: "hero.png",
  label: "Hero image",
  mime_type: "image/png",
  size_bytes: 12345,
  url: "http://localhost:8000/assets/1/hero.png",
  uploaded_at: "2026-04-25T00:00:00Z",
  kind: "content",
};

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Error",
    text: () => Promise.resolve(body),
  });
}

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
// listAssets
// ---------------------------------------------------------------------------

describe("listAssets", () => {
  it("fetches assets list with auth header", async () => {
    const fetchMock = mockFetchOk([MOCK_ASSET]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAssets(1);

    expect(result).toEqual([MOCK_ASSET]);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/emailers/1/assets", {
      headers: expect.objectContaining({
        Authorization: `Bearer ${MOCK_TOKEN}`,
      }),
    });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, "Server error"));

    await expect(listAssets(1)).rejects.toThrow("Server error");
  });

  it("falls back to status text when body is empty", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, ""));

    await expect(listAssets(1)).rejects.toThrow("Request failed: 500 Error");
  });
});

// ---------------------------------------------------------------------------
// updateAsset
// ---------------------------------------------------------------------------

describe("updateAsset", () => {
  it("sends PATCH with label and returns updated asset", async () => {
    const fetchMock = mockFetchOk({ ...MOCK_ASSET, label: "Renamed" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateAsset(1, "asset-uuid-1", "Renamed");

    expect(result.label).toBe("Renamed");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/assets/asset-uuid-1",
      {
        method: "PATCH",
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ label: "Renamed" }),
      }
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(404, "Asset not found"));

    await expect(updateAsset(1, "missing", "x")).rejects.toThrow(
      "Asset not found"
    );
  });
});

// ---------------------------------------------------------------------------
// deleteAsset
// ---------------------------------------------------------------------------

describe("deleteAsset", () => {
  it("sends DELETE with auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await deleteAsset(1, "asset-uuid-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/assets/asset-uuid-1",
      {
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(404, "Not found"));

    await expect(deleteAsset(1, "missing")).rejects.toThrow("Not found");
  });
});

// ---------------------------------------------------------------------------
// validateFiles
// ---------------------------------------------------------------------------

function makeFile(
  name: string,
  size: number,
  type: string
): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe("validateFiles", () => {
  it("accepts files within all limits", () => {
    const files = [
      makeFile("a.png", 1024, "image/png"),
      makeFile("b.jpg", 2048, "image/jpeg"),
    ];
    const [accepted, rejected] = validateFiles(files, 0);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });

  it("rejects files over the 5 MB limit", () => {
    const big = makeFile("big.png", MAX_FILE_SIZE_BYTES + 1, "image/png");
    const [accepted, rejected] = validateFiles([big], 0);
    expect(accepted).toHaveLength(0);
    expect(rejected).toEqual([
      { filename: "big.png", reason: "exceeds 5 MB" },
    ]);
  });

  it("rejects unsupported MIME types", () => {
    const heic = makeFile("photo.heic", 1024, "image/heic");
    const [accepted, rejected] = validateFiles([heic], 0);
    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toMatch(/unsupported/i);
  });

  it("rejects when adding would exceed the per-emailer cap", () => {
    const files = [
      makeFile("a.png", 100, "image/png"),
      makeFile("b.png", 100, "image/png"),
    ];
    const [accepted, rejected] = validateFiles(
      files,
      MAX_ASSETS_PER_EMAILER - 1
    );
    expect(accepted).toHaveLength(1); // exactly one slot left
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatch(/limit/i);
  });

  it("returns each rejection independently in a mixed batch", () => {
    const files = [
      makeFile("ok.png", 1024, "image/png"),
      makeFile("big.png", MAX_FILE_SIZE_BYTES + 1, "image/png"),
      makeFile("bad.heic", 1024, "image/heic"),
    ];
    const [accepted, rejected] = validateFiles(files, 0);
    expect(accepted.map((f) => f.name)).toEqual(["ok.png"]);
    expect(rejected.map((r) => r.filename)).toEqual([
      "big.png",
      "bad.heic",
    ]);
  });

  it("exposes the MIME whitelist constants", () => {
    expect(ALLOWED_MIME_TYPES).toContain("image/png");
    expect(ALLOWED_MIME_TYPES).toContain("image/jpeg");
    expect(ALLOWED_MIME_TYPES).toContain("image/gif");
    expect(ALLOWED_MIME_TYPES).toContain("image/svg+xml");
  });
});

// ---------------------------------------------------------------------------
// uploadAsset (XHR)
// ---------------------------------------------------------------------------

interface MockXhr {
  open: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  setRequestHeader: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  upload: { onprogress: ((event: ProgressEvent) => void) | null };
  status: number;
  statusText: string;
  responseText: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

function makeMockXhr(): MockXhr {
  return {
    open: vi.fn(),
    send: vi.fn(),
    setRequestHeader: vi.fn(),
    abort: vi.fn(),
    upload: { onprogress: null },
    status: 0,
    statusText: "",
    responseText: "",
    onload: null,
    onerror: null,
    onabort: null,
  };
}

describe("uploadAsset", () => {
  it("posts FormData with auth header and resolves with the parsed asset", async () => {
    const xhr = makeMockXhr();
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(() => xhr) as unknown as typeof XMLHttpRequest
    );

    const file = makeFile("hero.png", 1024, "image/png");
    const promise = uploadAsset(1, file, { label: "Hero image" });

    // Simulate the server response
    xhr.status = 201;
    xhr.responseText = JSON.stringify(MOCK_ASSET);
    xhr.onload?.();

    await expect(promise).resolves.toEqual(MOCK_ASSET);

    expect(xhr.open).toHaveBeenCalledWith(
      "POST",
      "/api/v1/emailers/1/assets"
    );
    expect(xhr.setRequestHeader).toHaveBeenCalledWith(
      "Authorization",
      `Bearer ${MOCK_TOKEN}`
    );
    // We must NOT set Content-Type so the browser can pick the boundary.
    expect(xhr.setRequestHeader).not.toHaveBeenCalledWith(
      "Content-Type",
      expect.anything()
    );

    const sent = xhr.send.mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(FormData);
    const fd = sent as FormData;
    expect(fd.get("file")).toBeInstanceOf(File);
    expect(fd.get("label")).toBe("Hero image");
  });

  it("invokes the progress callback as bytes are sent", async () => {
    const xhr = makeMockXhr();
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(() => xhr) as unknown as typeof XMLHttpRequest
    );

    const onProgress = vi.fn();
    const file = makeFile("hero.png", 100, "image/png");
    const promise = uploadAsset(1, file, { onProgress });

    // Fire two progress events
    xhr.upload.onprogress?.({
      lengthComputable: true,
      loaded: 50,
      total: 100,
    } as ProgressEvent);
    xhr.upload.onprogress?.({
      lengthComputable: true,
      loaded: 100,
      total: 100,
    } as ProgressEvent);

    expect(onProgress).toHaveBeenNthCalledWith(1, 50);
    expect(onProgress).toHaveBeenNthCalledWith(2, 100);

    xhr.status = 201;
    xhr.responseText = JSON.stringify(MOCK_ASSET);
    xhr.onload?.();
    await promise;
  });

  it("rejects with the FastAPI detail string on 4xx", async () => {
    const xhr = makeMockXhr();
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(() => xhr) as unknown as typeof XMLHttpRequest
    );

    const promise = uploadAsset(
      1,
      makeFile("a.png", 1, "image/png"),
      {}
    );

    xhr.status = 422;
    xhr.statusText = "Unprocessable Entity";
    xhr.responseText = JSON.stringify({ detail: "File exceeds 5 MB limit" });
    xhr.onload?.();

    await expect(promise).rejects.toThrow("File exceeds 5 MB limit");
  });

  it("falls back to a generic message when there is no body", async () => {
    const xhr = makeMockXhr();
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(() => xhr) as unknown as typeof XMLHttpRequest
    );

    const promise = uploadAsset(
      1,
      makeFile("a.png", 1, "image/png"),
      {}
    );

    xhr.status = 500;
    xhr.statusText = "Internal Server Error";
    xhr.responseText = "";
    xhr.onload?.();

    await expect(promise).rejects.toThrow(
      "Upload failed: 500 Internal Server Error"
    );
  });

  it("rejects with a network error if the XHR errors out", async () => {
    const xhr = makeMockXhr();
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(() => xhr) as unknown as typeof XMLHttpRequest
    );

    const promise = uploadAsset(
      1,
      makeFile("a.png", 1, "image/png"),
      {}
    );

    xhr.onerror?.();

    await expect(promise).rejects.toThrow("Network error during upload");
  });

  it("does not append a label when omitted", async () => {
    const xhr = makeMockXhr();
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(() => xhr) as unknown as typeof XMLHttpRequest
    );

    const promise = uploadAsset(1, makeFile("a.png", 1, "image/png"), {});

    const sent = xhr.send.mock.calls[0]?.[0] as FormData;
    expect(sent.get("label")).toBeNull();

    xhr.status = 201;
    xhr.responseText = JSON.stringify(MOCK_ASSET);
    xhr.onload?.();
    await promise;
  });

  // STORY-AP2.3: the ``kind`` form field.
  it("appends kind=sample when kind: 'sample' is passed", async () => {
    const xhr = makeMockXhr();
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(() => xhr) as unknown as typeof XMLHttpRequest
    );

    const promise = uploadAsset(1, makeFile("real.png", 1, "image/png"), {
      kind: "sample",
    });

    const sent = xhr.send.mock.calls[0]?.[0] as FormData;
    expect(sent.get("kind")).toBe("sample");

    xhr.status = 201;
    xhr.responseText = JSON.stringify({ ...MOCK_ASSET, kind: "sample" });
    xhr.onload?.();
    await promise;
  });

  it("omits the kind field for content uploads (backend default)", async () => {
    const xhr = makeMockXhr();
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(() => xhr) as unknown as typeof XMLHttpRequest
    );

    // Both an explicit "content" and an omitted kind should send nothing,
    // keeping the existing content-upload calls byte-identical.
    const promise = uploadAsset(1, makeFile("a.png", 1, "image/png"), {
      kind: "content",
    });

    const sent = xhr.send.mock.calls[0]?.[0] as FormData;
    expect(sent.get("kind")).toBeNull();

    xhr.status = 201;
    xhr.responseText = JSON.stringify(MOCK_ASSET);
    xhr.onload?.();
    await promise;
  });
});
