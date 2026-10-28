import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { fieldFrame, fieldStateClasses } from "./fieldStyles";

/**
 * Textarea — multi-line control on the shared field frame (DESIGN.md §5).
 * Drops the fixed 36px height for a min-height and vertical padding. Use
 * `mono` for MJML / code views per The Mono Means Machine Rule.
 */
export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  invalid?: boolean;
  mono?: boolean;
  className?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { invalid = false, mono = false, className = "", "aria-invalid": ariaInvalid, ...rest },
    ref
  ) {
    return (
      <textarea
        ref={ref}
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        className={`${fieldFrame} min-h-[88px] py-2.5 ${
          mono ? "font-mono text-mono" : ""
        } ${fieldStateClasses(invalid)} ${className}`}
        {...rest}
      />
    );
  }
);
