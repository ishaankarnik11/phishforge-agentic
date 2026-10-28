import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { fieldFrame, fieldStateClasses } from "./fieldStyles";

/**
 * Input — text control on the AP0.2 frame (DESIGN.md §5 Inputs / Fields):
 * surface-raised fill, border-default 1px, 6px radius, 36px tall, Body type,
 * ink-faint placeholder. Focus shifts the border to accent plus a 2px accent
 * ring (~35% opacity); error swaps border and ring to danger. Use `mono` for
 * literal machine values (addresses, domains) per The Mono Means Machine Rule.
 */
export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  invalid?: boolean;
  /** Render the value in JetBrains Mono (addresses, domains, codes). */
  mono?: boolean;
  className?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, mono = false, className = "", "aria-invalid": ariaInvalid, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      className={`${fieldFrame} h-9 ${mono ? "font-mono text-mono" : ""} ${fieldStateClasses(
        invalid
      )} ${className}`}
      {...rest}
    />
  );
});
