import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listPresets,
  getPresetDetail,
  createPreset,
  updatePreset,
  removePreset,
  uploadPresetLogo,
  copyLogoToEmailer,
  ImpersonationPresetNotFoundError,
} from "./impersonationPresets";

const MOCK_TOKEN = "test-jwt-token";

function mockFetchOk(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status,
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

describe("impersonationPresets API", () => {
  it("listPresets GETs the collection", async () => {
    const fetchMock = mockFetchOk([{ id: 1, name: "MS", primary_color: null }]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listPresets();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/impersonation-presets",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      })
    );
    expect(result).toHaveLength(1);
  });

  it("getPresetDetail GETs a single preset by id", async () => {
    const fetchMock = mockFetchOk({
      id: 7,
      name: "MS",
      sender_email: "a@b.com",
      primary_color: "#fff",
      pretends_to_be: "x",
      logo_url: null,
    });
    vi.stubGlobal("fetch", fetchMock);

    await getPresetDetail("microsoft-365");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/impersonation-presets/microsoft-365",
      expect.anything()
    );
  });

  it("createPreset POSTs the body", async () => {
    const fetchMock = mockFetchOk({ id: 3 });
    vi.stubGlobal("fetch", fetchMock);

    await createPreset({
      name: "MS",
      sender_email: "a@b.com",
      primary_color: null,
      pretends_to_be: "x",
    });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/impersonation-presets");
    expect(call?.[1]?.method).toBe("POST");
    expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({ name: "MS" });
  });

  it("updatePreset PATCHes a single preset", async () => {
    const fetchMock = mockFetchOk({ id: 7 });
    vi.stubGlobal("fetch", fetchMock);

    await updatePreset("microsoft-365", { name: "Renamed" });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/impersonation-presets/microsoft-365");
    expect(call?.[1]?.method).toBe("PATCH");
  });

  it("removePreset DELETEs a single preset", async () => {
    const fetchMock = mockFetchOk(null, 204);
    vi.stubGlobal("fetch", fetchMock);

    await removePreset("microsoft-365");

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/impersonation-presets/microsoft-365");
    expect(call?.[1]?.method).toBe("DELETE");
  });

  it("uploadPresetLogo POSTs multipart without a JSON content-type", async () => {
    const fetchMock = mockFetchOk({ id: 7, logo_url: "x" });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array(4)], "logo.png", {
      type: "image/png",
    });
    await uploadPresetLogo("microsoft-365", file);

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/impersonation-presets/microsoft-365/logo");
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.body).toBeInstanceOf(FormData);
    // No Content-Type header so the browser sets the multipart boundary.
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("copyLogoToEmailer POSTs the preset id to the emailer endpoint", async () => {
    const fetchMock = mockFetchOk({ id: "asset-1", url: "u" });
    vi.stubGlobal("fetch", fetchMock);

    await copyLogoToEmailer(55, "microsoft-365");

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(
      "/api/v1/emailers/55/impersonation-logo/from-preset"
    );
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({
      preset_id: "microsoft-365",
    });
  });

  it("throws ImpersonationPresetNotFoundError on 404", async () => {
    vi.stubGlobal("fetch", mockFetchError(404, '{"detail":"gone"}'));

    await expect(getPresetDetail("nope")).rejects.toBeInstanceOf(
      ImpersonationPresetNotFoundError
    );
  });

  it("throws a plain Error on other failures", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, "server error"));

    await expect(listPresets()).rejects.toThrow("server error");
  });
});
