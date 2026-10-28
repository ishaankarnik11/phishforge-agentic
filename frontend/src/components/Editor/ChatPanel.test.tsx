import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ChatPanel from "./ChatPanel";
import * as emailersApi from "../../api/emailers";
import type {
  ChatMessageRead,
  RefineResponse,
  EmailerVersionRead,
} from "../../api/emailers";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_USER_MSG: ChatMessageRead = {
  id: 1,
  emailer_id: 42,
  role: "user",
  content: "Make the header red",
  created_at: new Date().toISOString(),
};

const MOCK_ASSISTANT_MSG: ChatMessageRead = {
  id: 2,
  emailer_id: 42,
  role: "assistant",
  content: "I updated the header color to red.",
  created_at: new Date().toISOString(),
};

const MOCK_VERSION: EmailerVersionRead = {
  id: 10,
  emailer_id: 42,
  version_number: 5,
  mjml_source: "<mjml><mj-body>refined</mj-body></mjml>",
  compiled_html: "<html><body>refined</body></html>",
  subject_line: "Updated Subject",
  preheader: "Updated Preheader",
  model_used: "claude-sonnet-4-20250514",
  input_tokens: 100,
  output_tokens: 200,
  created_at: new Date().toISOString(),
};

const MOCK_REFINE_RESPONSE: RefineResponse = {
  message: MOCK_ASSISTANT_MSG,
  version: MOCK_VERSION,
  summary: "Changed header background to red",
  warnings: [],
};

const MOCK_CHAT_HISTORY: ChatMessageRead[] = [MOCK_USER_MSG, MOCK_ASSISTANT_MSG];

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

