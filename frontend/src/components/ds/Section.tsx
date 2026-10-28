import type { ReactNode } from "react";

/**
 * Section — a titled content grouping with a Headline header and optional
 * description and trailing action. Hierarchy comes from scale and weight, not
 * color or rules (DESIGN.md §3). Used to structure page bodies consistently.
 */
export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Trailing controls aligned to the header (e.g. a primary action). */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Section({
  title,
  description,
  action,
  className = "",
  children,
}: SectionProps) {
  return (
    <section className={`space-y-md ${className}`}>
      {(title || action || description) && (
        <div className="flex items-start justify-between gap-md">
          <div className="space-y-2xs">
            {title && (
              <h2 className="text-headline text-ink-strong">{title}</h2>
            )}
            {description && (
              <p className="text-body text-ink-muted">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
