/**
 * ConfirmDeleteDialog -- confirmation modal for soft-deleting a library asset
 * (STORY-A1.6).
 *
 * Shows a centered overlay dialog with a warning message, cancel and delete
 * buttons. Supports Escape key and backdrop click to cancel.
 *
 * STORY-AP7.1 (chunk 3): restyled onto the design system. Dialog elevation
 * follows DESIGN.md §4 (scrim + shadow-dialog), and the action vocabulary uses
 * the shared ds/Button (secondary cancel, danger confirm). The warning glyph
 * stays paired with text (the Two Signal Rule).
 */

import { useEffect, useCallback } from "react";
import { Button } from "./ds";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConfirmDeleteDialogProps {
  isOpen: boolean;
  assetName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConfirmDeleteDialog({
  isOpen,
  assetName,
  onConfirm,
  onCancel,
  isDeleting,
}: ConfirmDeleteDialogProps) {
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isDeleting) {
        onCancel();
      }
    },
    [onCancel, isDeleting],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isDeleting) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      data-testid="confirm-delete-backdrop"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-strong/40 p-md"
      onClick={handleBackdropClick}
    >
      <div
        data-testid="confirm-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="w-full max-w-[400px] rounded-ds-md border border-border-subtle bg-surface-raised p-lg shadow-dialog"
      >
        {/* Warning icon */}
        <div className="mb-md flex h-12 w-12 items-center justify-center rounded-ds-full bg-danger-subtle">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-danger"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>

        {/* Title */}
        <h2
          id="confirm-delete-title"
          className="mb-xs text-title text-ink-strong"
        >
          Delete Asset
        </h2>

        {/* Message */}
        <p
          data-testid="confirm-delete-message"
          className="mb-lg text-body text-ink-muted"
        >
          Are you sure you want to delete{" "}
          <strong className="font-semibold text-ink-strong">{assetName}</strong>?
          This will hide it from the library but existing emailers using this
          asset will not be affected.
        </p>

        {/* Buttons */}
        <div className="flex justify-end gap-sm">
          <Button
            variant="secondary"
            data-testid="confirm-delete-cancel"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            data-testid="confirm-delete-submit"
            onClick={onConfirm}
            disabled={isDeleting}
            leadingIcon={
              isDeleting ? (
                <span
                  data-testid="confirm-delete-spinner"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              ) : undefined
            }
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
