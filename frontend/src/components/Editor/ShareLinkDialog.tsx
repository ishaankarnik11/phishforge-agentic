import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createPreviewLink,
  listPreviewLinks,
  revokePreviewLink,
} from "../../api/previewLinks";
import type { PreviewLinkRead } from "../../api/previewLinks";
import { Button, Select } from "../ds";

interface ShareLinkDialogProps {
  emailerId: number;
  currentVersionId: number | null;
  onClose: () => void;
}

// Keep the selector in sync with backend's MIN/MAX/DEFAULT constants
// (preview_link schema: 1 <= days <= 30, default 7).
const EXPIRY_OPTIONS = [1, 3, 7, 14, 30] as const;
const DEFAULT_EXPIRY_DAYS = 7;

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
 * Modal dialog for creating and managing shared preview links.
 *
 * Renders as a dismissable centered card with a backdrop -- no extra
 * dependency needed because we only need one dialog on screen at a time.
 */
export default function ShareLinkDialog({
  emailerId,
  currentVersionId,
  onClose,
}: ShareLinkDialogProps) {
  const queryClient = useQueryClient();

  const [expiryDays, setExpiryDays] = useState<number>(DEFAULT_EXPIRY_DAYS);
  const [pinVersion, setPinVersion] = useState<boolean>(false);
  const [justCreated, setJustCreated] = useState<PreviewLinkRead | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Active (non-expired) links for this emailer.
  const linksQuery = useQuery({
    queryKey: ["previewLinks", emailerId],
    queryFn: () => listPreviewLinks(emailerId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createPreviewLink(emailerId, {
        expires_in_days: expiryDays,
        version_id: pinVersion ? currentVersionId : null,
      }),
    onSuccess: (data) => {
      setJustCreated(data);
      queryClient.invalidateQueries({
        queryKey: ["previewLinks", emailerId],
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (token: string) => revokePreviewLink(emailerId, token),
    onSuccess: (_data, token) => {
      if (justCreated?.token === token) {
        setJustCreated(null);
      }
      queryClient.invalidateQueries({
        queryKey: ["previewLinks", emailerId],
      });
    },
  });

  const handleCopy = useCallback(async (url: string, token: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      // Reset the "Copied!" badge after a short delay so the user sees it.
      window.setTimeout(() => {
        setCopiedToken((prev) => (prev === token ? null : prev));
      }, 2000);
    } catch {
      // Clipboard API can fail in insecure contexts. Fall back to showing
      // the URL so the user can select-and-copy manually -- they already
      // see it on screen, so no extra UI needed here.
    }
  }, []);

  const handleCreate = useCallback(() => {
    createMutation.mutate();
  }, [createMutation]);

  const pinDisabled = currentVersionId === null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-strong/40 p-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      onClick={(e) => {
        // Click outside the card closes the dialog.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-ds-md border border-border-subtle bg-surface-raised shadow-dialog">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-lg py-md">
          <h2
            id="share-dialog-title"
            className="text-title text-ink-strong"
          >
            Share preview
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
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

        {/* Body */}
        <div className="space-y-5 px-lg py-md">
          <p className="text-body text-ink-muted">
            Creates a read-only link reviewers can open without logging in.
          </p>

          {/* Expiry selector */}
          <div>
            <label
              htmlFor="expiry-days"
              className="block text-label text-ink-body"
            >
              Expires after
            </label>
            <Select
              id="expiry-days"
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              disabled={createMutation.isPending}
              className="mt-1"
            >
              {EXPIRY_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} day{n === 1 ? "" : "s"}
                  {n === DEFAULT_EXPIRY_DAYS ? " (default)" : ""}
                </option>
              ))}
            </Select>
          </div>

          {/* Pin-to-version checkbox */}
          <div>
            <label
              className={`flex items-start gap-2 text-body ${
                pinDisabled ? "cursor-not-allowed text-ink-faint" : "text-ink-body"
              }`}
            >
              <input
                type="checkbox"
                checked={pinVersion}
                disabled={pinDisabled || createMutation.isPending}
                onChange={(e) => setPinVersion(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded-ds-xs border-border-default text-accent focus:ring-accent"
              />
              <span>
                Pin to current version
                <span className="mt-0.5 block text-caption font-normal normal-case tracking-normal text-ink-muted">
                  {pinDisabled
                    ? "No version available yet."
                    : "When unchecked, the link always shows the latest version."}
                </span>
              </span>
            </label>
          </div>

          {/* Create button */}
          <Button
            variant="primary"
            onClick={handleCreate}
            loading={createMutation.isPending}
            className="w-full"
          >
            {createMutation.isPending ? "Creating..." : "Create link"}
          </Button>

          {createMutation.isError && (
            <div
              role="alert"
              className="rounded-ds-sm bg-danger-subtle px-3 py-2 text-caption font-normal normal-case tracking-normal text-danger"
            >
              Failed to create link:{" "}
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : "Unknown error"}
            </div>
          )}

          {/* Newly created link callout */}
          {justCreated && (
            <div
              className="rounded-ds-md border border-success/30 bg-success-subtle p-3"
              data-testid="share-link-created"
            >
              <p className="text-caption normal-case tracking-normal font-medium text-success">
                Link created. Expires {formatExpiryDate(justCreated.expires_at)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={justCreated.url}
                  readOnly
                  aria-label="Created preview URL"
                  className="flex-1 rounded-ds-sm border border-success/40 bg-surface-raised px-2 py-1 font-mono text-mono text-ink-body"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleCopy(justCreated.url, justCreated.token)}
                >
                  {copiedToken === justCreated.token ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>
          )}

          {/* Existing links list */}
          <div>
            <h3 className="text-label text-ink-strong">Active links</h3>

            {linksQuery.isLoading && (
              <p className="mt-2 text-caption font-normal normal-case tracking-normal text-ink-muted">
                Loading links...
              </p>
            )}

            {linksQuery.isError && (
              <p
                role="alert"
                className="mt-2 text-caption font-normal normal-case tracking-normal text-danger"
              >
                Failed to load links.
              </p>
            )}

            {linksQuery.isSuccess && linksQuery.data.length === 0 && (
              <p className="mt-2 text-caption font-normal normal-case tracking-normal text-ink-muted">
                No active preview links yet.
              </p>
            )}

            {linksQuery.isSuccess && linksQuery.data.length > 0 && (
              <ul className="mt-2 space-y-2" data-testid="preview-links-list">
                {linksQuery.data.map((link) => (
                  <li
                    key={link.token}
                    className="rounded-ds-sm border border-border-subtle bg-surface-sunken p-2"
                    data-testid={`preview-link-${link.token}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={link.url}
                        readOnly
                        aria-label={`Preview URL ${link.token}`}
                        className="flex-1 truncate rounded-ds-sm border border-border-default bg-surface-raised px-2 py-1 font-mono text-mono text-ink-body"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCopy(link.url, link.token)}
                      >
                        {copiedToken === link.token ? "Copied!" : "Copy"}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => revokeMutation.mutate(link.token)}
                        disabled={
                          revokeMutation.isPending &&
                          revokeMutation.variables === link.token
                        }
                        aria-label={`Revoke preview link ${link.token}`}
                      >
                        Revoke
                      </Button>
                    </div>
                    <p className="mt-1 text-caption font-normal normal-case tracking-normal text-ink-muted">
                      Expires {formatExpiryDate(link.expires_at)}
                      {link.version_id !== null && (
                        <span> (pinned to a specific version)</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {revokeMutation.isError && (
              <p
                role="alert"
                className="mt-2 text-caption font-normal normal-case tracking-normal text-danger"
              >
                Failed to revoke:{" "}
                {revokeMutation.error instanceof Error
                  ? revokeMutation.error.message
                  : "Unknown error"}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border-subtle bg-surface-sunken px-lg py-sm">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
