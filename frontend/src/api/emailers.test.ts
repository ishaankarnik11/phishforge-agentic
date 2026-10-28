import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createEmailer,
  updateEmailer,
  getEmailer,
  getLatestVersion,
  generateEmailer,
  saveVersion,
  listVersions,
  getVersion,
  listChatMessages,
  sendChatMessage,
  getExportUrl,
  exportHtml,
  listEmailers,
} from "./emailers";
import type {
  EmailerRead,
  EmailerVersionRead,
  EmailerVersionSummary,
  GenerateResponse,
  ChatMessageRead,
  RefineResponse,
} from "./emailers";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const MOCK_TOKEN = "test-jwt-token";

const MOCK_EMAILER: EmailerRead = {
  id: 1,
  name: "Q4 Campaign",
  status: "draft",
};

const MOCK_VERSION: EmailerVersionRead = {
  id: 10,
  emailer_id: 1,
  version_number: 1,
  mjml_source: "<mjml><mj-body></mj-body></mjml>",
  compiled_html: "<html><body></body></html>",
  subject_line: "Test Subject",
  preheader: "Test Preheader",
  model_used: "claude-sonnet-4-20250514",
  input_tokens: 1000,
  output_tokens: 2000,
  created_at: "2026-01-01T00:00:00Z",
};

const MOCK_GENERATE: GenerateResponse = {
  version_id: 11,
  version_number: 2,
  subject_line: "Generated Subject",
  preheader: "Generated Preheader",
  mjml_source: "<mjml><mj-body><mj-section></mj-section></mj-body></mjml>",
  compiled_html: "<html><body><div></div></body></html>",
  model_used: "claude-sonnet-4-20250514",
  input_tokens: 500,
  output_tokens: 1500,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  latency_ms: 12345,
  warning: null,
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
// createEmailer (strict + draft) and updateEmailer (STORY-2.6)
// ---------------------------------------------------------------------------

describe("createEmailer", () => {
  it("posts the strict body when no status is provided", async () => {
    const fetchMock = mockFetchOk(MOCK_EMAILER);
    vi.stubGlobal("fetch", fetchMock);

    await createEmailer({
      name: "Q4 Campaign",
      // CR-001: pretext_scenario is the required field; the marketing
      // category/content_summary/tone fields are no longer sent.
      pretext_scenario: "password_expiry",
      cta_text: null,
      cta_url: null,
      // STORY-AP2.2: impersonated identity is now part of EmailerCreate.
      impersonation_sender_name: "Microsoft 365",
      impersonation_sender_email: "it-support@contoso.com",
      impersonation_pretends_to_be: "A password-expiry notice",
      impersonation_primary_color: null,
      impersonation_logo_asset_id: null,
      // STORY-AP2.1: pretext is now part of EmailerCreate.
      lure_type: "credential_harvest",
      urgency_level: "high",
      pretext_tell: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          "Content-Type": "application/json",
        }),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body.status).toBeUndefined();
    expect(body.name).toBe("Q4 Campaign");
    // CR-001: the retired marketing fields are not part of this body.
    expect(body.pretext_scenario).toBe("password_expiry");
    expect(body.category).toBeUndefined();
    expect(body.content_summary).toBeUndefined();
    expect(body.tone).toBeUndefined();
  });

  it("forwards status='draft' and a partial body for the draft path", async () => {
    const fetchMock = mockFetchOk(MOCK_EMAILER);
    vi.stubGlobal("fetch", fetchMock);

    await createEmailer({ status: "draft", name: "wip" });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({ status: "draft", name: "wip" });
  });
});

describe("updateEmailer", () => {
  it("sends PATCH with the partial body and returns the result", async () => {
    const fetchMock = mockFetchOk({ ...MOCK_EMAILER, status: "in_review" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateEmailer(1, { name: "Renamed" });

    expect(result.status).toBe("in_review");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/emailers/1", {
      method: "PATCH",
      headers: expect.objectContaining({
        Authorization: `Bearer ${MOCK_TOKEN}`,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ name: "Renamed" }),
    });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(422, "Field required: name"));

    await expect(updateEmailer(1, {})).rejects.toThrow(
      "Field required: name"
    );
  });
});

// ---------------------------------------------------------------------------
// listEmailers (STORY-1.3)
// ---------------------------------------------------------------------------

describe("listEmailers", () => {
  it("hits the bare endpoint when no filters are passed", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    await listEmailers();

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/emailers", {
      headers: expect.objectContaining({
        Authorization: `Bearer ${MOCK_TOKEN}`,
      }),
    });
  });

  it("does not append query params when filter arrays are empty", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    await listEmailers({ statusFilter: [] });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/emailers", expect.anything());
  });

  it("repeats `status` for each entry in statusFilter", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    await listEmailers({ statusFilter: ["draft", "completed"] });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe("/api/v1/emailers?status=draft&status=completed");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, "Server error"));

    await expect(listEmailers()).rejects.toThrow("Server error");
  });
});

