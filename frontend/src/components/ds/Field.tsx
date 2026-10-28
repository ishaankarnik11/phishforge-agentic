import { useId } from "react";
import type { ReactNode } from "react";

/**
 * Field — the label + help + error wrapper for form controls
 * (DESIGN.md §5 Inputs / Fields). Consolidates BriefPage's ad-hoc `DsField`.
 *
 * Every field carries a visible 13px Label above it. Errors are conveyed with
 * color PLUS a warning icon PLUS text (The Two Signal Rule), never color alone.
 *
 * Children is a render-prop receiving the ids the control must wire up so the
 * label/help/error are correctly associated for assistive technology:
 *   <Field label="Email" error={err}>
 *     {({ id, describedBy, invalid }) => (
 *       <Input id={id} aria-describedby={describedBy} invalid={invalid} />
 *     )}
 *   </Field>
 */
export interface FieldRenderProps {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FieldProps {
  label: string;
  /** Renders a "(optional)" affordance when false. Defaults to true. */
  required?: boolean;
  help?: string;
  error?: string;
  children: (props: FieldRenderProps) => ReactNode;
}

export function Field({
  label,
  required = true,
  help,
  error,
  children,
}: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  const describedBy = error ? errorId : help ? helpId : undefined;

  return (
    <div className="space-y-2xs">
      <label htmlFor={id} className="block text-label text-ink-body">
        {label}
        {!required && (
          <span className="ml-1 font-normal normal-case tracking-normal text-ink-muted">
            (optional)
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid })}
      {help && !error && (
        <p
          id={helpId}
          className="text-caption font-normal normal-case tracking-normal text-ink-muted"
        >
          {help}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-caption font-normal normal-case tracking-normal text-danger"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M8 5v3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="8" cy="11" r="0.9" fill="currentColor" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
