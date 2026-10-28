import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { fieldFrame, fieldStateClasses } from "./fieldStyles";

/**
 * Select — dropdown on the shared field frame (DESIGN.md §5: "Select /
 * combobox / textarea inherit the same frame"). A chevron affordance is drawn
 * with the native control hidden, keeping the 36px height and token styling.
 */
export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  invalid?: boolean;
  className?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className = "", children, "aria-invalid": ariaInvalid, ...rest },
  ref
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        className={`${fieldFrame} h-9 appearance-none pr-9 ${fieldStateClasses(
          invalid
        )} ${className}`}
        {...rest}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.38a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
});