// ---------------------------------------------------------------------------
// getEmailer
// ---------------------------------------------------------------------------

describe("getEmailer", () => {
  it("fetches emailer by id with auth header", async () => {
    const fetchMock = mockFetchOk(MOCK_EMAILER);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getEmailer(1);

    expect(result).toEqual(MOCK_EMAILER);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/emailers/1", {
      headers: expect.objectContaining({
        Authorization: `Bearer ${MOCK_TOKEN}`,
      }),
    });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(404, "Not found"));

    await expect(getEmailer(999)).rejects.toThrow("Not found");
  });

  it("falls back to status text when body is empty", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, ""));

    await expect(getEmailer(1)).rejects.toThrow("Request failed: 500 Error");
  });
});

// ---------------------------------------------------------------------------
// getLatestVersion
// ---------------------------------------------------------------------------

describe("getLatestVersion", () => {
  it("fetches latest version with auth header", async () => {
    const fetchMock = mockFetchOk(MOCK_VERSION);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLatestVersion(1);

    expect(result).toEqual(MOCK_VERSION);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/versions/latest",
      { headers: expect.objectContaining({ Authorization: `Bearer ${MOCK_TOKEN}` }) }
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(404, "No versions"));

    await expect(getLatestVersion(1)).rejects.toThrow("No versions");
  });
});

// ---------------------------------------------------------------------------
// generateEmailer
// ---------------------------------------------------------------------------

describe("generateEmailer", () => {
  it("sends POST and returns generate response", async () => {
    const fetchMock = mockFetchOk(MOCK_GENERATE);
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateEmailer(1);

    expect(result).toEqual(MOCK_GENERATE);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/emailers/1/generate", {
      method: "POST",
      headers: expect.objectContaining({
        Authorization: `Bearer ${MOCK_TOKEN}`,
        "Content-Type": "application/json",
      }),
    });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, "Generation failed"));

    await expect(generateEmailer(1)).rejects.toThrow("Generation failed");
  });
});

// ---------------------------------------------------------------------------
// saveVersion (STORY-4.2)
// ---------------------------------------------------------------------------

const MOCK_SAVED_VERSION: EmailerVersionRead = {
  id: 12,
  emailer_id: 1,
  version_number: 3,
  mjml_source: "<mjml><mj-body><mj-section><mj-column><mj-text>Edited</mj-text></mj-column></mj-section></mj-body></mjml>",
  compiled_html: "<html><body>Edited</body></html>",
  subject_line: null,
  preheader: null,
  model_used: null,
  input_tokens: null,
  output_tokens: null,
  created_at: "2026-04-24T00:00:00Z",
};

describe("saveVersion", () => {
  it("sends POST with mjml_source and returns saved version", async () => {
    const fetchMock = mockFetchOk(MOCK_SAVED_VERSION);
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveVersion(1, MOCK_SAVED_VERSION.mjml_source);

    expect(result).toEqual(MOCK_SAVED_VERSION);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/versions",
      {
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ mjml_source: MOCK_SAVED_VERSION.mjml_source }),
      }
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, "Save failed"));

    await expect(saveVersion(1, "<mjml></mjml>")).rejects.toThrow("Save failed");
  });

  it("falls back to status text when body is empty", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, ""));

    await expect(saveVersion(1, "<mjml></mjml>")).rejects.toThrow(
      "Request failed: 500 Error"
    );
  });
});

// ---------------------------------------------------------------------------
// listVersions
// ---------------------------------------------------------------------------

const MOCK_VERSION_SUMMARIES: EmailerVersionSummary[] = [
  {
    id: 3,
    version_number: 3,
    subject_line: "v3 subject",
    created_at: "2026-04-20T12:00:00Z",
  },
  {
    id: 2,
    version_number: 2,
    subject_line: "v2 subject",
    created_at: "2026-04-19T12:00:00Z",
  },
];

describe("listVersions", () => {
  it("fetches version list with auth header", async () => {
    const fetchMock = mockFetchOk(MOCK_VERSION_SUMMARIES);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listVersions(1);

    expect(result).toEqual(MOCK_VERSION_SUMMARIES);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/versions",
      {
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(404, "Not found"));

    await expect(listVersions(999)).rejects.toThrow("Not found");
  });

  it("falls back to status text when body is empty", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, ""));

    await expect(listVersions(1)).rejects.toThrow("Request failed: 500 Error");
  });
});

// ---------------------------------------------------------------------------
// getVersion
// ---------------------------------------------------------------------------

describe("getVersion", () => {
  it("fetches a specific version with auth header", async () => {
    const fetchMock = mockFetchOk(MOCK_VERSION);
    vi.stubGlobal("fetch", fetchMock);

    const result = await getVersion(1, 2);

    expect(result).toEqual(MOCK_VERSION);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/versions/2",
      {
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(404, "Version not found"));

    await expect(getVersion(1, 99)).rejects.toThrow("Version not found");
  });

  it("falls back to status text when body is empty", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, ""));

    await expect(getVersion(1, 2)).rejects.toThrow("Request failed: 500 Error");
  });
});

