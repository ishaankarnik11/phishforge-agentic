import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SharedPreview from "./SharedPreview";
import * as previewApi from "../api/previewLinks";
import {
  PreviewNotFoundError,
  type PublicPreviewPayload,
  type SuggestionRead,
} from "../api/previewLinks";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_PAYLOAD: PublicPreviewPayload = {
  emailer_name: "Q4 Campaign",
  identity: {
    name: "Contoso IT",
    primary_color: "#004C8F",
    logo_url: "https://example.com/logo.png",
  },
  version_id: 10,
  version_number: 3,
  subject_line: "Subject here",
  preheader: "Preheader here",
  compiled_html: "<html><body><p>hello</p></body></html>",
  expires_at: "2099-01-01T00:00:00Z",
};

const MOCK_ECHO: SuggestionRead = {
  id: 99,
  emailer_id: 1,
  version_id: 10,
  role: "suggestion",
  content: "[Suggestion from Alice]: Looks great",
  created_at: "2026-04-25T00:00:00Z",
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
}

function renderShared(token = "abc123") {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/share/${token}`]}>
        <Routes>
          <Route path="/share/:token" element={<SharedPreview />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // The SharedPreview page should never touch localStorage for auth, but
  // stub it defensively so the module-level call in other helpers is safe
  // if any import chain accidentally pulls it in.
  vi.stubGlobal("localStorage", {
    getItem: vi.fn().mockReturnValue(null),
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

describe("SharedPreview", () => {
  it("renders the payload after successful fetch", async () => {
    vi.spyOn(previewApi, "getPublicPreview").mockResolvedValue(MOCK_PAYLOAD);

    renderShared();

    // Header bits
    expect(await screen.findByText("Q4 Campaign")).toBeInTheDocument();
    expect(screen.getByText(/Contoso IT/i)).toBeInTheDocument();
    expect(screen.getByText(/Version 3/i)).toBeInTheDocument();
    expect(screen.getByText(/Expires on/i)).toBeInTheDocument();

    // The iframe with srcDoc
    const iframe = screen.getByTestId(
      "shared-preview-iframe"
    ) as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute("srcdoc")).toContain("hello");
    expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("shows the 'invalid or expired' message on 404", async () => {
    vi.spyOn(previewApi, "getPublicPreview").mockRejectedValue(
      new PreviewNotFoundError()
    );

    renderShared("bad-token");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/invalid or has expired/i);
    // Retry button should NOT appear on a clean 404
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("shows a retry button on generic network errors", async () => {
    vi.spyOn(previewApi, "getPublicPreview").mockRejectedValue(
      new Error("Network down")
    );

    renderShared();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("submits a suggestion and shows success", async () => {
    vi.spyOn(previewApi, "getPublicPreview").mockResolvedValue(MOCK_PAYLOAD);
    const spy = vi
      .spyOn(previewApi, "submitPublicSuggestion")
      .mockResolvedValue(MOCK_ECHO);

    const user = userEvent.setup();
    renderShared("tkn1");

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    await user.type(screen.getByLabelText(/your name/i), "Alice");
    await user.type(
      screen.getByLabelText(/your suggestion/i),
      "Looks great"
    );
    await user.click(
      screen.getByRole("button", { name: /submit suggestion/i })
    );

    await waitFor(() =>
      expect(screen.getByTestId("suggestion-success")).toBeInTheDocument()
    );

    expect(spy).toHaveBeenCalledWith("tkn1", {
      text: "Looks great",
      reviewer_name: "Alice",
    });

    // Textarea is cleared after success so the user can submit again
    const textarea = screen.getByLabelText(
      /your suggestion/i
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("omits reviewer_name when the name field is blank", async () => {
    vi.spyOn(previewApi, "getPublicPreview").mockResolvedValue(MOCK_PAYLOAD);
    const spy = vi
      .spyOn(previewApi, "submitPublicSuggestion")
      .mockResolvedValue(MOCK_ECHO);

    const user = userEvent.setup();
    renderShared("tkn2");

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    await user.type(
      screen.getByLabelText(/your suggestion/i),
      "Anonymous feedback"
    );
    await user.click(
      screen.getByRole("button", { name: /submit suggestion/i })
    );

    await waitFor(() => expect(spy).toHaveBeenCalled());

    expect(spy).toHaveBeenCalledWith("tkn2", {
      text: "Anonymous feedback",
      reviewer_name: undefined,
    });
  });

  it("shows character counter", async () => {
    vi.spyOn(previewApi, "getPublicPreview").mockResolvedValue(MOCK_PAYLOAD);

    const user = userEvent.setup();
    renderShared();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    const counter = screen.getByTestId("suggestion-char-count");
    expect(counter).toHaveTextContent("0 / 5000");

    await user.type(screen.getByLabelText(/your suggestion/i), "hello");
    expect(counter).toHaveTextContent("5 / 5000");
  });

  it("disables submit when suggestion is empty", async () => {
    vi.spyOn(previewApi, "getPublicPreview").mockResolvedValue(MOCK_PAYLOAD);

    renderShared();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    const submitBtn = screen.getByRole("button", {
      name: /submit suggestion/i,
    });
    expect(submitBtn).toBeDisabled();
  });

  it("shows an inline error when submit fails", async () => {
    vi.spyOn(previewApi, "getPublicPreview").mockResolvedValue(MOCK_PAYLOAD);
    vi.spyOn(previewApi, "submitPublicSuggestion").mockRejectedValue(
      new Error("Server exploded")
    );

    const user = userEvent.setup();
    renderShared();

    await waitFor(() =>
      expect(screen.getByText("Q4 Campaign")).toBeInTheDocument()
    );

    await user.type(screen.getByLabelText(/your suggestion/i), "try this");
    await user.click(
      screen.getByRole("button", { name: /submit suggestion/i })
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/failed to submit/i);
    expect(alert).toHaveTextContent(/Server exploded/);
  });
});
