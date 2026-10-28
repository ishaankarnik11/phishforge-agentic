import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button — the single button vocabulary for PhishForge (DESIGN.md §5 Buttons).
 *
 * Variants and states are token-driven (AP0.2): no raw greys, no per-screen
 * one-offs. The same action looks identical on every screen ("Consistency is
 * an affordance"). Focus is a 2px accent ring at ~40% opacity with a 2px
 * offset on :focus-visible only (WCAG 2.1 AA), never removed.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When true, shows an inline spinner, locks width, and disables the control. */
  loading?: boolean;
  /** Optional leading icon; replaced by the spinner while loading. */
  leadingIcon?: ReactNode;
  /** Escape hatch for layout-only utilities (width, margin). Avoid styling here. */
  className?: string;
  children?: ReactNode;
}

// Shared frame: gently rounded (rounded.sm), Label type, single-line, with a
// visible focus-visible ring. transition-colors only (no decorative motion).
const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ds-sm text-label transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:cursor-not-allowed";

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-3",
  md: "h-9 px-3.5",
  lg: "h-11 px-4",
};

// Disabled fill is surface-sunken with ink-faint text, no hover (DESIGN.md §5).
const disabledClasses =
  "disabled:bg-surface-sunken disabled:text-ink-faint disabled:border-transparent";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-accent border border-transparent hover:bg-accent-hover active:bg-accent-active",
  secondary:
    "bg-surface-raised text-ink-body border border-border-default hover:bg-surface-sunken hover:border-border-strong active:bg-surface-sunken",
  ghost:
    "bg-transparent text-ink-body border border-transparent hover:bg-accent-subtle active:bg-accent-subtle",
  danger:
    "bg-danger text-on-accent border border-transparent hover:opacity-90 active:opacity-100",
};

function Spinner() {
  return (
    <svg
      data-testid="button-spinner"
      aria-hidden="true"
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      loading = false,
      leadingIcon,
      disabled,
      type = "button",
      className = "",
      children,
      ...rest
    },
    ref
  ) {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={`${base} ${sizeClasses[size]} ${variantClasses[variant]} ${disabledClasses} ${className}`}
        {...rest}
      >
        {loading ? <Spinner /> : leadingIcon}
        {children}
      </button>
    );
  }
);
