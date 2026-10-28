import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listChatMessages,
  MJMLValidationError,
  sendChatMessage,
} from "../../api/emailers";
import type {
  ChatMessageRead,
  RefineResponse,
  EmailerVersionRead,
} from "../../api/emailers";
import { Button, Textarea } from "../ds";

// Matches the backend's SUGGESTION_PREFIX_TEMPLATE in preview_link_service.
// Stored form: "[Suggestion from {name}]: {text}" (both non-empty).
const SUGGESTION_PREFIX_RE = /^\[Suggestion from (.+?)\]: ([\s\S]+)$/;

/** Parse a suggestion's content into reviewer name (if any) and body. */
function parseSuggestion(content: string): {
  reviewer: string | null;
  body: string;
} {
  const match = content.match(SUGGESTION_PREFIX_RE);
  if (match) {
    return { reviewer: match[1], body: match[2] };
  }
  return { reviewer: null, body: content };
}

interface ChatPanelProps {
  emailerId: number;
  onApply: (version: EmailerVersionRead) => void;
  onClose: () => void;
  /**
   * STORY-8.1: optional callback fired when the refine round-trip
   * (`sendMutation`) flips between idle and pending. The parent uses
   * this to suspend the auto-save timer while a refine is in flight,
   * so a save and a refine can never produce competing version rows.
   * Optional so existing call sites and tests don't have to wire it.
   */
  onPendingChange?: (pending: boolean) => void;
}

/**
 * Slide-in chat panel for AI refinement (STORY-4.3).
 *
 * Displays chat history, lets users send refinement instructions,
 * and offers Apply/Discard for each AI-generated version.
 */
