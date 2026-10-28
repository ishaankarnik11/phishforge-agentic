import type { ReactNode } from "react";

/**
 * Minimal floating toast (STORY-7.12 AC-3).
 *
 * The codebase has no existing toast library — STORY-7.10 surfaced save
 * errors as an inline truncated `<span>` in the toolbar, with a comment
 * marking it as a placeholder for STORY-7.12 to upgrade. We chose to add
 * a small Tailwind-only component here rather than pull in `sonner` or
 * `react-hot-toast`: the only consumer right now is the save-error
 * surface, the design is dictated by the spec (one heading line + one
 * remediation button + a close X), and a 30-line component is easier to
 * style-match the rest of the app than configuring a third-party lib.
 *
 * This is *not* a queueing toast manager — at most one toast renders at a
 * time, and the parent owns the open/closed state. If the app ever needs
 * stacking or auto-dismiss, swap in a real lib then.
 */
export type ToastVariant = "error" | "info" | "success";

export interface ToastProps {
  /** Bold heading line — the "what just happened" summary. */
  title: string;
  /** Optional secondary line (e.g. the server's error message). */
  description?: string | null;
  /** Optional primary action — typically the one-button remediation. */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Called when the user clicks the X. Required — we don't render
   *  toasts that can't be dismissed. */
  onDismiss: () => void;
  /** Color palette. Defaults to ``error`` (red). */
  variant?: ToastVariant;
  /** Forwarded to the root element so callers can attach test ids. */
  "data-testid"?: string;
  /** Optional extra slot rendered below `description`. Used by callers
   *  that want to render structured content (e.g. a list of validation
   *  errors) without us baking that into the component. */
  children?: ReactNode;
}

// STORY-AP7.1 (chunk 3): map variants onto the semantic state tokens. Each
// keeps a -subtle background with its solid foreground; status is paired with
// text (the Two Signal Rule). Borders use the matching solid at low opacity.
const VARIANT_CLASSES: Record<ToastVariant, string> = {
  error: "border-danger/30 bg-danger-subtle text-danger",
  info: "border-info/30 bg-info-subtle text-info",
  // STORY-6.3: success variant for the brand kit admin "saved/created/
  // deleted" confirmation toasts. Matches the success status palette used
  // elsewhere on the home page.
  success: "border-success/30 bg-success-subtle text-success",
};

const VARIANT_BUTTON_CLASSES: Record<ToastVariant, string> = {
  error: "bg-danger hover:opacity-90 focus-visible:outline-danger",
  info: "bg-info hover:opacity-90 focus-visible:outline-info",
  success: "bg-success hover:opacity-90 focus-visible:outline-success",
};

export function Toast({
  title,
  description,
  action,
  onDismiss,
  variant = "error",
  "data-testid": testId,
  children,
}: ToastProps) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={`pointer-events-auto fixed bottom-lg right-lg z-50 flex max-w-md items-start gap-sm rounded-ds-md border px-md py-sm shadow-overlay ${VARIANT_CLASSES[variant]}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink-strong">{title}</p>
        {description && (
          <p className="mt-2xs break-words text-caption font-normal normal-case tracking-normal text-ink-body">
            {description}
          </p>
        )}
        {children}
        {action && (
          <div className="mt-xs">
            <button
              type="button"
              onClick={action.onClick}
              className={`inline-flex items-center rounded-ds-sm px-3 py-1.5 text-label text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors ${VARIANT_BUTTON_CLASSES[variant]}`}
            >
              {action.label}
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-ds-sm p-1 text-ink-muted opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
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
  );
}

export default Toast;
