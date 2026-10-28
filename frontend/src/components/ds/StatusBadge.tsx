import type { ReactNode } from "react";

/**
 * StatusBadge — the canonical state pattern (DESIGN.md §5 Status badge):
 * a pill (rounded.full) with a -subtle background, its solid foreground, Caption
 * type, and ALWAYS a small leading icon. Status is never carried by color alone
 * (The Two Signal Rule), so meaning survives color-blind viewing.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusBadgeProps {
  tone?: StatusTone;
  /** Override the default tone icon (still rendered, never color-only). */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

const toneClasses: Record<StatusTone, string> = {
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
  info: "bg-info-subtle text-info",
  // Neutral uses the sunken surface + muted ink (still icon + label).
  neutral: "bg-surface-sunken text-ink-muted",
};

function DefaultIcon({ tone }: { tone: StatusTone }) {
  // Distinct glyphs per tone so the icon, not just the color, signals state.
  switch (tone) {
    case "success":
      return (
        <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 16 16" fill="none">
          <path
            d="M3.5 8.5 6.5 11.5 12.5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "danger":
      return (
        <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 16 16" fill="none">
          <path
            d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "warning":
      return (
        <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 2.5 14.5 13.5H1.5L8 2.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
        </svg>
      );
    case "info":
      return (
        <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7.5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="5" r="0.9" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="3" fill="currentColor" />
        </svg>
      );
  }
}

export function StatusBadge({
  tone = "neutral",
  icon,
  className = "",
  children,
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-ds-full px-2 py-0.5 text-caption ${toneClasses[tone]} ${className}`}
    >
      {icon ?? <DefaultIcon tone={tone} />}
      {children}
    </span>
  );
}