export default function ChatPanel({
  emailerId,
  onApply,
  onClose,
  onPendingChange,
}: ChatPanelProps) {
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track which assistant message IDs have been acted on (applied or discarded).
  const [actedMessageIds, setActedMessageIds] = useState<Set<number>>(
    () => new Set()
  );

  // Pending refinement: the latest response that hasn't been applied/discarded yet.
  const [pendingRefine, setPendingRefine] = useState<RefineResponse | null>(
    null
  );

  // STORY-7.12 AC-2: track which optimistic user-message ids represent
  // refinement failures (LLM contract retry exhausted on the backend, 422).
  // Keyed by the negative optimistic id we mint at send time. The set is
  // local state — the failure isn't persisted server-side because no
  // assistant reply was created.
  const [failedMessageIds, setFailedMessageIds] = useState<Set<number>>(
    () => new Set()
  );
  // Latest optimistic id we just sent, captured so the mutation's onError
  // knows which message to flag. Stored in a ref because we don't want to
  // re-render on changes.
  const lastOptimisticIdRef = useRef<number | null>(null);

  // -----------------------------------------------------------------
  // Fetch chat history
  // -----------------------------------------------------------------

  const chatQuery = useQuery({
    queryKey: ["chatMessages", emailerId],
    queryFn: () => listChatMessages(emailerId),
    enabled: !Number.isNaN(emailerId),
  });

  // -----------------------------------------------------------------
  // Send mutation
  // -----------------------------------------------------------------

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendChatMessage(emailerId, content),
    onSuccess: (data: RefineResponse) => {
      setPendingRefine(data);
      // Append the assistant message to the cache.
      // The optimistic user message (with negative id) stays in place --
      // a full re-fetch will eventually replace it with the real one.
      queryClient.setQueryData<ChatMessageRead[]>(
        ["chatMessages", emailerId],
        (old) => [...(old ?? []), data.message]
      );
      // Clear any prior failure flag on the just-sent optimistic id (in
      // case the user re-sent after a previous failure with the same id —
      // can't actually happen since ids are Date.now-based, but cheap
      // hygiene).
      lastOptimisticIdRef.current = null;
    },
    onError: (err) => {
      // STORY-7.12 AC-2: refinement 422 — flag the optimistic user
      // message as failed so we render the per-message marker. Other
      // errors (network, 500, etc.) fall through to the generic
      // sendMutation.isError surface below.
      if (err instanceof MJMLValidationError) {
        const optimisticId = lastOptimisticIdRef.current;
        if (optimisticId !== null) {
          setFailedMessageIds((prev) => {
            const next = new Set(prev);
            next.add(optimisticId);
            return next;
          });
        }
      }
      lastOptimisticIdRef.current = null;
    },
  });

  // -----------------------------------------------------------------
  // Scroll to bottom on new messages
  // -----------------------------------------------------------------

  const messages = chatQuery.data ?? [];

  useEffect(() => {
    // scrollIntoView may not exist in jsdom test environment
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, sendMutation.isPending]);

  // STORY-8.1: bubble the refine-in-flight flag up to <EmailerPage> so
  // the auto-save timer can skip ticks while we're round-tripping. The
  // cleanup resets to `false` on unmount (chat closed) so the parent
  // doesn't get stuck thinking a refine is pending after we vanish.
  useEffect(() => {
    onPendingChange?.(sendMutation.isPending);
    return () => {
      onPendingChange?.(false);
    };
  }, [sendMutation.isPending, onPendingChange]);

  // -----------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || sendMutation.isPending) return;

    // Optimistic: add the user message immediately.
    const optimisticId = -Date.now();
    const optimisticMsg: ChatMessageRead = {
      id: optimisticId, // temporary negative id
      emailer_id: emailerId,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };

    queryClient.setQueryData<ChatMessageRead[]>(
      ["chatMessages", emailerId],
      (old) => [...(old ?? []), optimisticMsg]
    );

    // Capture the optimistic id so the mutation's onError can flag *this*
    // user message as failed (per STORY-7.12 AC-2). Reset on every send —
    // we only ever care about the most recent in-flight message.
    lastOptimisticIdRef.current = optimisticId;

    setInputValue("");
    sendMutation.mutate(content);
  }, [inputValue, sendMutation, emailerId, queryClient]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleApply = useCallback(() => {
    if (!pendingRefine) return;
    onApply(pendingRefine.version);
    setActedMessageIds((prev) => new Set(prev).add(pendingRefine.message.id));
    setPendingRefine(null);

    // Invalidate version queries so version history refreshes.
    queryClient.invalidateQueries({
      queryKey: ["emailerVersion", emailerId, "latest"],
    });
    queryClient.invalidateQueries({
      queryKey: ["emailerVersions", emailerId],
    });
  }, [pendingRefine, onApply, queryClient, emailerId]);

  const handleDiscard = useCallback(() => {
    if (!pendingRefine) return;
    setActedMessageIds((prev) => new Set(prev).add(pendingRefine.message.id));
    setPendingRefine(null);
  }, [pendingRefine]);

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  return (
    <div className="flex h-full w-80 flex-col border-l border-border-subtle bg-surface-raised">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-md py-3">
        <h2 className="text-title text-ink-strong">AI Chat</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat panel"
          className="rounded-ds-sm p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink-strong"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-4" data-testid="chat-messages">
        {/* Loading state */}
        {chatQuery.isLoading && (
          <div className="flex items-center justify-center py-8">
            <div
              role="status"
              className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
            <span className="ml-2 text-body text-ink-muted">
              Loading chat...
            </span>
          </div>
        )}

        {/* Error state */}
        {chatQuery.isError && (
          <div role="alert" className="px-2 py-6 text-center">
            <p className="text-body text-danger">Failed to load chat history</p>
          </div>
        )}

        {/* Empty state */}
        {chatQuery.isSuccess && messages.length === 0 && !sendMutation.isPending && (
          <div className="px-2 py-6 text-center">
            <p className="text-body text-ink-muted">
              No messages yet. Describe what you'd like to change.
            </p>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => {
          if (msg.role === "suggestion") {
            const { reviewer, body } = parseSuggestion(msg.content);
            return (
              <div
                key={msg.id}
                data-testid={`chat-message-${msg.role}`}
                className="mb-3 flex justify-start"
              >
                <div className="max-w-[85%] rounded-ds-md border border-warning/30 bg-warning-subtle px-3 py-2 text-body text-ink-body">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded-ds-full bg-warning/20 px-2 py-0.5 text-caption text-warning">
                      Suggestion
                    </span>
                    <span className="text-caption font-normal normal-case tracking-normal italic text-ink-muted">
                      {reviewer ?? "Anonymous reviewer"}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{body}</p>
                </div>
              </div>
            );
          }

          // STORY-7.12 AC-2: a user message is "failed" when its
          // optimistic id is in failedMessageIds. We render a red status
          // dot on the bubble + an inline remediation hint just below.
          const isFailed =
            msg.role === "user" && failedMessageIds.has(msg.id);
          return (
          <div
            key={msg.id}
            data-testid={`chat-message-${msg.role}`}
            data-message-failed={isFailed ? "true" : undefined}
            className={`mb-3 flex flex-col ${
              msg.role === "user" ? "items-end" : "items-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-ds-md px-3 py-2 text-body ${
                msg.role === "user"
                  ? isFailed
                    ? "border border-danger bg-danger text-on-accent"
                    : "bg-accent text-on-accent"
                  : "bg-surface-sunken text-ink-body"
              }`}
            >
              <div className="flex items-start gap-2">
                {isFailed && (
                  <span
                    aria-label="Message failed"
                    title="Message failed"
                    data-testid="chat-message-failed-indicator"
                    className="mt-1 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-ds-full bg-danger-subtle ring-2 ring-on-accent/40"
                  />
                )}
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
              {/* Show Apply/Discard only on the pending assistant message */}
              {msg.role === "assistant" &&
                pendingRefine &&
                pendingRefine.message.id === msg.id &&
                !actedMessageIds.has(msg.id) && (
                  <div className="mt-2">
                    {/* Summary */}
                    {pendingRefine.summary && (
                      <p className="mb-1 text-caption font-normal normal-case tracking-normal italic text-ink-muted">
                        {pendingRefine.summary}
                      </p>
                    )}
                    {/* Warnings */}
                    {pendingRefine.warnings.length > 0 && (
                      <div
                        role="alert"
                        className="mb-2 rounded-ds-sm bg-warning-subtle px-2 py-1 text-caption font-normal normal-case tracking-normal text-warning"
                      >
                        {pendingRefine.warnings.map((w, i) => (
                          <p key={i}>{w}</p>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" onClick={handleApply}>
                        Apply
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleDiscard}
                      >
                        Discard
                      </Button>
                    </div>
                  </div>
                )}
            </div>
            {/* STORY-7.12 AC-2: per-message remediation hint sits just
                below the failed bubble, not as a separate floating
                element. */}
            {isFailed && (
              <p
                role="alert"
                data-testid="chat-message-failed-text"
                className="mt-1 max-w-[85%] text-caption font-normal normal-case tracking-normal italic text-danger"
              >
                Couldn&apos;t apply that change. Please rephrase.
              </p>
            )}
          </div>
          );
        })}

        {/* Thinking indicator */}
        {sendMutation.isPending && (
          <div className="mb-3 flex justify-start" data-testid="chat-thinking">
            <div className="max-w-[85%] rounded-ds-md bg-surface-sunken px-3 py-2 text-body text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <span
                  role="status"
                  className="h-3 w-3 animate-spin rounded-full border-2 border-ink-faint border-t-transparent"
                />
                Thinking...
              </span>
            </div>
          </div>
        )}

        {/* Send error.
            STORY-7.12 AC-2: when the failure was a 422 MJML validation
            error, the per-message marker above is the canonical surface;
            we suppress this generic banner so there's only one source of
            truth. Other failures (network drop, 500, etc.) still get this
            generic message because they're not "couldn't apply that
            change" — they're "we never got an answer". */}
        {sendMutation.isError &&
          !(sendMutation.error instanceof MJMLValidationError) && (
            <div
              role="alert"
              className="mb-3 rounded-ds-sm bg-danger-subtle px-3 py-2 text-caption font-normal normal-case tracking-normal text-danger"
            >
              Failed to send message.{" "}
              {sendMutation.error instanceof Error
                ? sendMutation.error.message
                : "Unknown error"}
            </div>
          )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border-subtle px-3 py-3">
        <div className="flex gap-2">
          <Textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a change..."
            rows={2}
            disabled={sendMutation.isPending}
            className="flex-1 resize-none"
            aria-label="Chat message input"
          />
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!inputValue.trim() || sendMutation.isPending}
            aria-label="Send message"
            className="self-end"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
