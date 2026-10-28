/**
 * Shared field-frame styles for Input / Select / Textarea (DESIGN.md §5).
 * Kept in a non-component module so the form-control files only export
 * components (React Fast Refresh constraint).
 *
 * surface-raised fill, border-default 1px, 6px radius, Body type, ink-faint
 * placeholder. Focus shifts the border to accent plus a 2px accent ring
 * (~35% opacity); error swaps border and ring to danger.
 */
export const fieldFrame =
  "block w-full rounded-ds-sm border bg-surface-raised px-3 text-body text-ink-strong placeholder:text-ink-faint transition-colors duration-fast ease-out focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-faint";

export const fieldStateClasses = (invalid: boolean): string =>
  invalid
    ? "border-danger focus-visible:border-danger focus-visible:ring-danger/35"
    : "border-border-default focus-visible:border-accent focus-visible:ring-accent/35";
