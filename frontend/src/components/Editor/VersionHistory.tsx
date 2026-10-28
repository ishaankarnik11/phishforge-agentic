import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listVersions, getVersion } from "../../api/emailers";
import type {
  EmailerVersionSummary,
  EmailerVersionRead,
} from "../../api/emailers";
import { Button } from "../ds";

interface VersionHistoryProps {
  emailerId: number;
  activeVersionNumber: number | null;
  onPreview: (version: EmailerVersionRead) => void;
  onRestore: (version: EmailerVersionRead) => void;
  onClose: () => void;
}

/**
 * Format a timestamp as a relative string ("2 min ago") if recent,
 * otherwise as a short date-time.  Keeps things simple for the POC --
 * no external dependency needed.
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VersionHistory({
  emailerId,
  activeVersionNumber,
  onPreview,
  onRestore,
  onClose,
}: VersionHistoryProps) {
  const [previewingVersion, setPreviewingVersion] = useState<number | null>(
    null
  );

  const versionsQuery = useQuery({
    queryKey: ["emailerVersions", emailerId],
    queryFn: () => listVersions(emailerId),
    enabled: !Number.isNaN(emailerId),
  });

  const handlePreview = async (summary: EmailerVersionSummary) => {
    setPreviewingVersion(summary.version_number);
    try {
      const fullVersion = await getVersion(emailerId, summary.version_number);
      onPreview(fullVersion);
    } catch {
      // If fetch fails, just deselect
      setPreviewingVersion(null);
    }
  };

  const handleRestore = async (summary: EmailerVersionSummary) => {
    try {
      const fullVersion = await getVersion(emailerId, summary.version_number);
      onRestore(fullVersion);
    } catch {
      // Silently fail for POC -- the user can retry
    }
  };

  return (
    <div className="flex h-full w-80 flex-col border-l border-border-subtle bg-surface-raised">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-md py-3">
        <h2 className="text-title text-ink-strong">Version History</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close version history"
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

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {versionsQuery.isLoading && (
          <div className="flex items-center justify-center py-8">
            <div
              role="status"
              className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
            <span className="ml-2 text-body text-ink-muted">
              Loading versions...
            </span>
          </div>
        )}

        {versionsQuery.isError && (
          <div role="alert" className="px-4 py-6 text-center">
            <p className="text-body text-danger">Failed to load versions</p>
          </div>
        )}

        {versionsQuery.data && versionsQuery.data.length === 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-body text-ink-muted">No versions yet</p>
          </div>
        )}

        {versionsQuery.data?.map((version) => {
          const isActive = version.version_number === activeVersionNumber;
          const isPreviewing = version.version_number === previewingVersion;

          return (
            <div
              key={version.id}
              data-testid={`version-item-${version.version_number}`}
              className={`border-b border-border-subtle px-4 py-3 transition-colors ${
                isActive
                  ? "bg-accent-subtle"
                  : isPreviewing
                    ? "bg-info-subtle"
                    : "hover:bg-surface-sunken"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-ds-xs px-1.5 py-0.5 text-caption ${
                        isActive
                          ? "bg-accent text-on-accent"
                          : "bg-surface-sunken text-ink-body"
                      }`}
                    >
                      v{version.version_number}
                    </span>
                    <span className="text-caption font-normal normal-case tracking-normal text-ink-muted">
                      {formatTimestamp(version.created_at)}
                    </span>
                  </div>

                  {version.subject_line && (
                    <p className="mt-1 truncate text-body text-ink-body">
                      {version.subject_line}
                    </p>
                  )}

                  {isActive && (
                    <span className="mt-1 inline-block text-caption normal-case tracking-normal font-medium text-accent">
                      Current
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handlePreview(version)}
                  disabled={isPreviewing}
                >
                  Preview
                </Button>
                {!isActive && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRestore(version)}
                  >
                    Restore
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