// ---------------------------------------------------------------------------
// listChatMessages (STORY-4.3)
// ---------------------------------------------------------------------------

const MOCK_CHAT_MESSAGES: ChatMessageRead[] = [
  {
    id: 1,
    emailer_id: 1,
    role: "user",
    content: "Make the header red",
    created_at: "2026-04-24T10:00:00Z",
  },
  {
    id: 2,
    emailer_id: 1,
    role: "assistant",
    content: "I changed the header to red.",
    created_at: "2026-04-24T10:00:05Z",
  },
];

describe("listChatMessages", () => {
  it("fetches chat messages with auth header", async () => {
    const fetchMock = mockFetchOk(MOCK_CHAT_MESSAGES);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listChatMessages(1);

    expect(result).toEqual(MOCK_CHAT_MESSAGES);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/chat",
      {
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, "Server error"));

    await expect(listChatMessages(1)).rejects.toThrow("Server error");
  });

  it("falls back to status text when body is empty", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, ""));

    await expect(listChatMessages(1)).rejects.toThrow(
      "Request failed: 500 Error"
    );
  });
});

// ---------------------------------------------------------------------------
// sendChatMessage (STORY-4.3)
// ---------------------------------------------------------------------------

const MOCK_REFINE_RESPONSE: RefineResponse = {
  message: {
    id: 3,
    emailer_id: 1,
    role: "assistant",
    content: "Updated the button color to green.",
    created_at: "2026-04-24T10:01:00Z",
  },
  version: {
    id: 15,
    emailer_id: 1,
    version_number: 4,
    mjml_source: "<mjml><mj-body>refined</mj-body></mjml>",
    compiled_html: "<html><body>refined</body></html>",
    subject_line: "Refined Subject",
    preheader: "Refined Preheader",
    model_used: "claude-sonnet-4-20250514",
    input_tokens: 200,
    output_tokens: 400,
    created_at: "2026-04-24T10:01:00Z",
  },
  summary: "Changed button to green",
  warnings: [],
};

describe("sendChatMessage", () => {
  it("sends POST with content and returns refine response", async () => {
    const fetchMock = mockFetchOk(MOCK_REFINE_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendChatMessage(1, "Change button to green");

    expect(result).toEqual(MOCK_REFINE_RESPONSE);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/emailers/1/chat",
      {
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ content: "Change button to green" }),
      }
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, "Refine failed"));

    await expect(sendChatMessage(1, "test")).rejects.toThrow("Refine failed");
  });

  it("falls back to status text when body is empty", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, ""));

    await expect(sendChatMessage(1, "test")).rejects.toThrow(
      "Request failed: 500 Error"
    );
  });
});

// ---------------------------------------------------------------------------
// getExportUrl (STORY-5.1)
// ---------------------------------------------------------------------------

describe("getExportUrl", () => {
  it("returns the correct export URL", () => {
    expect(getExportUrl(42)).toBe("/api/v1/emailers/42/export");
  });

  it("handles different emailer IDs", () => {
    expect(getExportUrl(1)).toBe("/api/v1/emailers/1/export");
    expect(getExportUrl(999)).toBe("/api/v1/emailers/999/export");
  });
});

// ---------------------------------------------------------------------------
// exportHtml (STORY-5.1)
// ---------------------------------------------------------------------------

describe("exportHtml", () => {
  let mockAnchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockAnchor = {
      href: "",
      download: "",
      click: vi.fn(),
    };

    vi.stubGlobal("document", {
      ...document,
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:http://localhost/fake"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("fetches export URL with auth header and triggers download", async () => {
    const mockBlob = new Blob(["<html>test</html>"], { type: "text/html" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers({
        "content-disposition": 'attachment; filename="acme-retail_test_v1_20260424.html"',
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await exportHtml(42);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/emailers/42/export", {
      headers: expect.objectContaining({
        Authorization: `Bearer ${MOCK_TOKEN}`,
      }),
    });

    expect(mockAnchor.download).toBe("acme-retail_test_v1_20260424.html");
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/fake");
  });

  it("uses fallback filename when content-disposition is missing", async () => {
    const mockBlob = new Blob(["<html>test</html>"], { type: "text/html" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await exportHtml(1);

    expect(mockAnchor.download).toBe("export.html");
    expect(mockAnchor.click).toHaveBeenCalled();
  });

  it("throws on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () => Promise.resolve("No compiled HTML available"),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(exportHtml(1)).rejects.toThrow("No compiled HTML available");
  });

  it("falls back to status text when body is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(exportHtml(1)).rejects.toThrow(
      "Export failed: 500 Internal Server Error"
    );
  });
});