function renderChatPanel(
  overrides: Partial<React.ComponentProps<typeof ChatPanel>> = {}
) {
  const client = makeQueryClient();
  const defaultProps = {
    emailerId: 42,
    onApply: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };

  const result = render(
    <QueryClientProvider client={client}>
      <ChatPanel {...defaultProps} />
    </QueryClientProvider>
  );

  return { ...result, ...defaultProps, client };
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

describe("ChatPanel", () => {
  // -------------------------------------------------------------------------
  // 1. Loading state
  // -------------------------------------------------------------------------
  it("shows loading state while fetching chat history", () => {
    vi.spyOn(emailersApi, "listChatMessages").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    renderChatPanel();

    expect(screen.getByText(/loading chat/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Error state
  // -------------------------------------------------------------------------
  it("shows error state when chat fetch fails", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockRejectedValue(
      new Error("Network error")
    );

    renderChatPanel();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/failed to load chat history/i);
  });

  // -------------------------------------------------------------------------
  // 3. Empty state
  // -------------------------------------------------------------------------
  it("shows empty state when no messages exist", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);

    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // 4. Renders chat history
  // -------------------------------------------------------------------------
  it("renders user and assistant messages from history", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue(
      MOCK_CHAT_HISTORY
    );

    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText("Make the header red")).toBeInTheDocument()
    );
    expect(
      screen.getByText("I updated the header color to red.")
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 5. User messages styled correctly
  // -------------------------------------------------------------------------
  it("renders user messages right-aligned and assistant messages left-aligned", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue(
      MOCK_CHAT_HISTORY
    );

    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText("Make the header red")).toBeInTheDocument()
    );

    const userMsg = screen.getByTestId("chat-message-user");
    const assistantMsg = screen.getByTestId("chat-message-assistant");

    // STORY-7.12 AC-2 changed the wrapper to flex-col so a per-message
    // failure hint can stack below the bubble. The alignment now uses
    // items-end / items-start instead of justify-end / justify-start.
    expect(userMsg.className).toContain("items-end");
    expect(assistantMsg.className).toContain("items-start");
  });

  // -------------------------------------------------------------------------
  // 6. Send button works
  // -------------------------------------------------------------------------
  it("sends a message and shows thinking indicator", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    // Make send hang so we can verify the "thinking" state
    vi.spyOn(emailersApi, "sendChatMessage").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    const user = userEvent.setup();
    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    const input = screen.getByLabelText(/chat message input/i);
    const sendBtn = screen.getByLabelText(/send message/i);

    await user.type(input, "Change the button color");
    await user.click(sendBtn);

    // Should show thinking indicator
    await waitFor(() =>
      expect(screen.getByTestId("chat-thinking")).toBeInTheDocument()
    );

    expect(emailersApi.sendChatMessage).toHaveBeenCalledWith(
      42,
      "Change the button color"
    );
  });

  // -------------------------------------------------------------------------
  // 7. Send disabled when empty
  // -------------------------------------------------------------------------
  it("disables send button when input is empty", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);

    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    const sendBtn = screen.getByLabelText(/send message/i);
    expect(sendBtn).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 8. Apply button calls onApply
  // -------------------------------------------------------------------------
  it("shows Apply/Discard buttons on assistant response and Apply works", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    vi.spyOn(emailersApi, "sendChatMessage").mockResolvedValue(
      MOCK_REFINE_RESPONSE
    );

    const user = userEvent.setup();
    const { onApply } = renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    // Send a message
    const input = screen.getByLabelText(/chat message input/i);
    await user.type(input, "Make header red");
    await user.click(screen.getByLabelText(/send message/i));

    // Wait for the Apply button to appear
    const applyBtn = await screen.findByRole("button", { name: /^apply$/i });
    expect(applyBtn).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^discard$/i })
    ).toBeInTheDocument();

    // Click Apply
    await user.click(applyBtn);

    expect(onApply).toHaveBeenCalledWith(MOCK_VERSION);
  });

  // -------------------------------------------------------------------------
  // 9. Discard button removes pending refinement
  // -------------------------------------------------------------------------
  it("Discard removes the pending refinement without calling onApply", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    vi.spyOn(emailersApi, "sendChatMessage").mockResolvedValue(
      MOCK_REFINE_RESPONSE
    );

    const user = userEvent.setup();
    const { onApply } = renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    const input = screen.getByLabelText(/chat message input/i);
    await user.type(input, "Make header red");
    await user.click(screen.getByLabelText(/send message/i));

    const discardBtn = await screen.findByRole("button", {
      name: /^discard$/i,
    });
    await user.click(discardBtn);

    // Apply/Discard buttons should be gone
    expect(screen.queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^discard$/i })).not.toBeInTheDocument();

    // onApply should NOT have been called
    expect(onApply).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. Close button
  // -------------------------------------------------------------------------
  it("calls onClose when close button is clicked", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);

    const user = userEvent.setup();
    const { onClose } = renderChatPanel();

    const closeBtn = screen.getByLabelText(/close chat panel/i);
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 11. Warnings displayed
  // -------------------------------------------------------------------------
  it("displays warnings from refine response", async () => {
    const responseWithWarnings: RefineResponse = {
      ...MOCK_REFINE_RESPONSE,
      warnings: ["Image URL is broken", "Font not supported"],
    };
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    vi.spyOn(emailersApi, "sendChatMessage").mockResolvedValue(
      responseWithWarnings
    );

    const user = userEvent.setup();
    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    const input = screen.getByLabelText(/chat message input/i);
    await user.type(input, "Fix layout");
    await user.click(screen.getByLabelText(/send message/i));

    // Wait for warnings to appear
    await waitFor(() =>
      expect(screen.getByText("Image URL is broken")).toBeInTheDocument()
    );
    expect(screen.getByText("Font not supported")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 12. Header is present
  // -------------------------------------------------------------------------
  it("displays the 'AI Chat' heading", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);

    renderChatPanel();

    expect(screen.getByText("AI Chat")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 13. Enter key sends message
  // -------------------------------------------------------------------------
  it("sends message on Enter key press (without Shift)", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    vi.spyOn(emailersApi, "sendChatMessage").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    const user = userEvent.setup();
    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    const input = screen.getByLabelText(/chat message input/i);
    await user.type(input, "Test message{enter}");

    expect(emailersApi.sendChatMessage).toHaveBeenCalledWith(42, "Test message");
  });

  // -------------------------------------------------------------------------
  // 14. Suggestion messages (STORY-4.5)
  // -------------------------------------------------------------------------
  it("renders a suggestion message with the reviewer's name and a badge", async () => {
    const suggestionMsg: ChatMessageRead = {
      id: 501,
      emailer_id: 42,
      role: "suggestion",
      content: "[Suggestion from Alice]: Change the hero image",
      created_at: new Date().toISOString(),
    };
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([suggestionMsg]);

    renderChatPanel();

    const bubble = await screen.findByTestId("chat-message-suggestion");
    // Badge
    expect(bubble).toHaveTextContent(/suggestion/i);
    // Reviewer name
    expect(bubble).toHaveTextContent("Alice");
    // Body (WITHOUT the prefix)
    expect(bubble).toHaveTextContent("Change the hero image");
    // The prefix itself shouldn't appear as a literal string
    expect(bubble).not.toHaveTextContent("[Suggestion from");
  });

  it("renders a suggestion message with 'Anonymous reviewer' when there is no name", async () => {
    const suggestionMsg: ChatMessageRead = {
      id: 502,
      emailer_id: 42,
      role: "suggestion",
      content: "Just a plain comment without a prefix",
      created_at: new Date().toISOString(),
    };
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([suggestionMsg]);

    renderChatPanel();

    const bubble = await screen.findByTestId("chat-message-suggestion");
    expect(bubble).toHaveTextContent(/anonymous reviewer/i);
    expect(bubble).toHaveTextContent("Just a plain comment without a prefix");
  });

  // -------------------------------------------------------------------------
  // STORY-7.12 AC-2 / AC-5: refinement 422 marks the user message as failed
  // -------------------------------------------------------------------------
  it("marks the user message as failed when sendChatMessage throws MJMLValidationError", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    vi.spyOn(emailersApi, "sendChatMessage").mockRejectedValue(
      new emailersApi.MJMLValidationError("MJML validation failed", [])
    );

    const user = userEvent.setup();
    const { onApply } = renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    const input = screen.getByLabelText(/chat message input/i);
    await user.type(input, "Make the divider blue");
    await user.click(screen.getByLabelText(/send message/i));

    // The optimistic user bubble appears with a failed status indicator
    // and the inline remediation hint below.
    const userMsg = await screen.findByTestId("chat-message-user");
    await waitFor(() =>
      expect(userMsg.dataset.messageFailed).toBe("true")
    );
    expect(
      screen.getByTestId("chat-message-failed-indicator")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("chat-message-failed-text")
    ).toHaveTextContent(/couldn['’]t apply that change\. please rephrase/i);

    // Active version stays unchanged — onApply was never called.
    expect(onApply).not.toHaveBeenCalled();
  });

  it("does not show the generic 'Failed to send message' banner for a 422", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    vi.spyOn(emailersApi, "sendChatMessage").mockRejectedValue(
      new emailersApi.MJMLValidationError("MJML validation failed", [])
    );

    const user = userEvent.setup();
    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    await user.type(
      screen.getByLabelText(/chat message input/i),
      "Make the divider blue"
    );
    await user.click(screen.getByLabelText(/send message/i));

    await waitFor(() =>
      expect(
        screen.getByTestId("chat-message-failed-indicator")
      ).toBeInTheDocument()
    );

    // The per-message marker is the only failure surface — the floating
    // "Failed to send message." banner is suppressed for 422.
    expect(
      screen.queryByText(/failed to send message/i)
    ).not.toBeInTheDocument();
  });

  it("still shows the generic banner for non-422 failures (network/500)", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    vi.spyOn(emailersApi, "sendChatMessage").mockRejectedValue(
      new Error("Network down")
    );

    const user = userEvent.setup();
    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    await user.type(
      screen.getByLabelText(/chat message input/i),
      "anything"
    );
    await user.click(screen.getByLabelText(/send message/i));

    await waitFor(() =>
      expect(
        screen.getByText(/failed to send message/i)
      ).toBeInTheDocument()
    );
    // No per-message failure marker — that's reserved for the 422 path.
    expect(
      screen.queryByTestId("chat-message-failed-indicator")
    ).not.toBeInTheDocument();
  });

  it("subsequent chat messages still work after a 422 failure", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    const sendSpy = vi
      .spyOn(emailersApi, "sendChatMessage")
      .mockRejectedValueOnce(
        new emailersApi.MJMLValidationError("MJML validation failed", [])
      )
      .mockResolvedValueOnce(MOCK_REFINE_RESPONSE);

    const user = userEvent.setup();
    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    const input = screen.getByLabelText(/chat message input/i);
    const sendBtn = screen.getByLabelText(/send message/i);

    // First send fails.
    await user.type(input, "first attempt");
    await user.click(sendBtn);
    await waitFor(() =>
      expect(
        screen.getByTestId("chat-message-failed-indicator")
      ).toBeInTheDocument()
    );

    // Second send succeeds — Apply button appears.
    await user.type(input, "second attempt");
    await user.click(sendBtn);

    const applyBtn = await screen.findByRole("button", { name: /^apply$/i });
    expect(applyBtn).toBeInTheDocument();
    expect(sendSpy).toHaveBeenCalledTimes(2);

    // The first message's failure marker is still there — only that
    // specific message is flagged.
    expect(
      screen.getByTestId("chat-message-failed-indicator")
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 15. Summary displayed with Apply/Discard
  // -------------------------------------------------------------------------
  it("shows the summary text from refine response", async () => {
    vi.spyOn(emailersApi, "listChatMessages").mockResolvedValue([]);
    vi.spyOn(emailersApi, "sendChatMessage").mockResolvedValue(
      MOCK_REFINE_RESPONSE
    );

    const user = userEvent.setup();
    renderChatPanel();

    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );

    const input = screen.getByLabelText(/chat message input/i);
    await user.type(input, "Make header red");
    await user.click(screen.getByLabelText(/send message/i));

    await waitFor(() =>
      expect(
        screen.getByText("Changed header background to red")
      ).toBeInTheDocument()
    );
  });
});
