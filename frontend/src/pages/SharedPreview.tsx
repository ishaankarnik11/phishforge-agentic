import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  getPublicPreview,
  submitPublicSuggestion,
  PreviewNotFoundError,
} from "../api/previewLinks";
import { Button, Field, Input, Textarea } from "../components/ds";

// Matches backend schema MAX_SUGGESTION_CHARS.
const MAX_SUGGESTION_CHARS = 5000;

function formatExpiryDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Public, unauthenticated preview page (STORY-4.5).
 *
 * Rendered at /share/:token outside the PrivateRoute guard. No app chrome,
 * no navbar: reviewers who hit this URL should not be redirected to
 * login.
 */
export default function SharedPreview() {
  const { token } = useParams<{ token: string }>();

  const [suggestion, setSuggestion] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);

  const previewQuery = useQuery({
    queryKey: ["publicPreview", token],
    queryFn: () => getPublicPreview(token ?? ""),
    enabled: !!token,
    // We surface errors immediately and offer a manual Retry button for
    // non-404 failures. No automatic retry avoids flashing a spinner
    // through multiple retry attempts on a permanently-expired token.
    retry: false,
  });

  const suggestMutation = useMutation({
    mutationFn: () => {
      if (!token) throw new Error("Missing token");
      return submitPublicSuggestion(token, {
        text: suggestion.trim(),
        reviewer_name: reviewerName.trim() || undefined,
      });
    },
    onSuccess: () => {
      setSuggestion("");
      setSubmittedAt(Date.now());
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!suggestion.trim() || suggestMutation.isPending) return;
      suggestMutation.mutate();
    },
    [suggestion, suggestMutation]
  );

  // -------------------------------------------------------------------
  // Error / loading states
  // -------------------------------------------------------------------

  if (!token) {
    return <PublicShell>Invalid share URL.</PublicShell>;
  }

  if (previewQuery.isLoading) {
    return (
      <PublicShell>
        <div className="flex items-center justify-center py-16">
          <div
            role="status"
            className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent"
          />
          <span className="ml-3 text-body text-ink-muted">
            Loading preview…
          </span>
        </div>
      </PublicShell>
    );
  }

  if (previewQuery.isError) {
    const isNotFound = previewQuery.error instanceof PreviewNotFoundError;
    return (
      <PublicShell>
        <div
          role="alert"
          className="mx-auto max-w-md rounded-ds-md border border-danger bg-danger-subtle p-lg text-center"
        >
          <p className="text-body font-semibold text-danger">
            {isNotFound
              ? "This preview link is invalid or has expired."
              : "Couldn't load this preview."}
          </p>
          {!isNotFound && (
            <>
              <p className="mt-2 text-caption font-normal normal-case tracking-normal text-danger">
                {previewQuery.error instanceof Error
                  ? previewQuery.error.message
                  : "Unknown error"}
              </p>
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="mt-4"
                onClick={() => previewQuery.refetch()}
              >
                Retry
              </Button>
            </>
          )}
        </div>
      </PublicShell>
    );
  }

  const payload = previewQuery.data;
  if (!payload) {
    // The isLoading/isError branches above cover every state where
    // payload can be undefined; this extra guard keeps TypeScript happy
    // and is defensive in case react-query ever returns undefined in a
    // success state (e.g., a placeholderData transition).
    return (
      <PublicShell>
        <div className="flex items-center justify-center py-16">
          <span className="text-body text-ink-muted">Loading preview…</span>
        </div>
      </PublicShell>
    );
  }

  const compiledHtml = payload.compiled_html ?? "";
  const charCount = suggestion.length;
  const overLimit = charCount > MAX_SUGGESTION_CHARS;

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <PublicShell>
      {/* Header card */}
      <section className="mx-auto max-w-3xl">
        <div className="rounded-ds-md border border-border-subtle bg-surface-raised p-lg">
          <div className="flex flex-wrap items-start justify-between gap-sm">
            <div>
              <p className="text-caption text-ink-muted">Shared preview</p>
              <h1 className="mt-1 text-headline text-ink-strong">
                {payload.emailer_name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-caption font-normal normal-case tracking-normal">
                {payload.identity?.name && (
                  <span className="rounded-ds-full bg-accent-subtle px-2.5 py-0.5 font-medium text-accent">
                    {payload.identity.name}
                  </span>
                )}
                <span className="rounded-ds-full bg-surface-sunken px-2.5 py-0.5 font-medium text-ink-body">
                  Version {payload.version_number}
                </span>
              </div>
            </div>
            <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
              Expires on {formatExpiryDate(payload.expires_at)}
            </p>
          </div>
          {payload.subject_line && (
            <p className="mt-3 text-body text-ink-body">
              <span className="font-medium text-ink-strong">Subject:</span>{" "}
              {payload.subject_line}
            </p>
          )}
          {payload.preheader && (
            <p className="mt-1 text-body text-ink-body">
              <span className="font-medium text-ink-strong">Preheader:</span>{" "}
              {payload.preheader}
            </p>
          )}
        </div>
      </section>

      {/* Preview iframe */}
      <section className="mx-auto mt-lg max-w-3xl">
        <div className="rounded-ds-md border border-border-subtle bg-surface-raised p-md">
          {compiledHtml ? (
            // The iframe renders the actual email and is always light (it
            // mimics a real inbox), so bg-white here is the artifact canvas,
            // not app chrome (DESIGN.md §2 / §5 Two-Pane Editor Shell).
            <iframe
              title="Email preview"
              srcDoc={compiledHtml}
              sandbox="allow-same-origin"
              className="h-[600px] w-full rounded-ds-sm border border-border-default bg-white"
              data-testid="shared-preview-iframe"
            />
          ) : (
            <p className="py-12 text-center text-body text-ink-muted">
              This version has no compiled HTML available to preview.
            </p>
          )}
        </div>
      </section>

      {/* Suggest-changes form */}
      <section className="mx-auto mt-lg max-w-3xl">
        <div className="rounded-ds-md border border-border-subtle bg-surface-raised p-lg">
          <h2 className="text-title text-ink-strong">Suggest changes</h2>
          <p className="mt-1 text-body text-ink-muted">
            Leave feedback for the owner. Your message will appear in the
            emailer's chat history.
          </p>

          <form onSubmit={handleSubmit} className="mt-md space-y-sm">
            <Field label="Your name" required={false}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="text"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  maxLength={120}
                  disabled={suggestMutation.isPending}
                />
              )}
            </Field>

            <Field label="Your suggestion">
              {({ id, describedBy }) => (
                <>
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    value={suggestion}
                    onChange={(e) => setSuggestion(e.target.value)}
                    rows={5}
                    maxLength={MAX_SUGGESTION_CHARS}
                    required
                    disabled={suggestMutation.isPending}
                    placeholder="What should change?"
                  />
                  <p
                    className={`mt-1 text-caption font-normal normal-case tracking-normal ${
                      overLimit ? "text-danger" : "text-ink-muted"
                    }`}
                    data-testid="suggestion-char-count"
                  >
                    {charCount} / {MAX_SUGGESTION_CHARS} characters
                  </p>
                </>
              )}
            </Field>

            {suggestMutation.isError && (
              <div
                role="alert"
                className="rounded-ds-sm bg-danger-subtle px-sm py-2 text-caption font-normal normal-case tracking-normal text-danger"
              >
                Failed to submit suggestion:{" "}
                {suggestMutation.error instanceof Error
                  ? suggestMutation.error.message
                  : "Unknown error"}
              </div>
            )}

            {submittedAt !== null && !suggestMutation.isError && (
              <div
                role="status"
                className="rounded-ds-sm bg-success-subtle px-sm py-2 text-caption font-normal normal-case tracking-normal text-success"
                data-testid="suggestion-success"
              >
                Thanks! Your suggestion was sent to the owner.
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                loading={suggestMutation.isPending}
                disabled={!suggestion.trim() || overLimit}
              >
                {suggestMutation.isPending
                  ? "Sending…"
                  : "Submit suggestion"}
              </Button>
            </div>
          </form>
        </div>
      </section>
    </PublicShell>
  );
}

/**
 * Minimal page shell: public preview intentionally has no app chrome,
 * no navbar, and no link back to the authenticated app. Just a clean
 * neutral background.
 */
function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-sunken px-md py-xl">{children}</div>
  );
}
