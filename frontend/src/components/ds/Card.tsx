import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

/**
 * Card — a content container on the AP0.2 tokens (DESIGN.md §5 Cards):
 * surface-raised on a surface-base page, 1px border-subtle, 8px radius. Flat at
 * rest (The Flat-By-Default Rule); interactive cards take the Raise shadow on
 * hover only. No side-stripe borders, no nested cards.
 */
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  /** Tightens internal padding for compact list rows (16px vs 24px). */
  compact?: boolean;
  /** Adds the hover Raise lift for clickable cards. */
  interactive?: boolean;
  className?: string;
  children?: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { compact = false, interactive = false, className = "", children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={`rounded-ds-md border border-border-subtle bg-surface-raised ${
        compact ? "p-md" : "p-lg"
      } ${
        interactive
          ? "transition-shadow duration-fast ease-out hover:shadow-raise"
          : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});
